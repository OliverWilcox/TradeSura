import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sniffImage, stripImageMetadata } from "@/lib/image-metadata";
import { bothSidesTooBig, cleanCardPhoto, storeGasSafeCard } from "@/lib/gas-safe-card";

const put = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob", () => ({ put, get: vi.fn(), del: vi.fn() }));

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const seg = (marker: number, payload: Uint8Array) => {
  const len = payload.length + 2;
  return new Uint8Array([0xff, marker, len >> 8, len & 0xff, ...payload]);
};
const has = (hay: Uint8Array, needle: string) => Buffer.from(hay).includes(Buffer.from(needle, "latin1"));

function exifWithGps(orientation: number) {
  return bytes("Exif", [0, 0], "MM", [0, 0x2a, 0, 0, 0, 8], [0, 2], [0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0], [0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 38], [0, 0, 0, 0], "GPSLatitude 53.4808N GPSLongitude 2.2426W");
}

const jfif = seg(0xe0, bytes("JFIF", [0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
const dqt = seg(0xdb, bytes([0, ...Array(64).fill(1)]));
const sof = seg(0xc0, bytes([8, 0, 16, 0, 16, 1, 1, 0x11, 0]));
const sos = seg(0xda, bytes([1, 1, 0, 0, 63, 0]));
const scan = bytes([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);

function photoJpeg(orientation = 6) {
  return new Uint8Array([
    0xff, 0xd8,
    ...jfif,
    ...seg(0xe1, exifWithGps(orientation)),
    ...seg(0xe1, bytes("http://ns.adobe.com/xap/1.0/", [0], "<x:xmpmeta>Camera iPhone</x:xmpmeta>")),
    ...seg(0xed, bytes("Photoshop 3.0", [0], "8BIM City: Manchester")),
    ...seg(0xfe, bytes("taken at 10 Downing Street")),
    ...dqt, ...sof, ...sos, ...scan,
    0xff, 0xd9,
    0xff, 0xd8, ...seg(0xe1, exifWithGps(1)), 0xff, 0xd9,
  ]);
}

describe("card photos lose their location and camera data", () => {
  it("keeps a JPEG's picture and rotation and drops GPS, XMP, IPTC, comments and anything after the image", () => {
    const out = stripImageMetadata(photoJpeg(6), "image/jpeg")!;
    expect(out).not.toBeNull();
    for (const gone of ["GPSLatitude", "xmpmeta", "Manchester", "Downing"]) expect(has(out, gone)).toBe(false);
    expect(Buffer.from(out).subarray(0, 2 + jfif.length)).toEqual(Buffer.from([0xff, 0xd8, ...jfif]));
    expect(Buffer.from(out).includes(Buffer.from([0xff, 0xe1, 0x00, 0x22, ...bytes("Exif", [0, 0], "MM", [0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6])]))).toBe(true);
    const picture = Buffer.from([...dqt, ...sof, ...sos, ...scan, 0xff, 0xd9]);
    expect(Buffer.from(out).subarray(out.length - picture.length)).toEqual(picture);
  });

  it("adds no rotation when the photo is upright", () => {
    const out = stripImageMetadata(photoJpeg(1), "image/jpeg")!;
    expect(has(out, "Exif")).toBe(false);
    expect(Buffer.from(out)).toEqual(Buffer.from([0xff, 0xd8, ...jfif, ...dqt, ...sof, ...sos, ...scan, 0xff, 0xd9]));
  });

  it("drops a PNG's text, time and EXIF chunks", () => {
    const chunk = (type: string, data: Uint8Array) => {
      const len = data.length;
      return bytes([len >>> 24, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff], type, [...data], [0, 0, 0, 0]);
    };
    const sig = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = chunk("IHDR", bytes([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
    const idat = chunk("IDAT", bytes([1, 2, 3]));
    const iend = chunk("IEND", new Uint8Array());
    const png = new Uint8Array([...sig, ...ihdr, ...chunk("tEXt", bytes("Location", [0], "Manchester")), ...chunk("eXIf", exifWithGps(1)), ...chunk("tIME", bytes([7, 234, 11, 18, 10, 0, 0])), ...idat, ...iend, ...bytes("trailing")]);
    expect(Buffer.from(stripImageMetadata(png, "image/png")!)).toEqual(Buffer.from([...sig, ...ihdr, ...idat, ...iend]));
  });

  it("drops a WebP's EXIF and XMP chunks and clears their flags", () => {
    const chunk = (fourcc: string, data: Uint8Array) => {
      const pad = data.length % 2 ? [0] : [];
      return bytes(fourcc, [data.length & 0xff, (data.length >> 8) & 0xff, 0, 0], [...data], pad);
    };
    const vp8x = chunk("VP8X", bytes([0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const vp8 = chunk("VP8 ", bytes([1, 2, 3, 4]));
    const body = [...vp8x, ...vp8, ...chunk("EXIF", exifWithGps(1)), ...chunk("XMP ", bytes("<x:xmpmeta/>"))];
    const webp = bytes("RIFF", [(body.length + 4) & 0xff, ((body.length + 4) >> 8) & 0xff, 0, 0], "WEBP", body);
    const out = stripImageMetadata(webp, "image/webp")!;
    expect(has(out, "GPSLatitude") || has(out, "xmpmeta")).toBe(false);
    expect(out[20]).toBe(0);
    expect(out.length).toBe(12 + vp8x.length + vp8.length);
    expect(out[4] | (out[5] << 8)).toBe(out.length - 8);
  });
});

describe("a PNG or WebP card photo keeps its rotation", () => {
  const rotation = (o: number) => bytes("MM", [0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);

  it("puts a PNG's rotation back in an eXIf chunk with a good CRC, before the picture and without the GPS", () => {
    const pngChunk = (type: string, data: Uint8Array) => {
      const len = data.length;
      const crc = zlib.crc32(Buffer.from(bytes(type, [...data])));
      return bytes([len >>> 24, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff], type, [...data], [crc >>> 24, (crc >> 16) & 0xff, (crc >> 8) & 0xff, crc & 0xff]);
    };
    const sig = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = pngChunk("IHDR", bytes([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
    const idat = pngChunk("IDAT", bytes([1, 2, 3]));
    const iend = pngChunk("IEND", new Uint8Array());
    const png = new Uint8Array([...sig, ...ihdr, ...idat, ...pngChunk("eXIf", exifWithGps(6)), ...iend]);
    const out = stripImageMetadata(png, "image/png")!;
    expect(has(out, "GPSLatitude")).toBe(false);
    expect(Buffer.from(out)).toEqual(Buffer.from([...sig, ...ihdr, ...pngChunk("eXIf", rotation(6)), ...idat, ...iend]));
  });

  it("puts a WebP's rotation back in an EXIF chunk and keeps the EXIF flag", () => {
    const chunk = (fourcc: string, data: Uint8Array) => bytes(fourcc, [data.length & 0xff, (data.length >> 8) & 0xff, 0, 0], [...data], data.length % 2 ? [0] : []);
    const vp8x = chunk("VP8X", bytes([0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const vp8 = chunk("VP8 ", bytes([1, 2, 3, 4]));
    const body = [...vp8x, ...vp8, ...chunk("EXIF", exifWithGps(8))];
    const webp = bytes("RIFF", [(body.length + 4) & 0xff, ((body.length + 4) >> 8) & 0xff, 0, 0], "WEBP", body);
    const out = stripImageMetadata(webp, "image/webp")!;
    expect(has(out, "GPSLatitude")).toBe(false);
    expect(out[20]).toBe(0x08);
    expect(Buffer.from(out).subarray(12 + vp8x.length + vp8.length)).toEqual(Buffer.from(chunk("EXIF", rotation(8))));
    expect(out[4] | (out[5] << 8)).toBe(out.length - 8);
  });
});

describe("a card upload is the photo it says it is", () => {
  it("refuses SVG text sent as a PNG, and anything else that isn't a photo", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(cleanCardPhoto(svg, "image/png")).toEqual({ ok: false, error: "That photo couldn't be used — try taking it again." });
    expect(cleanCardPhoto(Buffer.from("%PDF-1.7"), "image/jpeg").ok).toBe(false);
    expect(cleanCardPhoto(photoJpeg(), "application/pdf")).toEqual({ ok: false, error: "Use a JPEG or PNG photo." });
  });

  it("goes by the photo's own bytes, so a JPEG labelled HEIC is kept as a JPEG", () => {
    const res = cleanCardPhoto(photoJpeg(), "image/heic");
    expect(res.ok && res.type).toBe("image/jpeg");
  });

  it("refuses a JPEG that's cut off before its picture", () => {
    expect(cleanCardPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]), "image/jpeg").ok).toBe(false);
  });

  it("says a photo over 3 MB is too big, since the request has to fit Vercel's 4.5 MB", () => {
    const big = new Uint8Array(3 * 1024 * 1024 + 1);
    big.set(photoJpeg());
    expect(cleanCardPhoto(big, "image/jpeg")).toEqual({ ok: false, error: "That photo is too big. Use one under 3 MB." });
  });

  it("keeps the front and back of a card under 3 MB together, so both fit one request (R-04)", () => {
    const side = (bytes: number) => Buffer.alloc(bytes).toString("base64");
    expect(bothSidesTooBig(side(3 * 1024 * 1024))).toBeNull();
    expect(bothSidesTooBig(side(1.5 * 1024 * 1024), side(1.5 * 1024 * 1024))).toBeNull();
    expect(bothSidesTooBig(side(1.5 * 1024 * 1024), side(1.5 * 1024 * 1024 + 1))).toBe("The two photos are too big together. Keep them under 3 MB in all.");
  });
});

describe("an iPhone's HEIC card photo", () => {
  const heic = () => new Uint8Array(readFileSync(new URL("./fixtures/card.heic", import.meta.url)));

  it("is refused with what to do instead, whatever type the phone says it is (the app sends a JPEG)", () => {
    expect(sniffImage(heic())).toBe("image/heic");
    const refused = { ok: false, error: "That photo is in HEIC format, which can't be checked. Take the photo with the camera in the app, or use a JPEG or PNG." };
    expect(cleanCardPhoto(heic(), "image/heic")).toEqual(refused);
    expect(cleanCardPhoto(heic(), "image/jpeg")).toEqual(refused);
  });
});

describe("card photos are kept in the private store", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    put.mockReset();
  });

  it("stores the cleaned photo as a private blob with the card store's token", async () => {
    vi.stubEnv("CARD_BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_cards");
    put.mockResolvedValue({ url: "https://store.private.blob.vercel-storage.com/gas-safe-cards/card-a1.jpg" });
    const res = await storeGasSafeCard(Buffer.from(photoJpeg()).toString("base64"), "image/jpeg");
    expect(res).toEqual({ ok: true, url: "https://store.private.blob.vercel-storage.com/gas-safe-cards/card-a1.jpg" });
    const [path, body, options] = put.mock.calls[0];
    expect(path).toBe("gas-safe-cards/card.jpg");
    expect(options).toEqual({ access: "private", contentType: "image/jpeg", addRandomSuffix: true, token: "vercel_blob_rw_cards" });
    expect(has(body, "GPSLatitude")).toBe(false);
  });

  it("stores nothing for a HEIC photo", async () => {
    vi.stubEnv("CARD_BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_cards");
    const heic = readFileSync(new URL("./fixtures/card.heic", import.meta.url));
    expect(await storeGasSafeCard(heic.toString("base64"), "image/heic")).toMatchObject({ ok: false });
    expect(put).not.toHaveBeenCalled();
  });

  it("keeps nothing when the private store isn't set up", async () => {
    vi.stubEnv("CARD_BLOB_READ_WRITE_TOKEN", "");
    const res = await storeGasSafeCard(Buffer.from(photoJpeg()).toString("base64"), "image/jpeg");
    expect(res).toEqual({ ok: false, error: "We couldn't save your photo just now. Try again in a few minutes." });
    expect(put).not.toHaveBeenCalled();
  });
});

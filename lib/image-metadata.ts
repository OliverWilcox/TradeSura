export type SniffedImage = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/avif";

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

export function sniffImage(b: Uint8Array): SniffedImage | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const brands = [ascii(b, 8, 4)];
    const size = Math.min(b.length, ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0);
    for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(b, i, 4));
    if (brands.some((x) => x === "avif" || x === "avis")) return "image/avif";
    if (brands.some((x) => ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(x))) return "image/heic";
  }
  return null;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function orientationOf(tiff: Uint8Array): number {
  if (tiff.length < 8) return 1;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1;
  const u16 = (at: number) => (little ? tiff[at] | (tiff[at + 1] << 8) : (tiff[at] << 8) | tiff[at + 1]);
  const u32 = (at: number) => (little ? (tiff[at] | (tiff[at + 1] << 8) | (tiff[at + 2] << 16) | (tiff[at + 3] << 24)) >>> 0 : ((tiff[at] << 24) | (tiff[at + 1] << 16) | (tiff[at + 2] << 8) | tiff[at + 3]) >>> 0);
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return 1;
    if (u16(entry) === 0x0112) {
      const v = u16(entry + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

const tiffOf = (exif: Uint8Array) => (ascii(exif, 0, 6) === "Exif\0\0" ? exif.subarray(6) : exif);

function exifOrientation(seg: Uint8Array): number {
  return ascii(seg, 4, 6) === "Exif\0\0" ? orientationOf(seg.subarray(10)) : 1;
}

const orientationTiff = (orientation: number) => new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);

function orientationSegment(orientation: number) {
  return concat([new Uint8Array([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0]), orientationTiff(orientation)]);
}

function keepJpegSegment(marker: number, seg: Uint8Array) {
  if (marker === 0xe0) return ascii(seg, 4, 5) === "JFIF\0";
  if (marker === 0xe2) return ascii(seg, 4, 12) === "ICC_PROFILE\0";
  if (marker === 0xee) return ascii(seg, 4, 5) === "Adobe";
  if (marker >= 0xe0 && marker <= 0xef) return false;
  return marker !== 0xfe;
}

function stripJpeg(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let orientation = 1;
  let i = 2;
  let jfif = false;
  let ended = false;
  while (!ended) {
    if (i >= b.length || b[i] !== 0xff) return null;
    while (i < b.length && b[i] === 0xff) i++;
    if (i >= b.length) return null;
    const marker = b[i];
    const start = i - 1;
    i++;
    if (marker === 0xd9) {
      parts.push(b.subarray(start, i));
      ended = true;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(b.subarray(start, i));
      continue;
    }
    if (i + 2 > b.length) return null;
    const len = (b[i] << 8) | b[i + 1];
    if (len < 2 || i + len > b.length) return null;
    const seg = b.subarray(start, i + len);
    i += len;
    if (marker === 0xe1 && ascii(seg, 4, 6) === "Exif\0\0") orientation = exifOrientation(seg);
    if (keepJpegSegment(marker, seg)) {
      parts.push(seg);
      if (marker === 0xe0) jfif = true;
    }
    if (marker === 0xda) {
      const from = i;
      while (i + 1 < b.length && !(b[i] === 0xff && b[i + 1] !== 0x00 && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7))) i++;
      if (i + 1 >= b.length) {
        parts.push(b.subarray(from), new Uint8Array([0xff, 0xd9]));
        ended = true;
      } else {
        parts.push(b.subarray(from, i));
      }
    }
  }
  if (orientation !== 1) parts.splice(jfif ? 2 : 1, 0, orientationSegment(orientation));
  return concat(parts);
}

const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD"]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function stripPng(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let orientation = 1;
  let i = 8;
  for (;;) {
    if (i + 12 > b.length) return null;
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) return null;
    if (type === "eXIf") orientation = orientationOf(tiffOf(b.subarray(i + 8, i + 8 + len)));
    if (PNG_KEEP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  if (orientation !== 1 && parts.length > 1) parts.splice(2, 0, pngChunk("eXIf", orientationTiff(orientation)));
  return concat(parts);
}

function stripWebp(b: Uint8Array): Uint8Array | null {
  const chunks: Uint8Array[] = [];
  const limit = Math.min(b.length, 8 + ((b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0));
  let orientation = 1;
  let vp8x: Uint8Array | null = null;
  let i = 12;
  while (i + 8 <= limit) {
    const fourcc = ascii(b, i, 4);
    const len = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > limit) return null;
    if (fourcc === "EXIF") orientation = orientationOf(tiffOf(b.subarray(i + 8, i + 8 + len)));
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const chunk = b.slice(i, Math.min(end, b.length));
      if (fourcc === "VP8X" && chunk.length > 8) {
        chunk[8] &= ~0x0c;
        vp8x = chunk;
      }
      chunks.push(chunk);
    }
    i = end;
  }
  if (!chunks.length) return null;
  if (orientation !== 1 && vp8x) {
    vp8x[8] |= 0x08;
    const tiff = orientationTiff(orientation);
    chunks.push(concat([new Uint8Array([0x45, 0x58, 0x49, 0x46, tiff.length, 0, 0, 0]), tiff]));
  }
  const body = concat(chunks);
  const size = body.length + 4;
  const head = new Uint8Array([0x52, 0x49, 0x46, 0x46, size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff, 0x57, 0x45, 0x42, 0x50]);
  return concat([head, body]);
}

export function stripImageMetadata(b: Uint8Array, type: "image/jpeg" | "image/png" | "image/webp"): Uint8Array | null {
  if (type === "image/jpeg") return stripJpeg(b);
  if (type === "image/png") return stripPng(b);
  return stripWebp(b);
}

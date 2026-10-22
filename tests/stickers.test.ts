import { describe, expect, it } from "vitest";
import { isValidStickerCode, newStickerCode, normaliseStickerCode, stickerCodeFromScan, STICKER_ALPHABET } from "@/lib/stickers";

describe("sticker codes", () => {
  it("mints codes in the XXXX-XX format with no look-alike characters", () => {
    for (let i = 0; i < 200; i++) {
      const code = newStickerCode();
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{2}$/);
      expect([...code.replace("-", "")].every((c) => STICKER_ALPHABET.includes(c))).toBe(true);
      expect(isValidStickerCode(code)).toBe(true);
    }
  });

  it("accepts a typed code in any case or spacing", () => {
    const code = newStickerCode();
    const typed = code.toLowerCase().replace("-", " ");
    expect(normaliseStickerCode(typed)).toBe(code);
    expect(isValidStickerCode(typed)).toBe(true);
  });

  it("catches a one-character typo with the check character", () => {
    const code = newStickerCode();
    const first = code[0];
    const swapped = STICKER_ALPHABET[(STICKER_ALPHABET.indexOf(first) + 1) % STICKER_ALPHABET.length];
    expect(isValidStickerCode(swapped + code.slice(1))).toBe(false);
  });

  it("rejects look-alikes and wrong lengths", () => {
    expect(isValidStickerCode("HX0K-7Q")).toBe(false); // 0 is never printed
    expect(isValidStickerCode("HX4K-7")).toBe(false);
    expect(isValidStickerCode("")).toBe(false);
  });

  it("reads a code from the QR's URL or from a bare code", () => {
    const code = newStickerCode();
    expect(stickerCodeFromScan(`https://tradesura.com/s/${code}`)).toBe(code);
    expect(stickerCodeFromScan(`https://tradesura.com/s/${code}?utm=x`)).toBe(code);
    expect(stickerCodeFromScan(code)).toBe(code);
    expect(stickerCodeFromScan("https://example.com/something-else")).toBeNull();
  });
});

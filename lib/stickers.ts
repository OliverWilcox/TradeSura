// Section 4 — pre-printed QR boiler stickers. A sticker carries a unique code
// and nothing else (no address); the engineer links it to a Home Passport at
// the job, and whoever scans it next lands on /s/{code}.
//
// Code format: XXXX-XC, e.g. HX4K-7Q. Five random characters plus one check
// character, from an alphabet with no look-alikes (no 0/O, 1/I/L), so a code
// typed from a grubby boiler case either resolves or is caught as a typo.
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { settingInt } from "@/lib/ratings";
import { appUrl } from "@/lib/app-url";

export const STICKER_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LOW_STOCK_KEY = "sticker_low_stock";
const DEFAULT_LOW_STOCK = 5;

function checkChar(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += (i + 1) * STICKER_ALPHABET.indexOf(body[i]);
  return STICKER_ALPHABET[sum % STICKER_ALPHABET.length];
}

/** Upper-cases, drops spaces/dashes, re-inserts the dash: "hx4k 7q" → "HX4K-7Q". */
export function normaliseStickerCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 6 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

export function isValidStickerCode(raw: string): boolean {
  const code = normaliseStickerCode(raw);
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{2}$/.test(code)) return false;
  const body = code.replace("-", "").slice(0, 5);
  if ([...body].some((c) => !STICKER_ALPHABET.includes(c))) return false;
  return checkChar(body) === code.at(-1);
}

export function newStickerCode(): string {
  let body = "";
  for (let i = 0; i < 5; i++) body += STICKER_ALPHABET[crypto.randomInt(STICKER_ALPHABET.length)];
  const s = body + checkChar(body);
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/**
 * What the camera read → a sticker code. The printed QR holds the sticker's
 * URL (…/s/HX4K-7Q); a bare code works too. Null if neither.
 */
export function stickerCodeFromScan(scanned: string): string | null {
  const t = scanned.trim();
  const fromUrl = t.match(/\/s\/([A-Za-z0-9-]{6,8})\/?(?:[?#].*)?$/);
  const code = normaliseStickerCode(fromUrl ? fromUrl[1] : t);
  return isValidStickerCode(code) ? code : null;
}

export function stickerUrl(code: string): string {
  return `${appUrl()}/s/${code}`;
}

export async function stickerStock(engineerId: string): Promise<{ left: number; low: boolean }> {
  const [left, threshold] = await Promise.all([
    prisma.sticker.count({ where: { engineerId, passportId: null } }),
    settingInt(LOW_STOCK_KEY, DEFAULT_LOW_STOCK),
  ]);
  return { left, low: left <= threshold };
}

export type LinkResult =
  | { ok: true; code: string }
  | { ok: false; status: 400 | 404 | 409; error: string };

/** Ties a sticker to a passport. Re-linking the same sticker to the same home is a no-op. */
export async function linkSticker(engineerId: string, rawCode: string, passportId: string): Promise<LinkResult> {
  const code = normaliseStickerCode(rawCode);
  if (!isValidStickerCode(code)) {
    return { ok: false, status: 400, error: "That isn't a sticker code — check it and try again (it looks like HX4K-7Q)." };
  }
  const sticker = await prisma.sticker.findUnique({ where: { code } });
  if (!sticker) return { ok: false, status: 404, error: `We can't find sticker ${code}. Check the code on the sticker.` };
  if (sticker.engineerId && sticker.engineerId !== engineerId) {
    return { ok: false, status: 409, error: "That sticker is from another engineer's pack." };
  }
  if (sticker.passportId === passportId) return { ok: true, code };
  if (sticker.passportId) {
    return { ok: false, status: 409, error: "That sticker is already linked to another home. Use a fresh one." };
  }
  const updated = await prisma.sticker.updateMany({
    where: { code, passportId: null },
    data: { passportId, linkedAt: new Date(), engineerId },
  });
  if (updated.count === 0) return { ok: false, status: 409, error: "That sticker was just linked somewhere else." };
  return { ok: true, code };
}

/** Mints `count` unused codes allocated to an engineer (the member pack). */
export async function mintStickers(engineerId: string, count: number): Promise<string[]> {
  const codes: string[] = [];
  while (codes.length < count) {
    const code = newStickerCode();
    const created = await prisma.sticker
      .create({ data: { code, engineerId } })
      .then(() => true)
      .catch(() => false); // collision with an existing code — draw again
    if (created) codes.push(code);
  }
  return codes;
}

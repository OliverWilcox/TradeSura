import { put } from "@vercel/blob";
import { z } from "zod";

// Gas Safe ID card photo → Blob under an unguessable path. Shared by the
// engineer's own upload and the owner adding a staff engineer (Build Review 2,
// section 8: the owner uploads each staff member's card).
const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic"]);

export async function storeGasSafeCard(
  base64: string,
  mimeType: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!ALLOWED_TYPES.has(mimeType)) return { ok: false, error: "Use a JPEG or PNG photo." };
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    return { ok: false, error: "That photo couldn't be used — try taking it again." };
  }
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const blob = await put(`gas-safe-cards/card.${ext}`, buffer, {
    access: "public",
    contentType: mimeType,
    addRandomSuffix: true,
  });
  return { ok: true, url: blob.url };
}

const YEARS_AHEAD = 5;

/**
 * The card's expiry date as the app sends it (YYYY-MM-DD), as a UTC date. A
 * date that's passed, or more than five years off (a typo), is refused.
 */
export const cardExpiry = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((s) => new Date(`${s}T00:00:00Z`))
  .refine((d) => {
    if (Number.isNaN(d.getTime())) return false;
    const today = new Date(new Date().toISOString().slice(0, 10));
    const limit = new Date(today);
    limit.setUTCFullYear(limit.getUTCFullYear() + YEARS_AHEAD);
    return d >= today && d <= limit;
  });

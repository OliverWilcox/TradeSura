import { del, get, put } from "@vercel/blob";
import { z } from "zod";
import { sniffImage, stripImageMetadata } from "@/lib/image-metadata";

// Gas Safe ID card photo → a private Blob store. Shared by the engineer's own
// upload and the owner adding a staff engineer (Build Review 2, section 8: the
// owner uploads each staff member's card).
const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "image/heif"]);
const UNUSABLE = "That photo couldn't be used — try taking it again.";

const cardToken = () => process.env.CARD_BLOB_READ_WRITE_TOKEN?.trim() || undefined;

export type CleanCard = { ok: true; bytes: Uint8Array; type: "image/jpeg" | "image/png" | "image/webp" } | { ok: false; error: string };

export function cleanCardPhoto(buffer: Uint8Array, declaredType: string, maxBytes = MAX_BYTES): CleanCard {
  if (!ALLOWED_TYPES.has(declaredType.toLowerCase())) return { ok: false, error: "Use a JPEG or PNG photo." };
  if (buffer.length === 0) return { ok: false, error: UNUSABLE };
  if (buffer.length > maxBytes) return { ok: false, error: "That photo is too big. Use one under 3 MB." };
  const type = sniffImage(buffer);
  if (type === "image/heic") return { ok: false, error: "That photo is in HEIC format, which can't be checked. Take the photo with the camera in the app, or use a JPEG or PNG." };
  if (type === "image/avif") return { ok: false, error: "That photo is in AVIF format, which can't be checked. Use a JPEG or PNG." };
  if (!type) return { ok: false, error: UNUSABLE };
  const bytes = stripImageMetadata(buffer, type);
  if (!bytes) return { ok: false, error: UNUSABLE };
  return { ok: true, bytes, type };
}

export function bothSidesTooBig(front: string, back?: string): string | null {
  if (!back) return null;
  return Buffer.byteLength(front, "base64") + Buffer.byteLength(back, "base64") > MAX_BYTES ? "The two photos are too big together. Keep them under 3 MB in all." : null;
}

export async function storeGasSafeCard(
  base64: string,
  mimeType: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const clean = cleanCardPhoto(Buffer.from(base64, "base64"), mimeType);
  if (!clean.ok) return clean;
  const ext = clean.type === "image/png" ? "png" : clean.type === "image/webp" ? "webp" : "jpg";
  if (!cardToken()) {
    console.error("[gas-safe-card] CARD_BLOB_READ_WRITE_TOKEN isn't set, so card photos can't be stored.");
    return { ok: false, error: "We couldn't save your photo just now. Try again in a few minutes." };
  }
  try {
    const blob = await put(`gas-safe-cards/card.${ext}`, Buffer.from(clean.bytes), {
      access: "private",
      contentType: clean.type,
      addRandomSuffix: true,
      token: cardToken(),
    });
    return { ok: true, url: blob.url };
  } catch (err) {
    console.error("[gas-safe-card] the private card store refused the photo:", err);
    return { ok: false, error: "We couldn't save your photo just now. Try again in a few minutes." };
  }
}

export const isPrivateCardUrl = (url: URL) => url.protocol === "https:" && url.hostname.endsWith(".private.blob.vercel-storage.com");

export async function readPrivateCard(url: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  const found = await get(url, { access: "private", token: cardToken(), useCache: false, abortSignal: AbortSignal.timeout(10_000) });
  if (!found || found.statusCode !== 200) return null;
  const bytes = await new Response(found.stream).arrayBuffer();
  return { bytes, type: (found.blob.contentType ?? "").split(";")[0].trim().toLowerCase() };
}

export async function removeCardPhoto(url: string) {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  await del(url, isPrivateCardUrl(parsed) ? { token: cardToken() } : undefined);
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

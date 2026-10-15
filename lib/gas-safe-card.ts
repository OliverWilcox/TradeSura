import { put } from "@vercel/blob";

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

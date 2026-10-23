import { put } from "@vercel/blob";

// Section 4 — Home Passport photos (service, boiler). Stored as a public Blob
// behind an unguessable path; only the homeowner's passport link and the
// engineer who took it ever show the URL.
const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic"]);

export async function storePassportPhoto(
  base64: string,
  mimeType: string,
): Promise<{ url: string } | { error: string }> {
  if (!ALLOWED_TYPES.has(mimeType)) return { error: "Use a JPEG or PNG photo." };
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    return { error: "That photo couldn't be used — try taking it again." };
  }
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const blob = await put(`passport-photos/photo.${ext}`, buffer, {
    access: "public",
    contentType: mimeType,
    addRandomSuffix: true,
  });
  return { url: blob.url };
}

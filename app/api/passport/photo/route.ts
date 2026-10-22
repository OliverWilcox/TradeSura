import { NextResponse } from "next/server";
import { z } from "zod";
import { put } from "@vercel/blob";
import { getActor } from "@/lib/auth";

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic"]);

const Body = z.object({ base64: z.string().min(1), mimeType: z.string().min(1) });

// Section 4 — a service or boiler photo for a Home Passport. Base64 JSON,
// not multipart (same RN FormData bug as the logo upload). Stored as a
// public Blob behind an unguessable path; only the homeowner's passport
// link and the engineer who took it ever show the URL.
export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add a photo." }, { status: 400 });
  const { base64, mimeType } = parsed.data;
  if (!ALLOWED_TYPES.has(mimeType)) return NextResponse.json({ error: "Use a JPEG or PNG photo." }, { status: 400 });
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: "That photo couldn't be used — try taking it again." }, { status: 400 });
  }
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const blob = await put(`passport-photos/photo.${ext}`, buffer, {
    access: "public",
    contentType: mimeType,
    addRandomSuffix: true,
  });
  return NextResponse.json({ url: blob.url });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";

const MAX_BYTES = 6 * 1024 * 1024;
const MAX_PROFILE_PHOTOS = 4;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const Add = z.object({ base64: z.string().min(1), mimeType: z.string().min(1) });
const Remove = z.object({ url: z.string().url().max(500) });

// Section 8 — "a couple of photos" for the public profile (van, team, a tidy
// install). Base64 JSON, same as the logo and Gas Safe card uploads (RN's
// multipart bridge is broken on this Expo SDK — see app/api/settings/logo).
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Add.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Attach a photo." }, { status: 400 });
  const { base64, mimeType } = parsed.data;
  if (!ALLOWED_TYPES.has(mimeType)) {
    return NextResponse.json({ error: "Use a JPEG or PNG photo." }, { status: 400 });
  }
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: "That photo is too big — try another." }, { status: 400 });
  }
  const e = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId }, select: { profilePhotos: true } });
  if (e.profilePhotos.length >= MAX_PROFILE_PHOTOS) {
    return NextResponse.json({ error: `Up to ${MAX_PROFILE_PHOTOS} photos — remove one first.` }, { status: 400 });
  }
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const blob = await put(`profile-photos/${engineerId}.${ext}`, buffer, {
    access: "public",
    contentType: mimeType,
    addRandomSuffix: true,
  });
  const updated = await prisma.engineer.update({
    where: { id: engineerId },
    data: { profilePhotos: { push: blob.url } },
    select: { profilePhotos: true },
  });
  return NextResponse.json({ photos: updated.profilePhotos });
}

export async function DELETE(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Remove.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a photo." }, { status: 400 });
  const e = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId }, select: { profilePhotos: true } });
  if (!e.profilePhotos.includes(parsed.data.url)) {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }
  const photos = e.profilePhotos.filter((p) => p !== parsed.data.url);
  await prisma.engineer.update({ where: { id: engineerId }, data: { profilePhotos: photos } });
  await del(parsed.data.url).catch((err) => console.error("[profile-photos] blob delete failed:", err));
  return NextResponse.json({ photos });
}

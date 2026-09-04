import { NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function extFor(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

// Review #15 — replaces the old "Logo URL" text field. Engineers upload the
// image directly (mobile image picker or the web settings form); we store
// it and serve it from our own Blob store instead of asking for a hosted
// URL most engineers don't have.
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach an image." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Use a PNG, JPEG, or WEBP image." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That image is too big (5MB max)." }, { status: 400 });
  }

  const engineer = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { logoUrl: true },
  });

  const blob = await put(`logos/${engineerId}-${Date.now()}.${extFor(file.type)}`, file, {
    access: "public",
    contentType: file.type,
  });

  await prisma.engineer.update({ where: { id: engineerId }, data: { logoUrl: blob.url } });

  // Best-effort cleanup of the previous upload — only if it was one of ours;
  // an old hand-entered URL from before this feature existed is left alone.
  if (engineer?.logoUrl?.includes(".public.blob.vercel-storage.com/")) {
    await del(engineer.logoUrl).catch(() => {});
  }

  return NextResponse.json({ ok: true, logoUrl: blob.url });
}

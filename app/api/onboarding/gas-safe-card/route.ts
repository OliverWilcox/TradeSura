import { NextResponse } from "next/server";
import { z } from "zod";
import { put } from "@vercel/blob";
import { signToken, verifyToken } from "@/lib/auth";

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic"]);

const Body = z.object({
  phoneToken: z.string().min(1),
  base64: z.string().min(1),
  mimeType: z.string().min(1),
});

// Signup step 2 — the Gas Safe ID-card photo, one of the two legs of the
// verification position (29 Sept review). No account exists yet at step 2,
// so the upload is authorised by the verified-phone token from step 1
// rather than a session. Returns a short-lived signed token naming the
// stored photo; /api/auth/request attaches it to the new account, which is
// what puts the engineer into the admin verification queue.
//
// Base64 JSON, not multipart — same RN FormData bug as the logo upload
// (see app/api/settings/logo/route.ts).
//
// ponytail: the photo is a public Blob behind an unguessable random path,
// same store as logos. Move to a private Blob store before real engineers'
// ID cards go through this.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Add a photo of your Gas Safe ID card." }, { status: 400 });
  }
  const phone = await verifyToken(parsed.data.phoneToken);
  if (phone?.verified !== "1" || !phone.phone) {
    return NextResponse.json(
      { error: "Phone verification expired — go back and verify your mobile number again." },
      { status: 400 },
    );
  }
  const { base64, mimeType } = parsed.data;
  if (!ALLOWED_TYPES.has(mimeType)) {
    return NextResponse.json({ error: "Use a JPEG or PNG photo." }, { status: 400 });
  }
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    return NextResponse.json(
      { error: "That photo couldn't be used — try taking it again." },
      { status: 400 },
    );
  }
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const blob = await put(`gas-safe-cards/card.${ext}`, buffer, {
    access: "public",
    contentType: mimeType,
    addRandomSuffix: true,
  });
  const cardToken = await signToken({ cardUrl: blob.url, phone: phone.phone }, "2h");
  return NextResponse.json({ cardToken });
}

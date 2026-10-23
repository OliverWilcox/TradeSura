import { NextResponse } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/auth";
import { storePassportPhoto } from "@/lib/passport-photo";

const Body = z.object({ base64: z.string().min(1), mimeType: z.string().min(1) });

// Section 4 — a service or boiler photo for a Home Passport. Base64 JSON,
// not multipart (same RN FormData bug as the logo upload).
export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add a photo." }, { status: 400 });
  const stored = await storePassportPhoto(parsed.data.base64, parsed.data.mimeType);
  if ("error" in stored) return NextResponse.json({ error: stored.error }, { status: 400 });
  return NextResponse.json({ url: stored.url });
}

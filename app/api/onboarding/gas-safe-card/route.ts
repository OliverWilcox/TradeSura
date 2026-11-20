import { NextResponse } from "next/server";
import { z } from "zod";
import { signToken, verifyToken } from "@/lib/auth";
import { bothSidesTooBig, PhotoSource, storeGasSafeCard } from "@/lib/gas-safe-card";

const Body = z.object({
  phoneToken: z.string().min(1),
  base64: z.string().min(1),
  mimeType: z.string().min(1),
  backBase64: z.string().min(1).optional(),
  backMimeType: z.string().min(1).optional(),
  source: PhotoSource.optional(),
  backSource: PhotoSource.optional(),
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
  const { base64, mimeType, backBase64, backMimeType, source, backSource } = parsed.data;
  const together = bothSidesTooBig(base64, backBase64);
  if (together) return NextResponse.json({ error: together, field: "back" }, { status: 400 });
  const front = await storeGasSafeCard(base64, mimeType);
  if (!front.ok) return NextResponse.json({ error: front.error }, { status: 400 });
  const back = backBase64 && backMimeType ? await storeGasSafeCard(backBase64, backMimeType) : null;
  if (back && !back.ok) return NextResponse.json({ error: back.error, field: "back" }, { status: 400 });
  const cardToken = await signToken(
    { cardUrl: front.url, ...(source ? { source } : {}), ...(back?.ok ? { backUrl: back.url, ...(backSource ? { backSource } : {}) } : {}), phone: phone.phone },
    "2h",
  );
  return NextResponse.json({ cardToken });
}

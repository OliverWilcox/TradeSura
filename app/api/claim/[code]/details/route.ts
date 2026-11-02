import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { normaliseUkPhone } from "@/lib/phone";
import { townSlugOf } from "@/lib/town";
import { addressError, addressText, claimForPage, claimLookupLimited, requestIp } from "@/lib/claim";

// 30 Oct update §1.3 — "Confirm your details to secure your spot". The
// trading address sets their home town (never the registered office); post
// goes to the correspondence address when they give one. Saving it is the
// reservation (ClaimCode.claimedAt), which the Founding badge counts.
const Address = z.object({ line1: z.string().max(160), town: z.string().max(80), postcode: z.string().max(10) });
const Body = z.object({
  trading: Address,
  postElsewhere: z.boolean().default(false),
  correspondence: Address.optional(),
  mobile: z.string().max(20),
  consent: z.boolean(),
});

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (await claimLookupLimited(requestIp(req.headers))) {
    return NextResponse.json({ error: "Too many tries. Wait a few minutes and try again." }, { status: 429 });
  }
  const row = await claimForPage((await params).code);
  if (!row) return NextResponse.json({ error: "That code isn't recognised." }, { status: 404 });
  if (row.redeemedByEngineerId) {
    return NextResponse.json({ error: "This code already has an account. Sign in to the app instead." }, { status: 409 });
  }
  // Codes are guessable, so confirmed details can't be overwritten from the
  // page: someone else's mobile would then get the code. The person who
  // claimed it changes anything in the app, after their text code.
  if (row.claimedAt) {
    return NextResponse.json({ error: "These details are already confirmed. Use the link in your text." }, { status: 409 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check your details and try again." }, { status: 400 });
  const b = parsed.data;

  const tradingErr = addressError(b.trading, "trading address");
  if (tradingErr) return NextResponse.json({ error: tradingErr, field: "trading" }, { status: 400 });
  if (b.postElsewhere) {
    const postErr = addressError(b.correspondence, "postal address");
    if (postErr) return NextResponse.json({ error: postErr, field: "correspondence" }, { status: 400 });
  }
  const mobile = normaliseUkPhone(b.mobile);
  if (!mobile || !mobile.startsWith("+447")) {
    return NextResponse.json({ error: "Enter a UK mobile number, like 07700 900123.", field: "mobile" }, { status: 400 });
  }
  if (!b.consent) {
    return NextResponse.json({ error: "Tick the box so we can text you your code.", field: "consent" }, { status: 400 });
  }

  const town = b.trading.town.trim();
  const now = new Date();
  await prisma.claimCode.update({
    where: { code: row.code },
    data: {
      tradingAddress: addressText(b.trading),
      tradingTown: town,
      tradingTownSlug: townSlugOf(town) || null,
      correspondenceAddress: b.postElsewhere && b.correspondence ? addressText(b.correspondence) : null,
      mobile,
      textConsentAt: now,
      // Saving is the reservation (Founding badge, §10).
      claimedAt: now,
    },
  });
  await track("claim_step", { type: "SYSTEM" }, { code: row.code, step: "form_completed", variantCell: row.variantCell });
  return NextResponse.json({ ok: true, town });
}

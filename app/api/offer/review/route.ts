import { NextResponse } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/auth";
import { normaliseUkPhone } from "@/lib/phone";
import { requestContactCode, verifyContactCode, VerificationError } from "@/lib/contact-verification";
import { sessionForBusiness, submitOfferReview } from "@/lib/offer-session";

// 30 Oct update §6.4 — "Before I go, would you leave me a quick review?",
// asked on the installer's phone after the plans. A customer who didn't join
// confirms a mobile or email with a code first; no review without one.
const Code = z.object({
  action: z.literal("code"),
  token: z.string().min(1),
  phone: z.string().max(20).optional(),
  email: z.string().email().max(200).optional(),
});
const Submit = z.object({
  action: z.literal("submit"),
  token: z.string().min(1),
  stars: z.number().int(),
  comment: z.string().max(1000).optional(),
  acknowledged: z.boolean().optional(),
  name: z.string().max(120).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().max(200).optional(),
  requestToken: z.string().optional(),
  code: z.string().optional(),
  consent: z.boolean().default(true),
});
const Body = z.discriminatedUnion("action", [Code, Submit]);

export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the form and try again." }, { status: 400 });
  const b = parsed.data;
  if (!(await sessionForBusiness(b.token, actor.businessId))) {
    return NextResponse.json({ error: "This offer has expired — start a new one." }, { status: 404 });
  }

  try {
    if (b.action === "code") {
      const phone = b.phone ? normaliseUkPhone(b.phone) : null;
      if (b.phone && !phone) throw new VerificationError("That doesn't look like a UK mobile number.");
      if (phone) return NextResponse.json(await requestContactCode("review-sms", phone, { offer: b.token, phone }));
      if (b.email) {
        const email = b.email.trim().toLowerCase();
        return NextResponse.json(await requestContactCode("review-email", email, { offer: b.token, email }));
      }
      throw new VerificationError("Enter your mobile or email.");
    }

    // A code proves the contact it was sent to, for this offer only.
    let verifiedPhone: string | null = null;
    let verifiedEmail: string | null = null;
    if (b.requestToken && b.code) {
      const purpose = b.phone ? "review-sms" : "review-email";
      const proof = await verifyContactCode(b.requestToken, b.code, purpose);
      if (proof.offer !== b.token) throw new VerificationError("That code was for another review — ask for a new one.");
      verifiedPhone = typeof proof.phone === "string" ? proof.phone : null;
      verifiedEmail = typeof proof.email === "string" ? proof.email : null;
    }
    const result = await submitOfferReview(b.token, actor.businessId, {
      stars: b.stars,
      comment: b.comment,
      acknowledged: b.acknowledged,
      name: b.name,
      phone: b.phone,
      email: b.email,
      verifiedPhone,
      verifiedEmail,
      consent: b.consent,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, emergency: result.emergency }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof VerificationError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

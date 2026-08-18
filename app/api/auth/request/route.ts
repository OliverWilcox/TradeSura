import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { signToken, verifyToken } from "@/lib/auth";
import { uniqueSlug } from "@/lib/slug";
import { track } from "@/lib/track";

// Everything the sign-up wizard (steps 1-3) collects.
const SignupData = z.object({
  firstName: z.string().min(2).max(60),
  lastName: z.string().min(2).max(60),
  phoneToken: z.string().min(1), // from /api/onboarding/phone/verify
  trades: z.array(z.string().max(40)).max(10).default([]),
  // Required, not optional: Gas Safe is the only live trade right now, so
  // it's mandatory at sign-up — enforced here too, not just client-side,
  // same pattern as the wording blocklist re-check on tier save.
  gasSafeNo: z.string().min(1).max(20),
  gasSafeName: z.string().min(1).max(120),
  gasSafeCompany: z.string().min(1).max(120),
  gasSafeCategories: z.string().min(1).max(200),
  tradingName: z.string().min(2).max(80),
  businessType: z.enum(["sole_trader", "ltd", "partnership"]),
  companyNumber: z.string().max(20).optional(),
  postcode: z.string().min(4).max(10),
  marketingConsent: z.boolean().default(false),
});

const Body = z.object({
  email: z.string().email().max(200),
  signup: SignupData.optional(),
});

// [DECISION — human, instant-login] No email click-through: this endpoint
// authenticates and returns a live bearer token directly instead of emailing
// a magic link. For sign-up that's a deliberate trade — phone number (OTP)
// and Gas Safe registration are both already verified by this point, so the
// email step was only ever the token-minting mechanism, not an identity
// check. For plain sign-in (no `signup` payload) this means knowing an
// engineer's email address is now sufficient on its own to obtain a session
// for their account — there is no possession-of-inbox or password check left
// anywhere in this flow. Revisit before any real engineer/customer data is
// at stake; this is fine for the current pre-launch, sandbox-only stage.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  let engineer = await prisma.engineer.findUnique({ where: { email } });
  let trades: string[] = [];

  if (!engineer) {
    if (!parsed.data.signup) {
      return NextResponse.json({ error: "No account found for that email." }, { status: 404 });
    }
    const { phoneToken, ...rest } = parsed.data.signup;
    // The phone itself is never trusted from the client directly — only the
    // number embedded in a token that /api/onboarding/phone/verify signed
    // after a real code match, so a client can't claim an unverified number.
    const phonePayload = await verifyToken(phoneToken);
    if (phonePayload?.verified !== "1" || !phonePayload.phone) {
      return NextResponse.json(
        { error: "Phone verification expired — go back and verify your mobile number again." },
        { status: 400 },
      );
    }
    trades = rest.trades;
    const slug = await uniqueSlug(email.split("@")[0]);
    engineer = await prisma.engineer.create({
      data: {
        email,
        slug,
        firstName: rest.firstName,
        lastName: rest.lastName,
        phone: phonePayload.phone,
        phoneVerifiedAt: new Date(),
        tradingName: rest.tradingName,
        businessType: rest.businessType,
        companyNumber: rest.companyNumber,
        postcode: rest.postcode,
        marketingConsent: rest.marketingConsent,
        gasSafeNo: rest.gasSafeNo,
        gasSafeName: rest.gasSafeName,
        gasSafeCompany: rest.gasSafeCompany,
        gasSafeCategories: rest.gasSafeCategories,
        gasSafeVerifiedAt: new Date(),
      },
    });
    await track("engineer_signed_up", { type: "ENGINEER", id: engineer.id }, { slug });
  }

  const token = await signToken({ engineerId: engineer.id }, "30d");
  return NextResponse.json({ token, trades });
}

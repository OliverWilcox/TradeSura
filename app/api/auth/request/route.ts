import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { signToken, verifyToken } from "@/lib/auth";
import { uniqueSlug } from "@/lib/slug";
import { track } from "@/lib/track";
import { normaliseClaimCode, resolveClaimCode } from "@/lib/claim";

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
  // E1 — "How did you hear about us?" + optional referral code. Pre-filled and
  // hidden when arriving from a claim/referral link (Blocks 2 & 4).
  attribution: z
    .object({
      heardVia: z.enum(["letter", "engineer", "online", "other"]).optional(),
      referralCode: z.string().max(40).optional(),
      letterBatch: z.string().max(40).optional(),
      variantCell: z.string().max(8).optional(),
    })
    .optional(),
  // C5 — letter claim code, resolved + redeemed server-side.
  claimCode: z.string().max(20).optional(),
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

    // Resolve a claim code (C5): fold the letter cell into attribution so it
    // reaches the account, even if the client didn't pass it explicitly.
    const claim = rest.claimCode ? await resolveClaimCode(rest.claimCode) : null;
    const attribution: Record<string, string> = {};
    if (rest.attribution?.heardVia) attribution.heardVia = rest.attribution.heardVia;
    if (rest.attribution?.referralCode) attribution.referralCode = rest.attribution.referralCode;
    if (rest.attribution?.letterBatch) attribution.letterBatch = rest.attribution.letterBatch;
    if (rest.attribution?.variantCell) attribution.variantCell = rest.attribution.variantCell;
    if (claim?.valid) {
      attribution.heardVia = "letter";
      attribution.letterBatch = claim.letterBatch;
      attribution.variantCell = claim.variantCell;
    }
    if (!attribution.heardVia) attribution.heardVia = "other";

    // Review #13 — a Gas Safe number can only back one account. Checked here
    // (not just left to the DB's unique constraint) so the failure is a
    // clear, actionable message instead of a raw 500.
    if (rest.gasSafeNo) {
      const dupe = await prisma.engineer.findUnique({ where: { gasSafeNo: rest.gasSafeNo } });
      if (dupe) {
        return NextResponse.json(
          { error: "This licence is already registered — sign in instead?", code: "duplicate_gas_safe_no" },
          { status: 409 },
        );
      }
    }

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
        attribution,
      },
    });
    await track("engineer_signed_up", { type: "ENGINEER", id: engineer.id }, {
      slug,
      heardVia: attribution.heardVia,
      referralCode: attribution.referralCode,
      letterBatch: attribution.letterBatch,
      variantCell: attribution.variantCell,
    });

    if (rest.claimCode && claim?.valid) {
      await prisma.claimCode
        .update({
          where: { code: normaliseClaimCode(rest.claimCode) },
          data: { redeemedByEngineerId: engineer.id, redeemedAt: new Date() },
        })
        .catch(() => {
          // Already redeemed by another account — attribution is still on this
          // engineer's record, which is what the split test measures.
        });
    }

    // E10 — link the referrer by slug (self-referral is ignored).
    if (attribution.referralCode) {
      const referrer = await prisma.engineer.findUnique({
        where: { slug: attribution.referralCode.toLowerCase() },
      });
      if (referrer && referrer.id !== engineer.id) {
        engineer = await prisma.engineer.update({
          where: { id: engineer.id },
          data: { referrerId: referrer.id },
        });
        await track("referral_signup", { type: "ENGINEER", id: engineer.id }, {
          referrerId: referrer.id,
        });
        await track("referral_signup", { type: "ENGINEER", id: referrer.id }, {
          inviteeId: engineer.id,
        });
      }
    }
  }

  const token = await signToken({ engineerId: engineer.id }, "30d");
  return NextResponse.json({ token, trades });
}

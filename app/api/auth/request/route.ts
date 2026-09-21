import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { signToken, verifyToken } from "@/lib/auth";
import { uniqueSlug } from "@/lib/slug";
import { track } from "@/lib/track";
import { normaliseClaimCode, resolveClaimCode } from "@/lib/claim";
import { sendEmail } from "@/lib/email";
import { engineerWelcomeEmailHtml } from "@/lib/engineer-welcome-email";
import { notifyEngineer } from "@/lib/sms";
import { sendPushNotification } from "@/lib/push";

// Everything the sign-up wizard (steps 1-3) collects.
const SignupData = z.object({
  firstName: z.string().min(2).max(60),
  lastName: z.string().min(2).max(60),
  phoneToken: z.string().min(1), // from /api/onboarding/phone/verify
  trades: z.array(z.string().max(40)).max(10).default([]),
  // The regNo is required — Gas Safe is the only live trade right now, so
  // it's mandatory at sign-up, same pattern as the wording blocklist
  // re-check on tier save. Name/company/categories are only present when
  // the number matched the register; review #11's escape hatch lets an
  // engineer continue on an unmatched number, flagged for manual review
  // instead of dead-ended (see gasSafeReviewRequested below).
  gasSafeNo: z.string().min(1).max(20),
  gasSafeName: z.string().max(120).optional(),
  gasSafeCompany: z.string().max(120).optional(),
  gasSafeCategories: z.string().max(200).optional(),
  gasSafeReviewRequested: z.boolean().optional(),
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
    // Build Guide v2 Part 13 — the public address derives from the trading
    // name, never the email local part ("today's /p/info/… is the bug").
    // /api/settings and /api/onboarding already got this right when a
    // trading name changes later; this was the one place still keying off
    // the email.
    const slug = await uniqueSlug(rest.tradingName);

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
        // review #11 — a real register match verifies immediately; an
        // unmatched number the engineer chose to continue with (the
        // manual-review escape hatch) is flagged pending instead.
        gasSafeVerifiedAt: rest.gasSafeReviewRequested ? null : new Date(),
        gasSafeReviewRequestedAt: rest.gasSafeReviewRequested ? new Date() : null,
        attribution,
      },
    });
    // Build Guide v2 Part 6.4 — "Badge-granted is one event with four
    // effects: push notification ... → strip flips to quiet active →
    // avatar gets its tick → member-pack shipment fires." This is that
    // event, for the immediate-register-match path. In practice this call
    // almost always no-ops today — push permission is asked "after the
    // first plan goes live" (Part 11), well after signup, so there's no
    // token to send to yet — but it's the correct trigger point per spec,
    // and free to include since sendPushNotification no-ops silently
    // without a registered token. The other place gasSafeVerifiedAt is set
    // (app/api/onboarding/route.ts) fires the same event; a future
    // manual-review-resolution path (review #11's escape hatch has no
    // admin UI yet — see verification-state.ts) will need to call this too
    // once one exists.
    if (!rest.gasSafeReviewRequested) {
      await sendPushNotification(
        engineer.id,
        "You're verified",
        "You're Gas Safe verified — your member pack is on its way",
      );
    }
    await track("engineer_signed_up", { type: "ENGINEER", id: engineer.id }, {
      slug,
      heardVia: attribution.heardVia,
      referralCode: attribution.referralCode,
      letterBatch: attribution.letterBatch,
      variantCell: attribution.variantCell,
    });

    engineerWelcomeEmailHtml(engineer.id)
      .then(({ subject, html }) => sendEmail({ to: email, subject, html }))
      .catch((err) => {
        // Best-effort — a missed welcome email isn't worth failing signup over.
        console.error("[signup] welcome email failed:", err);
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
        // review #6 — the £50-paid ping already existed (checkReferralBounty);
        // this is the earlier "signed up" stage ping the review also asked for.
        await notifyEngineer(
          referrer.id,
          `👋 ${engineer.tradingName?.trim() || engineer.firstName || "Someone"} just signed up with your referral link.`,
        );
      }
    }
  }

  const token = await signToken({ engineerId: engineer.id }, "30d");
  return NextResponse.json({ token, trades });
}

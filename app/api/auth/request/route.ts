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
import {
  COMPANY_NUMBER,
  GAS_SAFE_NO,
  UK_POSTCODE,
  normaliseCompanyNumber,
  normalisePostcode,
} from "@/lib/validate";

// Everything the sign-up wizard (steps 1-3) collects.
const SignupData = z.object({
  firstName: z.string().min(2).max(60),
  lastName: z.string().min(2).max(60),
  phoneToken: z.string().min(1), // from /api/onboarding/phone/verify
  trades: z.array(z.string().max(40)).max(10).default([]),
  // The regNo is required — Gas Safe is the only live trade right now.
  // 29 Sept review: verification is "Submit for verification" into the
  // admin queue — a legal position, not styling — so signup never grants
  // the badge itself, whatever the register says. The ID-card photo arrives
  // as a token from /api/onboarding/gas-safe-card. Optional here only so
  // builds that predate the card step can still sign up; the current app
  // requires it before step 2 continues.
  gasSafeNo: z.string().max(20).transform((v) => v.replace(/\s/g, "")).pipe(z.string().regex(GAS_SAFE_NO)),
  gasSafeCardToken: z.string().max(2000).optional(),
  tradingName: z.string().min(2).max(80),
  businessType: z.enum(["sole_trader", "ltd", "partnership"]),
  companyNumber: z.string().max(20).optional(),
  postcode: z
    .string()
    .max(10)
    .transform(normalisePostcode)
    .pipe(z.string().regex(UK_POSTCODE)),
  marketingConsent: z.boolean().default(false),
  // E1 — "How did you hear about us?" + optional referral code. Pre-filled and
  // hidden when arriving from a claim/referral link (Blocks 2 & 4).
  attribution: z
    .object({
      heardVia: z.enum(["letter", "email", "engineer", "online", "other"]).optional(),
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
  signup: SignupData.superRefine((d, ctx) => {
    // Company number: format-checked always, required for a limited company.
    const n = d.companyNumber ? normaliseCompanyNumber(d.companyNumber) : "";
    if (d.businessType === "ltd" && !n) {
      ctx.addIssue({ code: "custom", path: ["companyNumber"], message: "required" });
    } else if (n && !COMPANY_NUMBER.test(n)) {
      ctx.addIssue({ code: "custom", path: ["companyNumber"], message: "format" });
    }
  }).optional(),
});

// Plain-English messages for the fields the app also checks — a server
// rejection names the field instead of a generic "check the form".
const FIELD_MESSAGES: Record<string, string> = {
  gasSafeNo: "Gas Safe numbers are 6 or 7 digits.",
  postcode: "Enter a full UK postcode, like HD9 2TT.",
  companyNumber: "Company numbers are 8 characters, like 12345678 or SC123456.",
  tradingName: "Enter your trading name.",
  firstName: "Enter your first name.",
  lastName: "Enter your last name.",
};

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
    const issue = parsed.error.issues[0];
    const field = issue?.path[0] === "signup" ? String(issue.path[1] ?? "") : "email";
    return NextResponse.json(
      {
        error: FIELD_MESSAGES[field] ?? "Enter a valid email address.",
        field,
      },
      { status: 400 },
    );
  }
  const email = parsed.data.email.toLowerCase();

  let engineer = await prisma.engineer.findUnique({ where: { email } });
  let trades: string[] = [];

  // Signing up with an email that already has an account used to fall
  // straight through to "sign in as that account" — the signup data was
  // silently dropped. Now it's a clear, handled state.
  if (engineer && parsed.data.signup) {
    return NextResponse.json(
      { error: "This email already has an account — sign in instead.", code: "email_taken", field: "email" },
      { status: 409 },
    );
  }

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
    let gasSafeCardUrl: string | null = null;
    if (rest.gasSafeCardToken) {
      const card = await verifyToken(rest.gasSafeCardToken);
      if (!card?.cardUrl || card.phone !== phonePayload.phone) {
        return NextResponse.json(
          { error: "Your ID card photo expired — take it again on step 2.", field: "gasSafeCard" },
          { status: 400 },
        );
      }
      gasSafeCardUrl = card.cardUrl;
    }

    if (rest.gasSafeNo) {
      const dupe = await prisma.engineer.findUnique({ where: { gasSafeNo: rest.gasSafeNo } });
      if (dupe) {
        return NextResponse.json(
          {
            error: "This Gas Safe number is already registered — sign in instead?",
            code: "duplicate_gas_safe_no",
            field: "gasSafeNo",
          },
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
        companyNumber:
          rest.businessType === "ltd" && rest.companyNumber
            ? normaliseCompanyNumber(rest.companyNumber)
            : null,
        postcode: rest.postcode,
        marketingConsent: rest.marketingConsent,
        gasSafeNo: rest.gasSafeNo,
        gasSafeCardUrl,
        // Into the admin queue — the badge is granted by a person
        // (app/admin/verifications), never by signup.
        gasSafeReviewRequestedAt: new Date(),
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

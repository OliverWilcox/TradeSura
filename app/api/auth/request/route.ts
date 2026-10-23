import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { companyDisplayName } from "@/lib/engineer";
import { verifyToken } from "@/lib/auth";
import { issueSignInCode, maskEmail, sessionToken, signInCodesEnabled } from "@/lib/sign-in-code";
import { uniqueSlug } from "@/lib/slug";
import { track } from "@/lib/track";
import { normaliseClaimCode, resolveClaimCode } from "@/lib/claim";
import { sendEmail } from "@/lib/email";
import { engineerWelcomeEmailHtml } from "@/lib/engineer-welcome-email";
import { notifyEngineer } from "@/lib/sms";
import { sendPushNotification } from "@/lib/push";
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
  emailToken: z.string().min(1),
  smsSignInEnabled: z.boolean().default(false),
  phoneToken: z.string().min(1), // from /api/onboarding/phone/verify
  trades: z.array(z.string().max(40)).max(10).default([]),
  // The regNo is required — Gas Safe is the only live trade right now.
  // 29 Sept review: verification is "Submit for verification" into the
  // admin queue — a legal position, not styling — so signup never grants
  // the badge itself, whatever the register says. The ID-card photo arrives
  // as a token from /api/onboarding/gas-safe-card. Optional here only so
  // builds that predate the card step can still sign up; the current app
  // requires it before step 2 continues.
  gasSafeNo: z
    .string()
    .max(20)
    .transform((v) => v.replace(/\s/g, ""))
    .pipe(z.string().regex(GAS_SAFE_NO)),
  gasSafeCardToken: z.string().max(2000).optional(),
  // Build Review 3, section 2 — required for a sole trader; a limited
  // company (or partnership) with a Companies House name may leave it blank
  // and trade under that name. Length is checked in the refine below.
  tradingName: z.string().trim().max(80).default(""),
  businessType: z.enum(["sole_trader", "ltd", "partnership"]),
  companyNumber: z.string().max(20).optional(),
  // Companies House company_status, when picked from the lookup.
  companyStatus: z.string().max(40).optional(),
  // The registered company name from the Companies House lookup — stored as
  // Engineer.legalName ("MW Heating is a trading name of Tradesura Ltd").
  legalName: z.string().trim().max(160).optional(),
  // "Are you the only owner of the company?" (Build Review 3, section 7).
  soleOwner: z.boolean().optional(),
  postcode: z.string().max(10).transform(normalisePostcode).pipe(z.string().regex(UK_POSTCODE)),
  // 4 Oct notes, step 3.1 — correspondence address (PAF lookup); the member
  // pack ships here once the badge is live.
  addressLine1: z.string().trim().max(160).optional(),
  town: z.string().trim().max(80).optional(),
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
  // "Continue with Apple" — from /api/auth/apple; links the Apple id.
  appleToken: z.string().max(2000).optional(),
});

const Body = z.object({
  email: z.string().email().max(200),
  signup: SignupData.superRefine((d, ctx) => {
    if (d.tradingName.length < 2 && !(d.businessType !== "sole_trader" && (d.legalName?.length ?? 0) >= 2)) {
      ctx.addIssue({ code: "custom", path: ["tradingName"], message: "required" });
    }
    // Company number: format-checked always, required for a limited company.
    const n = d.companyNumber ? normaliseCompanyNumber(d.companyNumber) : "";
    if (d.businessType === "ltd" && !n) {
      ctx.addIssue({
        code: "custom",
        path: ["companyNumber"],
        message: "required",
      });
    } else if (n && !COMPANY_NUMBER.test(n)) {
      ctx.addIssue({
        code: "custom",
        path: ["companyNumber"],
        message: "format",
      });
    }
  }).optional(),
});

// Every rejectable signup field → what to tell the engineer, and which form
// field the app should point at. Anything missing from here used to fall
// back to "Enter a valid email address." — so a missing email-verification
// token on a perfectly good gmail address blamed the email (7 Oct).
type FieldError = { error: string; field: string; code?: string };
const FIELD_ERRORS: Record<string, FieldError> = {
  email: { error: "Enter a valid email address.", field: "email" },
  firstName: { error: "Enter your first name.", field: "firstName" },
  lastName: { error: "Enter your last name.", field: "lastName" },
  emailToken: {
    error: "Your email isn't verified yet — go back to step 1 and enter the code we email you.",
    field: "email",
    code: "email_unverified",
  },
  phoneToken: {
    error: "Your mobile isn't verified yet — go back to step 1 and verify it again.",
    field: "phone",
    code: "phone_unverified",
  },
  smsSignInEnabled: {
    error: "Choose how you'd like to sign in on step 1, then try again.",
    field: "phone",
  },
  gasSafeNo: { error: "Gas Safe numbers are 1 to 7 digits.", field: "gasSafeNo" },
  gasSafeCardToken: {
    error: "Your ID card photo didn't come through — add it again on step 2.",
    field: "gasSafeCard",
  },
  trades: { error: "Check the trades you picked on step 1, then try again.", field: "email" },
  tradingName: { error: "Enter your trading name.", field: "tradingName" },
  businessType: { error: "Choose your business type.", field: "tradingName" },
  companyNumber: {
    error: "Company numbers are 8 characters, like 12345678 or SC123456.",
    field: "companyNumber",
  },
  companyStatus: { error: "Find your company again, or enter its number instead.", field: "companyNumber" },
  legalName: { error: "Find your company again, or enter its number instead.", field: "companyNumber" },
  soleOwner: { error: "Tell us whether you're the only owner of the company.", field: "companyNumber" },
  postcode: { error: "Enter a full UK postcode, like HD9 2TT.", field: "postcode" },
  addressLine1: { error: "That address line is too long — shorten it.", field: "postcode" },
  town: { error: "That town name is too long — shorten it.", field: "postcode" },
};
// Fields with no form field of their own (consent, attribution, claim and
// Apple links) — a specific reason, never a misleading field.
const OTHER_ERRORS: Record<string, string> = {
  marketingConsent: "Tick or untick the tips box again, then try again.",
  attribution: "Check “How did you hear about us?” and any referral code, then try again.",
  claimCode: "That letter code didn't go through — try again, or carry on without it.",
  appleToken: "Your Apple sign-in expired — go back and tap Continue with Apple again.",
};

// An app build from before email verification (7 Oct) never sends
// emailToken at all — no amount of retrying fixes that, only updating.
const APP_OUTDATED: FieldError = {
  error: "Please update TradeSura to the latest version, then create your account.",
  field: "email",
  code: "app_outdated",
};

function signupError(
  issue: { path: PropertyKey[] } | undefined,
  raw: unknown,
): FieldError | { error: string } {
  if (!issue || issue.path[0] !== "signup") return FIELD_ERRORS.email;
  const key = String(issue.path[1] ?? "");
  const sent = (raw as { signup?: Record<string, unknown> } | null)?.signup ?? {};
  if (key === "emailToken" && sent.emailToken === undefined) return APP_OUTDATED;
  if (FIELD_ERRORS[key]) return FIELD_ERRORS[key];
  return { error: OTHER_ERRORS[key] ?? CREATE_FAILED };
}

export const PHONE_TAKEN = "This mobile is already registered. Sign in instead?";
// 4 Oct build notes — the wording when the server has no specific reason.
const CREATE_FAILED =
  "We couldn't create your account. Please try again — if it keeps happening, email info@tradesura.com";

function uniqueTarget(err: unknown): string | null {
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e?.code !== "P2002") return null;
  return JSON.stringify(e.meta?.target ?? "");
}

// Sign-up returns a live session directly — the phone (OTP) and Gas Safe
// details are already checked by then. Plain sign-in no longer does: since
// the 4 Oct build notes (section 2) it emails a 4-digit code, verified at
// /api/auth/verify, unless SIGNIN_CODES=off (see lib/sign-in-code.ts).
export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    console.warn(`[signup] rejected field: ${issue?.path.join(".") || "(body)"}`);
    return NextResponse.json(signupError(issue, raw), { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  let engineer = await prisma.engineer.findUnique({ where: { email } });
  let trades: string[] = [];

  // Signing up with an email that already has an account used to fall
  // straight through to "sign in as that account" — the signup data was
  // silently dropped. Now it's a clear, handled state.
  if (engineer && parsed.data.signup) {
    return NextResponse.json(
      {
        error: "This email already has an account — sign in instead.",
        code: "email_taken",
        field: "email",
      },
      { status: 409 },
    );
  }

  if (!engineer) {
    if (!parsed.data.signup) {
      // 4 Oct notes, section 4.1 — a friendly dead end, not a wall.
      return NextResponse.json(
        {
          error: "We can't find an account for that email. Check the spelling, or create a free account.",
          code: "no_account",
        },
        { status: 404 },
      );
    }
    const { phoneToken, ...rest } = parsed.data.signup;
    // The phone itself is never trusted from the client directly — only the
    // number embedded in a token that /api/onboarding/phone/verify signed
    // after a real code match, so a client can't claim an unverified number.
    const phonePayload = await verifyToken(phoneToken);
    if (phonePayload?.verified !== "1" || !phonePayload.phone) {
      return NextResponse.json(
        {
          error: "Your mobile verification has expired — go back to step 1 and verify it again.",
          field: "phone",
          code: "phone_unverified",
        },
        { status: 400 },
      );
    }
    // Verification tokens last 30 minutes — one each for "expired", "the
    // email was changed after verifying", and "SMS sign-in never texted".
    const emailProof = await verifyToken(rest.emailToken);
    if (emailProof?.emailVerified !== "1") {
      return NextResponse.json(
        {
          error: "Your email verification has expired — go back to step 1 and enter a new code.",
          field: "email",
          code: "email_unverified",
        },
        { status: 400 },
      );
    }
    if (emailProof.email !== email || emailProof.phone !== phonePayload.phone) {
      return NextResponse.json(
        {
          error: "Your email or mobile changed after you verified it — go back to step 1 and verify again.",
          field: "email",
          code: "email_unverified",
        },
        { status: 400 },
      );
    }
    if (rest.smsSignInEnabled && (phonePayload.texted !== "1" || phonePayload.email !== email)) {
      return NextResponse.json(
        {
          error: "Signing in by text needs your mobile verified by text — go back to step 1 and verify it.",
          field: "phone",
          code: "phone_unverified",
        },
        { status: 400 },
      );
    }
    trades = rest.trades;
    // Build Guide v2 Part 13 — the public address derives from the trading
    // name, never the email local part ("today's /p/info/… is the bug").
    // /api/settings and /api/onboarding already got this right when a
    // trading name changes later; this was the one place still keying off
    // the email.
    // Blank trading name on a company = trade under the Companies House name.
    const legalName = rest.businessType !== "sole_trader" ? rest.legalName || null : null;
    const tradingName =
      rest.tradingName.length >= 2 ? rest.tradingName : legalName ? companyDisplayName(legalName) : rest.tradingName;
    const slug = await uniqueSlug(tradingName);

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
          {
            error: "Your ID card photo expired — take it again on step 2.",
            field: "gasSafeCard",
          },
          { status: 400 },
        );
      }
      gasSafeCardUrl = card.cardUrl;
    }

    // Only an Apple id our own /api/auth/apple signed after checking Apple's
    // identity token — never one the client names directly.
    let appleSub: string | null = null;
    if (rest.appleToken) {
      const apple = await verifyToken(rest.appleToken);
      if (!apple?.appleSub) {
        return NextResponse.json(
          {
            error:
              "Your Apple sign-in expired — tap Continue with Apple again, or carry on with email.",
            field: "email",
          },
          { status: 400 },
        );
      }
      if (
        await prisma.engineer.findUnique({
          where: { appleSub: apple.appleSub },
        })
      ) {
        return NextResponse.json(
          {
            error: "This Apple ID already has an account — sign in instead.",
            code: "email_taken",
            field: "email",
          },
          { status: 409 },
        );
      }
      appleSub = apple.appleSub;
    }

    if (rest.gasSafeNo) {
      const dupe = await prisma.engineer.findUnique({
        where: { gasSafeNo: rest.gasSafeNo },
      });
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

    // 4 Oct build notes, P0 — Matt's signup died at "Create my free account"
    // because his mobile was already on another account: the unique index
    // threw and the app showed "Something went wrong". Step 1 now catches it
    // (/api/onboarding/phone/start); this is the backstop.
    if (await prisma.engineer.findUnique({ where: { phone: phonePayload.phone } })) {
      return NextResponse.json(
        { error: PHONE_TAKEN, code: "phone_taken", field: "phone" },
        { status: 409 },
      );
    }

    try {
      engineer = await prisma.engineer.create({
        data: {
          email,
          slug,
          firstName: rest.firstName,
          lastName: rest.lastName,
          phone: phonePayload.phone,
          // Only a real text proves the mobile (4 Oct notes, step 1.1).
        emailVerifiedAt: new Date(),
        smsSignInEnabled: rest.smsSignInEnabled,
        phoneVerifiedAt: phonePayload.texted === "1" ? new Date() : null,
          appleSub,
          tradingName,
          legalName,
          soleOwner: rest.businessType === "ltd" ? (rest.soleOwner ?? null) : null,
          businessType: rest.businessType,
          companyNumber:
            rest.businessType === "ltd" && rest.companyNumber
              ? normaliseCompanyNumber(rest.companyNumber)
              : null,
          companyStatus: rest.businessType === "ltd" ? (rest.companyStatus ?? null) : null,
          postcode: rest.postcode,
        ...(rest.addressLine1
          ? {
              packAddress: [rest.addressLine1, rest.town, rest.postcode].filter(Boolean).join("\n"),
              // Queued, not shipped — the admin "packs to post" list only
              // shows it once the badge is granted (Part 17.4).
              packRequestedAt: new Date(),
            }
          : {}),
          marketingConsent: rest.marketingConsent,
          gasSafeNo: rest.gasSafeNo,
          gasSafeCardUrl,
          // Into the admin queue — the badge is granted by a person
          // (app/admin/verifications), never by signup.
          gasSafeReviewRequestedAt: new Date(),
          attribution,
        },
      });
    } catch (err) {
      // A race on any unique field (email, phone, Gas Safe no., Apple ID)
      // still gets a message that names it — never a bare 500.
      const target = uniqueTarget(err);
      if (target) {
        const known: Record<string, { error: string; field: string; code: string }> = {
          email: {
            error: "This email already has an account — sign in instead.",
            field: "email",
            code: "email_taken",
          },
          phone: { error: PHONE_TAKEN, field: "phone", code: "phone_taken" },
          gasSafeNo: {
            error: "This Gas Safe number is already registered — sign in instead?",
            field: "gasSafeNo",
            code: "duplicate_gas_safe_no",
          },
          appleSub: {
            error: "This Apple ID already has an account — sign in instead.",
            field: "email",
            code: "email_taken",
          },
        };
        const k = Object.keys(known).find((f) => target.includes(f));
        if (k) return NextResponse.json(known[k], { status: 409 });
      }
      console.error("[signup] create failed:", err);
      return NextResponse.json({ error: CREATE_FAILED }, { status: 500 });
    }
    await track(
      "engineer_signed_up",
      { type: "ENGINEER", id: engineer.id },
      {
        slug,
        heardVia: attribution.heardVia,
        referralCode: attribution.referralCode,
        letterBatch: attribution.letterBatch,
        variantCell: attribution.variantCell,
      },
    ).catch(() => {
      console.error("[signup] account created, but signup event could not be recorded");
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

    try {
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
        await track(
          "referral_signup",
          { type: "ENGINEER", id: engineer.id },
          {
            referrerId: referrer.id,
          },
        );
        await track(
          "referral_signup",
          { type: "ENGINEER", id: referrer.id },
          {
            inviteeId: engineer.id,
          },
        );
        // review #6 — the "now earning" ping lives in recordReferralEarning;
        // this is the earlier "signed up" stage ping the review also asked for.
        await notifyEngineer(
          referrer.id,
          `👋 ${engineer.tradingName?.trim() || engineer.firstName || "Someone"} just signed up with your referral link.`,
        );
        await sendPushNotification(
          referrer.id,
          "Referral signed up",
          `${engineer.tradingName?.trim() || engineer.firstName || "Someone"} just signed up with your referral link.`,
          { url: "/referral" },
        );
      }
    }
    } catch {
      console.error("[signup] account created, but referral follow-up failed");
    }
  }

  // Plain sign-in (no signup payload): a 4-digit code to their email first —
  // knowing an address is no longer enough to open the account (4 Oct
  // notes, section 2). Signup itself is already proven by the phone check.
  if (!parsed.data.signup && signInCodesEnabled()) {
    const issued = await issueSignInCode(engineer);
    if (!issued.ok) return NextResponse.json({ error: issued.error }, { status: issued.status });
    return NextResponse.json({
      codeSent: true,
      requestToken: issued.requestToken,
      maskedEmail: maskEmail(engineer.email),
      ...(issued.devCode ? { devCode: issued.devCode } : {}),
    });
  }

  const token = await sessionToken(engineer.id);
  return NextResponse.json({ token, trades });
}

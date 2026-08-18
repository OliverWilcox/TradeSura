import { NextResponse } from "next/server";
import { z } from "zod";
import { signToken, verifyToken } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

// Everything the sign-up wizard (steps 1-3) collects, bundled into the
// magic-link token itself so mobile-callback can create a fully-populated
// Engineer on first click — no separate "pending signup" table needed, same
// stateless pattern as the token itself. Returning users calling this route
// for a plain sign-in just omit `signup` entirely.
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

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  let pending: string | undefined;
  if (parsed.data.signup) {
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
    pending = JSON.stringify({ ...rest, phone: phonePayload.phone });
  }

  const token = await signToken({ email, ...(pending ? { pending } : {}) }, "15m");
  // Only the Expo app signs in now — the callback mints a bearer token and
  // hands it back via the app's deep-link scheme (see mobile-callback).
  const link = `${process.env.APP_URL}/api/auth/mobile-callback?token=${token}`;

  await sendEmail({
    to: email,
    subject: pending ? "Confirm your TradeSura account" : "Sign in to TradeSura",
    html: `<p>Tap to ${pending ? "finish creating your" : "sign in to your"} TradeSura account:</p><p><a href="${link}">${link}</a></p><p>This link is valid for 15 minutes.</p>`,
  });

  // lib/email.ts has no real provider wired up yet (console-log stub only,
  // in every environment) — surface the link directly until one exists.
  // NODE_ENV isn't the right gate here: Vercel always builds in production
  // mode, so that check silently dropped the only way to reach the link.
  return NextResponse.json({ ok: true, devLink: link });
}

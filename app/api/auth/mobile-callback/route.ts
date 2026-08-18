import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signToken, verifyToken } from "@/lib/auth";
import { track } from "@/lib/track";
import { uniqueSlug } from "@/lib/slug";

type PendingSignup = {
  firstName: string;
  lastName: string;
  phone: string;
  trades: string[];
  gasSafeNo: string;
  gasSafeName: string;
  gasSafeCompany: string;
  gasSafeCategories: string;
  tradingName: string;
  businessType: string;
  companyNumber?: string;
  postcode: string;
  marketingConsent: boolean;
};

// The engineer magic-link callback — mints a bearer token for the Expo app
// and hands it back via the app's deep-link scheme (see mobile/app.json
// "scheme"), rather than a cookie, since the engineer surface is mobile-only.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const payload = token ? await verifyToken(token) : null;
  if (!payload?.email) {
    return NextResponse.redirect("tradesura://auth-callback?error=expired");
  }

  let engineer = await prisma.engineer.findUnique({ where: { email: payload.email } });
  let trades: string[] = [];
  if (!engineer) {
    const slug = await uniqueSlug(payload.email.split("@")[0]);
    // Sign-up wizard bundles every step's fields into this token (see
    // /api/auth/request) so the account is created fully-populated on first
    // click — no separate "pending signup" storage needed.
    const pending: PendingSignup | null = payload.pending ? JSON.parse(payload.pending) : null;
    trades = pending?.trades ?? [];

    engineer = await prisma.engineer.create({
      data: {
        email: payload.email,
        slug,
        ...(pending && {
          firstName: pending.firstName,
          lastName: pending.lastName,
          phone: pending.phone,
          phoneVerifiedAt: new Date(),
          tradingName: pending.tradingName,
          businessType: pending.businessType,
          companyNumber: pending.companyNumber,
          postcode: pending.postcode,
          marketingConsent: pending.marketingConsent,
          gasSafeNo: pending.gasSafeNo,
          gasSafeName: pending.gasSafeName,
          gasSafeCompany: pending.gasSafeCompany,
          gasSafeCategories: pending.gasSafeCategories,
          gasSafeVerifiedAt: new Date(),
        }),
      },
    });
    await track("engineer_signed_up", { type: "ENGINEER", id: engineer.id }, { slug });
  }

  const bearerToken = await signToken({ engineerId: engineer.id }, "30d");
  const tradesParam = trades.length ? `&trades=${encodeURIComponent(trades.join(","))}` : "";
  return NextResponse.redirect(`tradesura://auth-callback?token=${bearerToken}${tradesParam}`);
}

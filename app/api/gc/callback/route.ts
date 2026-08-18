import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyToken } from "@/lib/auth";
import { exchangeOAuthCode } from "@/lib/gocardless";

// GoCardless's OAuth redirect target — always hands control back to the Expo
// app via its deep-link scheme (see /api/gc/connect-url, which is the only
// initiator of this flow now that the engineer surface is mobile-only).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const payload = state ? await verifyToken(state) : null;
  const fail = (reason: string) => NextResponse.redirect(`tradesura://onboarding?gc=${reason}`);

  if (!code || !state) return fail("denied");
  if (!payload?.engineerId) return fail("bad_state");

  try {
    const { access_token, organisation_id } = await exchangeOAuthCode(code);
    await prisma.engineer.update({
      where: { id: payload.engineerId },
      data: { gcAccessToken: access_token, gcOrganisationId: organisation_id },
    });
  } catch {
    // Token exchange details are never logged (they can carry secrets).
    return fail("exchange_failed");
  }
  return NextResponse.redirect("tradesura://onboarding?gc=connected");
}

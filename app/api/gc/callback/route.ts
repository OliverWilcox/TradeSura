import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyToken } from "@/lib/auth";
import { exchangeOAuthCode } from "@/lib/gocardless";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const fail = (reason: string) =>
    NextResponse.redirect(`${process.env.APP_URL}/onboarding?gc=${reason}`);

  if (!code || !state) return fail("denied");
  const payload = await verifyToken(state);
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
  return NextResponse.redirect(`${process.env.APP_URL}/onboarding?gc=connected`);
}

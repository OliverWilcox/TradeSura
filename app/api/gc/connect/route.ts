import { NextResponse } from "next/server";
import { getEngineerId, signToken } from "@/lib/auth";
import { gcConfigured, oauthAuthorizeUrl } from "@/lib/gocardless";

export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.redirect(`${process.env.APP_URL}/signin`);
  if (!gcConfigured()) {
    return NextResponse.redirect(`${process.env.APP_URL}/onboarding?gc=missing_creds`);
  }
  const state = await signToken({ engineerId }, "15m");
  return NextResponse.redirect(oauthAuthorizeUrl(state));
}

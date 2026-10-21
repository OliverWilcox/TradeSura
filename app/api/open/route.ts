import { NextResponse } from "next/server";

// Email links can't be tradesura:// — Gmail and Outlook drop custom schemes.
// Emails link here instead, and this bounces to the app's deep link (same
// trick as stripe/connect-return). Only known screens, never an open redirect.
const SCREENS = new Set(["onboarding", "plans", "plan-wizard", "referral", "profile", "website"]);

export async function GET(req: Request) {
  const to = new URL(req.url).searchParams.get("to") ?? "";
  return NextResponse.redirect(`tradesura://${SCREENS.has(to) ? to : ""}`);
}

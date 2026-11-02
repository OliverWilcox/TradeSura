import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth";
import { sessionToken } from "@/lib/sign-in-code";

// 30 Oct update 3.5 — "Stay logged in". Sessions last 180 days from
// sign-in; the app swaps its token for a fresh one now and then while it's
// being used, so a phone that's in use never has to sign in again. A sign-in
// code is only needed on a new phone or after signing out. getActor()
// re-checks the account (deleted, staff removed) before renewing.
export async function POST() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  return NextResponse.json({ token: await sessionToken(actor.actorId) });
}

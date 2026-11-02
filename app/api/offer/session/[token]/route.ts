import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth";
import { sessionStatus } from "@/lib/offer-session";

// The review screen asks: did the customer join on this offer, and with
// which details? Joiners' details carry into the review (30 Oct §6.4).
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { token } = await ctx.params;
  const status = await sessionStatus(token, actor.businessId);
  if (!status) return NextResponse.json({ error: "This offer has expired — start a new one." }, { status: 404 });
  return NextResponse.json(status);
}

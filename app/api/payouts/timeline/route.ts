import { NextResponse } from "next/server";
import { getEngineerId } from "@/lib/auth";
import { timelineView } from "@/lib/pending-payout";

// Matt, 30 Oct §9.3 — the joins › cooling-off › collection › Bacs › Friday
// timeline, with real dates, for the payment screen and the Payouts tab.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json(await timelineView(engineerId));
}

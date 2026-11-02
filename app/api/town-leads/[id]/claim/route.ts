import { NextResponse } from "next/server";
import { getEngineerId } from "@/lib/auth";
import { LeadError, claimTownLead } from "@/lib/town-leads";

// First to claim gets the homeowner's details (as an Enquiry).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json({ ok: true, lead: await claimTownLead(engineerId, id) });
  } catch (e) {
    if (e instanceof LeadError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[town-lead] claim failed:", e);
    return NextResponse.json({ error: "Couldn't claim that — try again." }, { status: 503 });
  }
}

import { NextResponse } from "next/server";
import { getEngineerId } from "@/lib/auth";
import { townLeadsFor } from "@/lib/town-leads";

// Homeowner requests in the engineer's town they can claim right now.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ leads: await townLeadsFor(engineerId) });
}

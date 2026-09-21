import { NextResponse } from "next/server";
import { z } from "zod";
import { getEngineerId } from "@/lib/auth";

const Body = z.object({ postcode: z.string().min(4).max(10) });

export type LookedUpAddress = {
  line1: string;
  line2?: string;
  town: string;
  postcode: string;
};

// Build Guide v2 Part 17.3 — "PAF address lookup: one shared component used
// everywhere an address appears (signup, pack order, route 3, checkout, and
// every future flow). Provider is your pick: getAddress / Ideal Postcodes /
// Loqate / Postcoder. API key server-side." No provider is wired up yet —
// this ships the mechanism and contract every caller uses, with an always-
// present manual fallback, so plugging in a real key later is a one-file
// change (this route) and nothing downstream moves.
//
// ADDRESS_LOOKUP_API_KEY unset → `configured: false`, no addresses; every
// caller is expected to fall back to manual entry (Part 17.3's acceptance
// criterion explicitly requires that fallback to exist regardless).
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a postcode." }, { status: 400 });
  }

  if (!process.env.ADDRESS_LOOKUP_API_KEY) {
    return NextResponse.json({ configured: false, addresses: [] as LookedUpAddress[] });
  }

  // A provider goes here once ADDRESS_LOOKUP_API_KEY is set — deliberately
  // not stubbed with a fake response; wiring a real provider is a human
  // decision (which service, contract, pricing) that shouldn't be quietly
  // pre-empted by a placeholder here.
  return NextResponse.json({ configured: false, addresses: [] as LookedUpAddress[] });
}

import { NextResponse } from "next/server";
import { getEngineerId } from "@/lib/auth";
import { TIER_PRESETS } from "@/lib/clauses";

// The builder's starter chips (Boiler Care / Service + Priority / Landlord).
// Served rather than copied into the app so the clause lists stay server-owned.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json(
    TIER_PRESETS.map((p) => ({
      name: p.name,
      priceMonthlyPence: p.priceMonthlyPence,
      clauseCodes: [...p.clauseCodes],
    })),
  );
}

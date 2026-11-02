import { NextResponse } from "next/server";
import { getEngineerId } from "@/lib/auth";
import { TIER_PRESETS } from "@/lib/clauses";

// The builder's starter chips (30 Oct §5: Service / Care / Complete, plus
// Landlord). Served rather than copied into the app so the clause lists stay
// server-owned. No price: plans start with a blank price.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json(
    TIER_PRESETS.map((p) => ({
      label: p.label,
      name: p.name,
      clauseCodes: [...p.clauseCodes],
    })),
  );
}

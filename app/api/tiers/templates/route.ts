import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";

// Build Guide v2 Part 7.1 — the option library, on its own, for the wizard's
// Step 1 before a plan has an id yet (a brand-new draft). Once a plan
// exists, GET /api/tiers/[tierId] returns the same list alongside its own
// selection; this is the id-less counterpart for a fresh "Create a new plan".
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // CARE clauses stay out of the picker until solicitor sign-off (handover §3).
  const templates = await prisma.clauseTemplate.findMany({
    where: { status: "SAFE" },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(
    templates.map((t) => ({
      id: t.id,
      code: t.code,
      title: t.title,
      kind: t.kind,
      category: t.category,
      upliftPence: t.upliftPence,
      pricingLabel: t.pricingLabel,
      highlight: t.highlight,
      note: t.note,
      engineerNote: t.engineerNote,
      bodyText: t.bodyText,
    })),
  );
}

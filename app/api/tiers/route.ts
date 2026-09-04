import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { CLAUSE_TEMPLATES, TIER_PRESETS } from "@/lib/clauses";

// Mobile counterpart to the tier list query in app/plans/page.tsx.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const tiers = await prisma.planTier.findMany({
    where: { engineerId, archived: false },
    orderBy: { sortOrder: "asc" },
    include: { clauses: { include: { clause: true } }, _count: { select: { plans: true } } },
  });
  return NextResponse.json(
    tiers.map((t) => ({
      id: t.id,
      name: t.name,
      priceMonthlyPence: t.priceMonthlyPence,
      isRecommended: t.isRecommended,
      customLabels: t.customLabels,
      clauseTitles: t.clauses.map((tc) => tc.clause.title),
      planCount: t._count.plans,
    })),
  );
}

// POST /api/tiers { preset: true } → create the 3 recommended tiers (two-tap).
// POST /api/tiers {} → create one blank tier.
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clauses = await prisma.clauseTemplate.findMany();
  const byCode = new Map(clauses.map((c) => [c.code, c.id]));

  const existing = await prisma.planTier.count({ where: { engineerId, archived: false } });
  if (existing >= 3) {
    return NextResponse.json({ error: "You already have three tiers." }, { status: 400 });
  }

  if (body.preset) {
    const created = [];
    for (const [i, p] of TIER_PRESETS.entries()) {
      const tier = await prisma.planTier.create({
        data: {
          engineerId,
          name: p.name,
          priceMonthlyPence: p.priceMonthlyPence,
          isRecommended: p.isRecommended,
          sortOrder: i,
          clauses: {
            create: p.clauseCodes.map((code) => ({ clauseId: byCode.get(code)! })),
          },
        },
      });
      await track("tier_created", { type: "ENGINEER", id: engineerId }, {
        tierId: tier.id,
        name: tier.name,
        priceMonthlyPence: tier.priceMonthlyPence,
        preset: true,
      });
      created.push(tier.id);
    }
    return NextResponse.json({ ok: true, created });
  }

  const core = CLAUSE_TEMPLATES.filter((c) => c.kind === "CORE").map((c) => c.code);
  const tier = await prisma.planTier.create({
    data: {
      engineerId,
      name: `Tier ${existing + 1}`,
      priceMonthlyPence: 1200,
      sortOrder: existing,
      clauses: { create: core.map((code) => ({ clauseId: byCode.get(code)! })) },
    },
  });
  await track("tier_created", { type: "ENGINEER", id: engineerId }, {
    tierId: tier.id,
    name: tier.name,
    priceMonthlyPence: tier.priceMonthlyPence,
    preset: false,
  });
  return NextResponse.json({ ok: true, id: tier.id });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import {
  TIER_PRESETS,
  TIER_PRICE_MIN_PENCE,
  TIER_PRICE_MAX_PENCE,
  cleanRates,
  isPlaceholderName,
  serviceRuleError,
  withRequiredClauses,
} from "@/lib/clauses";
import { goLiveError, rateWordingError } from "@/lib/plan-rules";
import { checkWording } from "@/lib/compliance/blocklist";

// Build Guide v2 Part 7 — "My plans" hub. Every plan the engineer has ever
// started, any status: the hub (not this endpoint) decides whether a draft,
// a live plan or a stopped one gets its own card. There is no "archived and
// hidden" state any more and no cap on how many plans exist.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const tiers = await prisma.planTier.findMany({
    where: { engineerId },
    orderBy: { sortOrder: "asc" },
    include: {
      clauses: { include: { clause: true }, orderBy: { clause: { sortOrder: "asc" } } },
      // "N customers" on the card is live+paused; "ever had a customer" (any
      // status, including cancelled) is what makes a draft undeletable — see
      // Part 7.4's delete rule.
      _count: { select: { plans: true } },
    },
  });
  const activeCounts = await prisma.plan.groupBy({
    by: ["tierId"],
    where: { engineerId, status: { in: ["ACTIVE", "PAUSED"] } },
    _count: true,
  });
  const activeByTier = new Map(activeCounts.map((c) => [c.tierId, c._count]));

  return NextResponse.json(
    tiers.map((t) => ({
      id: t.id,
      name: t.name,
      priceMonthlyPence: t.priceMonthlyPence,
      isRecommended: t.isRecommended,
      status: t.status,
      customLabels: t.customLabels,
      clauseTitles: t.clauses.map((tc) => tc.clause.title),
      activePlanCount: activeByTier.get(t.id) ?? 0,
      everHadCustomer: t._count.plans > 0,
    })),
  );
}

// POST /api/tiers — always creates a DRAFT (Part 7.3: nothing is live until
// "Make this plan live" — see /api/tiers/[tierId]/publish). Pass a full
// wizard payload to create it pre-filled (the wizard's own "keep as draft"
// exit, and quick-start templates); publishNow skips straight to LIVE (the
// wizard's Step 4 "Make this plan live" on a brand-new plan).
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  // R4 — approved options only: options awaiting sign-off can't be added.
  const clauses = await prisma.clauseTemplate.findMany({ where: { status: "SAFE" } });
  const byCode = new Map(clauses.map((c) => [c.code, c.id]));

  // Review 3 — a draft has no name until Step 3; the box starts empty.
  let name = "";
  let priceMonthlyPence = 1200;
  let clauseCodes: string[] = [];

  if (typeof body.template === "string") {
    const p = TIER_PRESETS.find((t) => t.name === body.template);
    if (!p) return NextResponse.json({ error: "Unknown template." }, { status: 400 });
    name = p.name;
    priceMonthlyPence = p.priceMonthlyPence;
    clauseCodes = [...p.clauseCodes];
  }
  if (typeof body.name === "string" && body.name.trim()) name = body.name.trim().slice(0, 28);
  if (Number.isInteger(body.priceMonthlyPence)) priceMonthlyPence = body.priceMonthlyPence;
  if (Array.isArray(body.clauseCodes)) clauseCodes = body.clauseCodes;

  const labels: string[] = Array.isArray(body.customLabels)
    ? body.customLabels.filter((l: unknown): l is string => typeof l === "string")
    : [];
  for (const label of [name, ...labels]) {
    const check = checkWording(label);
    if (!check.ok) {
      return NextResponse.json({ error: "blocked_wording", label, ...check }, { status: 422 });
    }
  }
  const rateWording = rateWordingError(body.clauseRates);
  if (rateWording) return NextResponse.json(rateWording, { status: 400 });
  // Builder Step 4's provision promise is required to go live.
  const publishNow = body.publishNow === true;
  if (publishNow && body.attest !== true) {
    return NextResponse.json(
      { error: "Tick to confirm you'll provide everything in this plan.", code: "attest_required" },
      { status: 400 },
    );
  }

  if (priceMonthlyPence < TIER_PRICE_MIN_PENCE) {
    return NextResponse.json({ error: "The minimum plan price is £10 a month." }, { status: 400 });
  }
  priceMonthlyPence = Math.min(TIER_PRICE_MAX_PENCE, priceMonthlyPence);
  // Part 7.1 LAW — required options are pre-ticked and unremovable. Enforced
  // here too, not just in the picker, so a malformed request can't drop one.
  const finalCodes = withRequiredClauses(clauseCodes).filter((c) => byCode.has(c));
  const ruleError = serviceRuleError(finalCodes);
  if (ruleError) return NextResponse.json({ error: ruleError }, { status: 400 });

  if (typeof body.name === "string" && isPlaceholderName(body.name)) {
    return NextResponse.json({ error: "Give your plan a name customers will understand, like Boiler Care." }, { status: 400 });
  }
  const clauseRates = cleanRates(body.clauseRates);
  if (publishNow) {
    const err = await goLiveError(engineerId, finalCodes, clauseRates, name);
    if (err) return NextResponse.json({ error: err.error, code: err.code }, { status: 400 });
  }

  const existing = await prisma.planTier.count({ where: { engineerId } });
  const tier = await prisma.planTier.create({
    data: {
      engineerId,
      name,
      priceMonthlyPence,
      sortOrder: existing,
      status: publishNow ? "LIVE" : "DRAFT",
      providerAttestedAt: publishNow ? new Date() : null,
      customLabels: labels,
      clauseRates,
      clauses: { create: finalCodes.map((code) => ({ clauseId: byCode.get(code)! })) },
    },
  });
  await track(tier.status === "LIVE" ? "plan_live" : "plan_draft_saved", { type: "ENGINEER", id: engineerId }, {
    tierId: tier.id,
    name: tier.name,
    priceMonthlyPence: tier.priceMonthlyPence,
    template: typeof body.template === "string" ? body.template : undefined,
  });
  const engineer = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { slug: true },
  });
  return NextResponse.json({ ok: true, id: tier.id, status: tier.status, slug: engineer?.slug ?? null });
}

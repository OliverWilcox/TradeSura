import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { checkWording } from "@/lib/compliance/blocklist";
import { rateWordingError } from "@/lib/plan-rules";
import {
  TIER_PRICE_MIN_PENCE,
  TIER_PRICE_MAX_PENCE,
  cleanRates,
  isPlaceholderName,
  serviceRuleError,
  withRequiredClauses,
} from "@/lib/clauses";

const Body = z.object({
  // Empty until Step 3 (the box starts empty); required to go live.
  name: z.string().max(28),
  priceMonthlyPence: z.number().int().min(TIER_PRICE_MIN_PENCE).max(TIER_PRICE_MAX_PENCE),
  clauseCodes: z.array(z.string()).max(20),
  customLabels: z.array(z.string().min(2).max(80)).max(5),
  clauseRates: z.record(z.string(), z.string()).optional(),
});

// One wizard step editor at a time (Part 7.4: "each opening its wizard step
// pre-filled") calls this with the fields it owns and the others unchanged —
// so every field here is independently save-able, not a single all-or-nothing
// form post.
export async function GET(req: Request, ctx: { params: Promise<{ tierId: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { tierId } = await ctx.params;
  const tier = await prisma.planTier.findFirst({
    where: { id: tierId, engineerId },
    include: { clauses: true, _count: { select: { plans: true } } },
  });
  if (!tier) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

  // CARE clauses stay out of the picker until solicitor sign-off (handover §3).
  const templates = await prisma.clauseTemplate.findMany({
    where: { status: "SAFE" },
    orderBy: { sortOrder: "asc" },
  });

  // Customers already on this plan keep the version they agreed (agreedTier
  // snapshot) — the editor surfaces this so a price/clause change doesn't feel
  // like it's rewriting live contracts (Part 7.2's versioning line).
  const activePlanCount = await prisma.plan.count({
    where: { tierId, status: { in: ["ACTIVE", "PAUSED"] } },
  });

  return NextResponse.json({
    activePlanCount,
    everHadCustomer: tier._count.plans > 0,
    tier: {
      id: tier.id,
      name: tier.name,
      priceMonthlyPence: tier.priceMonthlyPence,
      status: tier.status,
      customLabels: tier.customLabels,
      clauseIds: tier.clauses.map((c) => c.clauseId),
      clauseRates: cleanRates(tier.clauseRates),
    },
    templates: templates.map((t) => ({
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
  });
}

// Content only — never touches status. Going live is a separate, explicit
// act (POST .../publish); stopping/starting is another (POST .../status).
export async function PUT(req: Request, ctx: { params: Promise<{ tierId: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { tierId } = await ctx.params;
  const tier = await prisma.planTier.findFirst({ where: { id: tierId, engineerId } });
  if (!tier) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const priceIssue = parsed.error.issues.some((i) => i.path[0] === "priceMonthlyPence");
    return NextResponse.json(
      { error: priceIssue ? "The minimum plan price is £10 a month." : "Check the form and try again." },
      { status: 400 },
    );
  }

  if (tier.status === "LIVE" && parsed.data.name.trim().length < 2) {
    return NextResponse.json({ error: "Give your plan a name — at least 2 characters." }, { status: 400 });
  }
  if (isPlaceholderName(parsed.data.name)) {
    return NextResponse.json({ error: "Give your plan a name customers will understand, like Boiler Care." }, { status: 400 });
  }
  // Locked wording: the plan name and every free-text label pass the
  // blocklist server-side — the app's own check is a convenience, not the gate.
  for (const label of [parsed.data.name, ...parsed.data.customLabels]) {
    const check = checkWording(label);
    if (!check.ok) {
      return NextResponse.json({ error: "blocked_wording", label, ...check }, { status: 422 });
    }
  }
  const rateWording = rateWordingError(parsed.data.clauseRates);
  if (rateWording) return NextResponse.json(rateWording, { status: 400 });

  // Part 7.1 LAW — required (CORE) options are unremovable; union them in
  // rather than trusting the client picker alone.
  // R4 — approved options only. An option withdrawn for legal review (R7)
  // drops out of the plan on its next edit; agreed plans keep their snapshot.
  const withdrawn = new Set(
    (await prisma.clauseTemplate.findMany({ where: { status: { not: "SAFE" } }, select: { code: true } })).map((c) => c.code),
  );
  const wantedCodes = withRequiredClauses(parsed.data.clauseCodes).filter((c) => !withdrawn.has(c));
  const clauses = await prisma.clauseTemplate.findMany({ where: { code: { in: wantedCodes } } });
  // Unknown codes used to be dropped silently, which stripped a plan down to
  // its required line when a client sent ids instead of codes.
  if (clauses.length !== wantedCodes.length) {
    return NextResponse.json({ error: "Some of those options aren't recognised — reopen the plan and try again." }, { status: 400 });
  }
  const ruleError = serviceRuleError(wantedCodes);
  if (ruleError) return NextResponse.json({ error: ruleError }, { status: 400 });

  await prisma.$transaction([
    prisma.tierClause.deleteMany({ where: { tierId } }),
    prisma.planTier.update({
      where: { id: tierId },
      data: {
        name: parsed.data.name,
        priceMonthlyPence: parsed.data.priceMonthlyPence,
        customLabels: parsed.data.customLabels,
        ...(parsed.data.clauseRates ? { clauseRates: cleanRates(parsed.data.clauseRates) } : {}),
        clauses: { create: clauses.map((c) => ({ clauseId: c.id })) },
      },
    }),
  ]);
  await track("plan_edited", { type: "ENGINEER", id: engineerId }, {
    tierId,
    name: parsed.data.name,
    priceMonthlyPence: parsed.data.priceMonthlyPence,
    status: tier.status,
  });
  const engineer = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { slug: true },
  });
  const activePlanCount = await prisma.plan.count({
    where: { tierId, status: { in: ["ACTIVE", "PAUSED"] } },
  });
  return NextResponse.json({
    ok: true,
    slug: engineer?.slug ?? null,
    activePlanCount,
    status: tier.status,
  });
}

// Delete exists only for drafts that never went live (Part 7.2 LAW). A plan
// that ever had a customer can be stopped, never deleted.
export async function DELETE(req: Request, ctx: { params: Promise<{ tierId: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { tierId } = await ctx.params;
  const tier = await prisma.planTier.findFirst({
    where: { id: tierId, engineerId },
    include: { _count: { select: { plans: true } } },
  });
  if (!tier) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
  if (tier.status !== "DRAFT" || tier._count.plans > 0) {
    return NextResponse.json(
      { error: "A plan that's ever had a customer can be stopped, never deleted." },
      { status: 409 },
    );
  }

  await prisma.$transaction([
    prisma.tierClause.deleteMany({ where: { tierId } }),
    prisma.planTier.delete({ where: { id: tierId } }),
  ]);
  await track("plan_draft_deleted", { type: "ENGINEER", id: engineerId }, { tierId });
  return NextResponse.json({ ok: true });
}

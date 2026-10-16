import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { checkWording } from "@/lib/compliance/blocklist";
import { TIER_PRICE_MIN_PENCE, TIER_PRICE_MAX_PENCE, serviceRuleError, withRequiredClauses } from "@/lib/clauses";

const Body = z.object({
  name: z.string().min(2).max(28),
  priceMonthlyPence: z.number().int().min(TIER_PRICE_MIN_PENCE).max(TIER_PRICE_MAX_PENCE),
  clauseCodes: z.array(z.string()).max(20),
  customLabels: z.array(z.string().min(2).max(80)).max(5),
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

  // Locked wording: every free-text label passes the blocklist server-side.
  for (const label of parsed.data.customLabels) {
    const check = checkWording(label);
    if (!check.ok) {
      return NextResponse.json({ error: "blocked_wording", label, ...check }, { status: 422 });
    }
  }

  // Part 7.1 LAW — required (CORE) options are unremovable; union them in
  // rather than trusting the client picker alone.
  const wantedCodes = withRequiredClauses(parsed.data.clauseCodes);
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

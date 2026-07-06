import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { checkWording } from "@/lib/compliance/blocklist";

const Body = z.object({
  name: z.string().min(2).max(40),
  priceMonthlyPence: z.number().int().min(100).max(20000),
  isRecommended: z.boolean(),
  clauseCodes: z.array(z.string()).min(1).max(20),
  customLabels: z.array(z.string().min(2).max(80)).max(5),
});

export async function PUT(req: Request, ctx: { params: Promise<{ tierId: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { tierId } = await ctx.params;
  const tier = await prisma.planTier.findFirst({ where: { id: tierId, engineerId } });
  if (!tier) return NextResponse.json({ error: "Tier not found." }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the form and try again." }, { status: 400 });
  }

  // Locked wording: every free-text label passes the blocklist server-side.
  for (const label of parsed.data.customLabels) {
    const check = checkWording(label);
    if (!check.ok) {
      return NextResponse.json({ error: "blocked_wording", label, ...check }, { status: 422 });
    }
  }

  const clauses = await prisma.clauseTemplate.findMany({
    where: { code: { in: parsed.data.clauseCodes } },
  });
  if (clauses.length === 0) {
    return NextResponse.json({ error: "Pick at least one service." }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.tierClause.deleteMany({ where: { tierId } }),
    prisma.planTier.update({
      where: { id: tierId },
      data: {
        name: parsed.data.name,
        priceMonthlyPence: parsed.data.priceMonthlyPence,
        isRecommended: parsed.data.isRecommended,
        customLabels: parsed.data.customLabels,
        clauses: { create: clauses.map((c) => ({ clauseId: c.id })) },
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}

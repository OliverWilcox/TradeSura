import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import {
  PRICE_REVIEW_NOTICE_DAYS,
  priceReviewCandidates,
  priceReviewCapPercent,
  priceReviewError,
  sendPriceReview,
} from "@/lib/price-review";

// Build Review 2, ruling 3 — annual price review for a plan's existing
// customers. GET previews who it would reach; POST sends the notices.

async function ownTier(tierId: string) {
  const engineerId = await getEngineerId();
  if (!engineerId) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  const tier = await prisma.planTier.findFirst({ where: { id: tierId, engineerId } });
  if (!tier) return { error: NextResponse.json({ error: "Plan not found." }, { status: 404 }) };
  return { engineerId, tier };
}

export async function GET(_req: Request, ctx: { params: Promise<{ tierId: string }> }) {
  const { tierId } = await ctx.params;
  const own = await ownTier(tierId);
  if ("error" in own) return own.error;
  const { effectiveAt, candidates } = await priceReviewCandidates(tierId, own.engineerId);
  return NextResponse.json({
    noticeDays: PRICE_REVIEW_NOTICE_DAYS,
    capPercent: priceReviewCapPercent(),
    effectiveAt: effectiveAt.toISOString(),
    currentPricePence: own.tier.priceMonthlyPence,
    customers: candidates.map((c) => ({
      name: c.customerName,
      pricePence: c.oldPence,
      eligible: c.eligible,
      pending: c.pending,
      earliest: c.earliest.toISOString(),
    })),
  });
}

const Body = z.object({ newPricePence: z.number().int() });

export async function POST(req: Request, ctx: { params: Promise<{ tierId: string }> }) {
  const { tierId } = await ctx.params;
  const own = await ownTier(tierId);
  if ("error" in own) return own.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the new monthly price." }, { status: 400 });

  // The list price can already differ from what customers pay, so only the
  // floor is checked here; same-price and cap run per customer inside
  // sendPriceReview.
  const floor = priceReviewError({ oldPence: 0, newPence: parsed.data.newPricePence, capPercent: null });
  if (floor) return NextResponse.json({ error: floor }, { status: 400 });

  const result = await sendPriceReview({
    tierId,
    engineerId: own.engineerId,
    newPence: parsed.data.newPricePence,
  });
  if (result.sent === 0) {
    return NextResponse.json(
      { error: "No customers can be reviewed to that price right now." },
      { status: 400 },
    );
  }
  // New customers see the reviewed price straight away.
  await prisma.planTier.update({ where: { id: tierId }, data: { priceMonthlyPence: parsed.data.newPricePence } });
  return NextResponse.json({ ...result, effectiveAt: result.effectiveAt.toISOString() });
}

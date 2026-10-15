import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { brandName } from "@/lib/engineer";
import {
  REFERRAL_FIRST_YEAR_MONTHS,
  REFERRAL_FIRST_YEAR_PERCENT,
  REFERRAL_LIFETIME_PERCENT,
  referralRatePercent,
  referralStage,
} from "@/lib/referral";
import { appUrl } from "@/lib/app-url";

// The engineer's referral hub: their invite link, the affiliate terms
// (Build Review 2, ruling 4), and per referred engineer their stage, current
// rate and what they've earned so far.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const invitees = await prisma.engineer.findMany({
    where: { referrerId: engineerId },
    orderBy: { createdAt: "desc" },
  });

  const earnings = await prisma.referralEarning.groupBy({
    by: ["inviteeId"],
    where: { referrerId: engineerId },
    _sum: { amountPence: true },
  });
  const earnedBy = new Map(earnings.map((e) => [e.inviteeId, e._sum.amountPence ?? 0]));

  const rows = await Promise.all(
    invitees.map(async (e) => {
      const activePlans = await prisma.plan.count({
        where: { engineerId: e.id, status: "ACTIVE" },
      });
      const earnedPence = earnedBy.get(e.id) ?? 0;
      return {
        name: brandName(e),
        stage: referralStage({ verified: Boolean(e.gasSafeVerifiedAt), activePlans, earnedPence }),
        activePlans,
        earnedPence,
        ratePercent: referralRatePercent(e.createdAt),
      };
    }),
  );

  const link = `${appUrl()}/r/${engineer.slug}`;
  const qrDataUrl = await QRCode.toDataURL(link, { width: 280, margin: 1 });

  // Part 14 — "Share my income card... soft-gated ('Unlocks with your first
  // payout') until there's a real card to share." A confirmed collection is
  // the honest proxy for "there's a real number worth showing off."
  const hasPayout =
    (await prisma.event.count({
      where: { name: "payment_confirmed", meta: { path: ["engineerId"], equals: engineerId } },
    })) > 0;

  return NextResponse.json({
    link,
    qrDataUrl,
    cardUrl: `${appUrl()}/api/referral/card?slug=${engineer.slug}`,
    firstYearPercent: REFERRAL_FIRST_YEAR_PERCENT,
    lifetimePercent: REFERRAL_LIFETIME_PERCENT,
    firstYearMonths: REFERRAL_FIRST_YEAR_MONTHS,
    totalEarnedPence: rows.reduce((sum, r) => sum + r.earnedPence, 0),
    hasPayout,
    invitees: rows,
  });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import {
  REFERRAL_BOUNTY_PENCE,
  REFERRAL_REQUIRED_PLANS,
  referralStage,
} from "@/lib/referral";

// E10 — the engineer's referral hub: their invite link, the flat bounty
// terms, and each invitee's progress toward the 5-live-plans threshold.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const invitees = await prisma.engineer.findMany({
    where: { referrerId: engineerId },
    orderBy: { createdAt: "desc" },
  });

  const rows = await Promise.all(
    invitees.map(async (e) => {
      const activePlans = await prisma.plan.count({
        where: { engineerId: e.id, status: "ACTIVE" },
      });
      return {
        name: e.tradingName ?? e.slug,
        activePlans,
        required: REFERRAL_REQUIRED_PLANS,
        stage: referralStage(activePlans, Boolean(e.referralBountyPaidAt)),
        bountyPaid: Boolean(e.referralBountyPaidAt),
      };
    }),
  );

  return NextResponse.json({
    link: `${process.env.APP_URL}/r/${engineer.slug}`,
    cardUrl: `${process.env.APP_URL}/api/referral/card?slug=${engineer.slug}`,
    bountyPence: REFERRAL_BOUNTY_PENCE,
    requiredPlans: REFERRAL_REQUIRED_PLANS,
    paidCount: rows.filter((r) => r.bountyPaid).length,
    invitees: rows,
  });
}

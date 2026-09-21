import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { brandName } from "@/lib/engineer";
import { REFERRAL_BOUNTY_PENCE, referralStage } from "@/lib/referral";

// E10 — the engineer's referral hub: their invite link, the flat bounty
// terms, and each invitee's stage on the Part 14 ladder (Signed up →
// Verified → Plan live → £50 paid).
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
        name: brandName(e),
        stage: referralStage({
          verified: Boolean(e.gasSafeVerifiedAt),
          activePlans,
          bountyPaid: Boolean(e.referralBountyPaidAt),
        }),
        bountyPaid: Boolean(e.referralBountyPaidAt),
      };
    }),
  );

  const link = `${process.env.APP_URL}/r/${engineer.slug}`;
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
    cardUrl: `${process.env.APP_URL}/api/referral/card?slug=${engineer.slug}`,
    bountyPence: REFERRAL_BOUNTY_PENCE,
    hasPayout,
    paidCount: rows.filter((r) => r.bountyPaid).length,
    invitees: rows,
  });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { FIRST_TEN, firstTenCandidates } from "@/lib/grow";

// Matt, 6 Nov — Pick your first 10: the customers most likely to join
// (regulars, recent installs, landlords) from the imported book or
// contacts. Each is offered through POST /api/offer with source "first10",
// so the TradeSura sender, quiet hours, STOP and follow-ups all apply.
// Left out: anyone already on a plan, without a UK mobile, or opted out.

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (actor.role === "staff") return NextResponse.json({ error: "Only the owner can do this." }, { status: 403 });
  const customers = await prisma.customer.findMany({
    where: { engineerId: actor.businessId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      smsOptOut: true,
      plans: { select: { status: true, offerSource: true } },
      properties: { select: { appliances: { select: { lastServicedAt: true, installedAt: true } } } },
    },
    take: 1000,
  });
  const candidates = firstTenCandidates(customers, new Date());
  return NextResponse.json({ goal: FIRST_TEN, sent: candidates.filter((c) => c.offered).length, candidates });
}

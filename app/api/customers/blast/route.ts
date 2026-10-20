import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { offerBlockedReason } from "@/lib/verification-state";
import { brandName } from "@/lib/engineer";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { sendSms } from "@/lib/sms";
import { profileUrl } from "@/lib/public-url";

// E8 — book import & blast. Un-stubs the old "campaigns" screen. Sends a
// fixed, templated offer to every no-plan customer, staggered over ~10 min,
// pointing at the public plan page. STOP suppression is enforced in lib/sms.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const last = await prisma.event.findFirst({
    where: { name: "blast_sent", meta: { path: ["engineerId"], equals: engineerId } },
    orderBy: { ts: "desc" },
  });

  let results: { sent: number; visits: number; plansLive: number; since: string } | null = null;
  if (last) {
    const since = last.ts;
    const sent = (last.meta as { count?: number } | null)?.count ?? 0;
    const [visits, plansLive] = await Promise.all([
      prisma.event.count({
        where: {
          name: "page_visit",
          ts: { gte: since },
          meta: { path: ["engineerId"], equals: engineerId },
        },
      }),
      prisma.plan.count({
        where: { engineerId, status: "ACTIVE", activatedAt: { gte: since } },
      }),
    ]);
    results = { sent, visits, plansLive, since: since.toISOString() };
  }

  const noPlan = await prisma.customer.count({
    where: { engineerId, smsOptOut: false, plans: { none: { status: { in: ["ACTIVE", "PAUSED"] } } } },
  });
  const tiers = await prisma.planTier.findMany({
    where: { engineerId, status: "LIVE" },
    orderBy: { priceMonthlyPence: "asc" },
    select: { id: true, name: true, priceMonthlyPence: true },
  });
  return NextResponse.json({ noPlan, tiers, results });
}

const Body = z.object({ confirmOwn: z.literal(true) });

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const gateEngineer = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { gasSafeVerifiedAt: true, pausedAt: true, bannedAt: true },
  });
  const blockedReason = gateEngineer ? offerBlockedReason(gateEngineer) : "Not signed in.";
  if (blockedReason) return NextResponse.json({ error: blockedReason }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Confirm these are your own customers before sending." },
      { status: 400 },
    );
  }

  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const brand = brandName(engineer);
  const cheapest = await prisma.planTier.findFirst({
    where: { engineerId, status: "LIVE" },
    orderBy: { priceMonthlyPence: "asc" },
  });
  if (!cheapest) {
    return NextResponse.json({ error: "Build a plan first." }, { status: 409 });
  }

  const customers = await prisma.customer.findMany({
    where: {
      engineerId,
      smsOptOut: false,
      plans: { none: { status: { in: ["ACTIVE", "PAUSED"] } } },
    },
  });
  if (customers.length === 0) {
    return NextResponse.json({ error: "Everyone in your book is already on a plan." }, { status: 409 });
  }

  const link = `${profileUrl(engineer.slug)}?src=blast`;
  const priceLabel = `£${(cheapest.priceMonthlyPence / 100).toFixed(0)}`;
  const now = Date.now();
  let sent = 0;
  for (const [i, c] of customers.entries()) {
    // Spread the send over ~10 minutes for deliverability + reply handling.
    const sendAfter = new Date(now + Math.round((i / customers.length) * 10 * 60 * 1000));
    const res = await sendSms({
      engineerId,
      to: c.phone,
      body: `Hi ${c.firstName} — it's ${brand}. I now offer a care plan: annual service, priority call-outs, no call-out fees, from ${priceLabel}/mo. Have a look: ${link}`,
      messageClass: "MARKETING",
      sendAfter,
      cancelKey: `blast:${engineerId}`,
    });
    if (res.sent !== false || res.id) sent++;
  }

  await track("blast_sent", { type: "ENGINEER", id: engineerId }, {
    engineerId,
    count: sent,
    audience: customers.length,
  });
  return NextResponse.json({ sent, audience: customers.length });
}

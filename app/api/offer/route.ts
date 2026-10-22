import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { offerBlockedReason } from "@/lib/verification-state";
import { brandName } from "@/lib/engineer";
import { getActor } from "@/lib/auth";
import { track } from "@/lib/track";
import { sendSms } from "@/lib/sms";
import { normaliseUkPhone } from "@/lib/phone";
import { newPlanRef, newToken } from "@/lib/plans";
import { appUrl } from "@/lib/app-url";
import { clauseLine } from "@/lib/clauses";

const Body = z.object({
  customerId: z.string().optional(),
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional(),
  phone: z.string().min(6).max(20).optional(),
  email: z.string().email().max(200).optional().or(z.literal("")),
  addressLine1: z.string().max(120).optional().or(z.literal("")),
  town: z.string().max(60).optional().or(z.literal("")),
  postcode: z.string().max(12).optional().or(z.literal("")),
  // Build Guide v2 Part 9.2 — "Pick the customer, pick the plan, see the
  // exact text, send." Required: the engineer's own plans are the only
  // valid choices, checked server-side against status: "LIVE" below.
  tierId: z.string().min(1),
  // 'sms' sends our branded text now; 'whatsapp' skips it (the engineer shares
  // the link himself) but still queues the follow-up nudges.
  channel: z.enum(["sms", "whatsapp"]).default("sms"),
});

// Mobile counterpart to the customer-picker query in app/offer/page.tsx.
export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const engineerId = actor.businessId;
  const isStaff = actor.role === "staff";

  const [customers, tiers, offersSent] = await Promise.all([
    prisma.customer.findMany({
      where: { engineerId, ...(isStaff ? { addedById: actor.actorId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, firstName: true, lastName: true, phone: true },
    }),
    prisma.planTier.findMany({
      where: { engineerId, status: "LIVE" },
      orderBy: { sortOrder: "asc" },
      include: { clauses: { include: { clause: true } } },
    }),
    prisma.plan.count({ where: { engineerId, ...(isStaff ? { soldById: actor.actorId } : {}) } }),
  ]);

  return NextResponse.json({
    customers,
    tierCount: tiers.length,
    offersSent,
    tiers: tiers.map((t) => ({
      id: t.id,
      name: t.name,
      priceMonthlyPence: t.priceMonthlyPence,
      lines: t.clauses
        .sort((a, b) => a.clause.sortOrder - b.clause.sortOrder)
        .map((tc) => clauseLine(tc.clause, t.clauseRates)),
    })),
  });
}

export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const engineerId = actor.businessId;
  // Section 8 — staff sell for the business and are tagged on the plan.
  const staffId = actor.role === "staff" ? actor.actorId : null;

  const [gateBusiness, gateActor] = await Promise.all([
    prisma.engineer.findUnique({
      where: { id: engineerId },
      select: { gasSafeVerifiedAt: true, pausedAt: true, bannedAt: true, stripeChargesEnabled: true },
    }),
    prisma.engineer.findUnique({ where: { id: actor.actorId }, select: { gasSafeVerifiedAt: true } }),
  ]);
  // The business's standing (paused/banned) plus the person's own badge: a
  // staff engineer can't send offers until their card is approved.
  const blockedReason =
    gateBusiness && gateActor
      ? offerBlockedReason({ ...gateBusiness, gasSafeVerifiedAt: gateActor.gasSafeVerifiedAt })
      : "Not signed in.";
  if (blockedReason) return NextResponse.json({ error: blockedReason }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the form and try again." }, { status: 400 });
  }
  const b = parsed.data;

  const tier = await prisma.planTier.findFirst({
    where: { id: b.tierId, engineerId, status: "LIVE" },
    include: { clauses: { include: { clause: true } } },
  });
  if (!tier) return NextResponse.json({ error: "Pick a live plan to offer." }, { status: 400 });

  let customer;
  if (b.customerId) {
    customer = await prisma.customer.findFirst({
      where: { id: b.customerId, engineerId, ...(staffId ? { addedById: staffId } : {}) },
    });
    if (!customer) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  } else {
    if (!b.firstName || !b.lastName || !b.phone) {
      return NextResponse.json({ error: "Name and mobile number are required." }, { status: 400 });
    }
    const phone = normaliseUkPhone(b.phone);
    if (!phone) {
      return NextResponse.json({ error: "That doesn't look like a UK mobile number." }, { status: 400 });
    }
    if (staffId) {
      const existing = await prisma.customer.findUnique({ where: { engineerId_phone: { engineerId, phone } } });
      if (existing && existing.addedById !== staffId) {
        return NextResponse.json(
          { error: "That customer is already in the business's book — ask the owner to offer them a plan." },
          { status: 409 },
        );
      }
    }
    customer = await prisma.customer.upsert({
      where: { engineerId_phone: { engineerId, phone } },
      update: { email: b.email || undefined },
      create: {
        engineerId,
        addedById: staffId,
        firstName: b.firstName,
        lastName: b.lastName,
        phone,
        email: b.email || null,
        ...(b.addressLine1 && b.postcode
          ? {
              properties: {
                create: {
                  addressLine1: b.addressLine1,
                  town: b.town || null,
                  postcode: b.postcode,
                },
              },
            }
          : {}),
      },
    });
  }

  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const seller = staffId ? await prisma.engineer.findUniqueOrThrow({ where: { id: staffId } }) : engineer;
  // tierId here is a suggestion, not a commitment — /api/signup/[token]/choose
  // overwrites it (and freezes the real agreedTier snapshot) the moment the
  // customer actually picks, same plan or otherwise.
  const plan = await prisma.plan.create({
    data: {
      ref: await newPlanRef(),
      engineerId,
      soldById: staffId,
      customerId: customer.id,
      tierId: tier.id,
      signupToken: newToken(),
      portalToken: newToken(),
    },
  });

  const link = `${appUrl()}/p/${engineer.slug}/signup/${plan.signupToken}`;
  const brand = brandName(engineer);
  const benefits = tier.clauses
    .sort((a, b2) => a.clause.sortOrder - b2.clause.sortOrder)
    // Lower-case the opening word only, so "CO alarm" and "TRVs" survive;
    // the engineer's rates (R6) are part of the line.
    .map((tc) => lowerFirst(clauseLine(tc.clause, tier.clauseRates)))
    .join(", ");
  const pricePounds = (tier.priceMonthlyPence / 100).toFixed(2).replace(/\.00$/, "");

  // Build Guide v2 Part 18 — the offer text template, verbatim, with
  // variables filled: "Hi {first name} — {engineer first name} from
  // {trading name}. My {plan name} plan is £{X} a month: {benefits, lower
  // case, comma-run}. Sign up here — takes a minute: {personal link}"
  const messageBody = `Hi ${customer.firstName} — ${seller.firstName ?? brand} from ${brand}. My ${tier.name} plan is £${pricePounds} a month: ${benefits}. Sign up here — takes a minute: ${link}`;

  // Signup link is customer-requested at the end of the job → transactional.
  // On the WhatsApp path the engineer shares it himself, so skip our text.
  if (b.channel === "sms") {
    await sendSms({
      engineerId,
      to: customer.phone,
      body: messageBody,
      messageClass: "TRANSACTIONAL",
      consentBasis: "engineer-initiated",
    });
  }

  // Abandon nudges (spec Screen 04): that evening + 3 days later. Marketing
  // class → STOP suffix + quiet hours in lib/sms. Cancelled on activation.
  const now = new Date();
  const evening = new Date(now);
  evening.setHours(18, 30, 0, 0);
  if (evening <= now) evening.setTime(now.getTime() + 30 * 60 * 1000);
  const day3 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  day3.setHours(10, 0, 0, 0);
  const nudgeBody = `Your quote for ${brand}'s ${tier.name} plan is still open — pick your plan: ${link}`;
  for (const sendAfter of [evening, day3]) {
    await sendSms({
      engineerId,
      to: customer.phone,
      body: nudgeBody,
      messageClass: "MARKETING",
      sendAfter,
      cancelKey: `nudge:${plan.id}`,
    });
  }

  await track("offer_link_sent", { type: "ENGINEER", id: engineerId }, {
    planId: plan.id,
    ref: plan.ref,
    customerId: customer.id,
    tierId: tier.id,
  });
  await track("offer_sent", { type: "ENGINEER", id: engineerId }, {
    planId: plan.id,
    soldById: staffId,
    customerId: customer.id,
    channel: b.channel,
  });

  return NextResponse.json({
    ok: true,
    planId: plan.id,
    link,
    message: messageBody,
    customerFirstName: customer.firstName,
  });
}

function lowerFirst(line: string): string {
  const first = line.split(/\s/)[0] ?? "";
  return /^[A-Z0-9]{2,}/.test(first) ? line : line.charAt(0).toLowerCase() + line.slice(1);
}

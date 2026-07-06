import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { sendSms } from "@/lib/sms";
import { normaliseUkPhone } from "@/lib/phone";
import { newPlanRef, newToken } from "@/lib/plans";

const Body = z.object({
  customerId: z.string().optional(),
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional(),
  phone: z.string().min(6).max(20).optional(),
  email: z.string().email().max(200).optional().or(z.literal("")),
  addressLine1: z.string().max(120).optional().or(z.literal("")),
  town: z.string().max(60).optional().or(z.literal("")),
  postcode: z.string().max(12).optional().or(z.literal("")),
});

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the form and try again." }, { status: 400 });
  }
  const b = parsed.data;

  let customer;
  if (b.customerId) {
    customer = await prisma.customer.findFirst({ where: { id: b.customerId, engineerId } });
    if (!customer) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  } else {
    if (!b.firstName || !b.lastName || !b.phone) {
      return NextResponse.json({ error: "Name and mobile number are required." }, { status: 400 });
    }
    const phone = normaliseUkPhone(b.phone);
    if (!phone) {
      return NextResponse.json({ error: "That doesn't look like a UK mobile number." }, { status: 400 });
    }
    customer = await prisma.customer.upsert({
      where: { engineerId_phone: { engineerId, phone } },
      update: { email: b.email || undefined },
      create: {
        engineerId,
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
  const plan = await prisma.plan.create({
    data: {
      ref: await newPlanRef(),
      engineerId,
      customerId: customer.id,
      signupToken: newToken(),
      portalToken: newToken(),
    },
  });

  const link = `${process.env.APP_URL}/p/${engineer.slug}/signup/${plan.signupToken}`;
  const brand = engineer.tradingName ?? engineer.slug;

  // Signup link is customer-requested on the doorstep → transactional.
  await sendSms({
    engineerId,
    to: customer.phone,
    body: `Hi ${customer.firstName} — your ${brand} care plan link: ${link}`,
    messageClass: "TRANSACTIONAL",
  });

  // Abandon nudges (spec Screen 04): that evening + 3 days later. Marketing
  // class → STOP suffix + quiet hours in lib/sms. Cancelled on activation.
  const now = new Date();
  const evening = new Date(now);
  evening.setHours(18, 30, 0, 0);
  if (evening <= now) evening.setTime(now.getTime() + 30 * 60 * 1000);
  const day3 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  day3.setHours(10, 0, 0, 0);
  const nudgeBody = `Your quote for ${brand}'s care plan is still open — pick your plan: ${link}`;
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

  await track("doorstep_link_sent", { type: "ENGINEER", id: engineerId }, {
    planId: plan.id,
    ref: plan.ref,
    customerId: customer.id,
  });

  return NextResponse.json({ ok: true, planId: plan.id });
}

import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { cancelScheduledSms, sendSms } from "@/lib/sms";
import { passportBoiler } from "@/lib/passport";
import { passportUrl } from "@/lib/passport-link";

// Retention spec, section 9 — "Welcome: first 90 days. Welcome message from
// their engineer, then the Home Passport." Queued at activation on the
// OutboundSms queue; both are cancelled if the plan is cancelled first
// (cancelKey "welcome:<planId>"). Matt, 4 Nov: the engineer photographs the
// boiler when they tap Register boiler, so the homeowner is never asked for
// a photo; they're asked for the boiler's details only if none is registered.
export const WELCOME_DELAY_DAYS = 2;
export const PASSPORT_PROMPT_DELAY_DAYS = 7;

function daysFrom(now: Date, days: number): Date {
  const d = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  d.setHours(10, 0, 0, 0);
  return d;
}

export async function queueWelcomeTouches(planId: string, now = new Date()) {
  const plan = await prisma.plan.findUniqueOrThrow({
    where: { id: planId },
    include: { customer: true, engineer: true, passport: true },
  });
  // Already queued (activation can run twice) — leave it.
  if (await prisma.outboundSms.findFirst({ where: { cancelKey: { startsWith: `welcome:${plan.id}` } } })) return;

  // A customer rejoining stops any win-back texts from their old plan.
  const old = await prisma.plan.findMany({
    where: { customerId: plan.customerId, id: { not: plan.id } },
    select: { id: true },
  });
  for (const p of old) await cancelScheduledSms(`winback:${p.id}`);

  const brand = brandName(plan.engineer);
  const from = plan.engineer.firstName ? `${plan.engineer.firstName} at ${brand}` : brand;
  const phone = plan.engineer.enquiryPhone ?? plan.engineer.phone;
  await sendSms({
    engineerId: plan.engineerId,
    to: plan.customer.phone,
    body: `Hi ${plan.customer.firstName}, it's ${from}. Thanks for joining my care plan. If you ever have a question about your boiler, just get in touch${phone ? ` on ${phone}` : ""}.`,
    messageClass: "TRANSACTIONAL",
    consentBasis: "plan-member-transactional",
    sendAfter: daysFrom(now, WELCOME_DELAY_DAYS),
    cancelKey: `welcome:${plan.id}:hello`,
  });
  if (plan.passport) {
    const registered = Boolean(await passportBoiler(plan.passport.id));
    await sendSms({
      engineerId: plan.engineerId,
      to: plan.customer.phone,
      body: registered
        ? boilerRegisteredText(plan.customer.firstName, brand, plan.passport.viewToken)
        : `Hi ${plan.customer.firstName}, your home now has a Home Passport with ${brand}: a service history that stays with your house. Add your boiler's details here: ${passportUrl(plan.passport.viewToken)}`,
      messageClass: "TRANSACTIONAL",
      consentBasis: "plan-member-transactional",
      sendAfter: daysFrom(now, PASSPORT_PROMPT_DELAY_DAYS),
      cancelKey: `welcome:${plan.id}:passport`,
    });
  }
}

export function boilerRegisteredText(firstName: string, brand: string, viewToken: string): string {
  return `Hi ${firstName}, ${brand} has registered your boiler with TradeSura. Your Home Passport keeps its service history, manual and reminders, and stays with your house. View it here: ${passportUrl(viewToken)}`;
}

// The engineer has just registered the boiler (Register boiler): each
// customer on one of their live plans at this home hears it once, and the
// "add your boiler's details" prompt still waiting is dropped.
export async function textBoilerRegistered(passportId: string, engineerId: string) {
  const plans = await prisma.plan.findMany({
    where: { passportId, engineerId, status: "ACTIVE" },
    include: { customer: true, engineer: true, passport: true },
  });
  for (const plan of plans) {
    if (!plan.passport) continue;
    await cancelScheduledSms(`welcome:${plan.id}:passport`);
    const key = `welcome:${plan.id}:boiler-registered`;
    if (await prisma.outboundSms.findFirst({ where: { cancelKey: key } })) continue;
    await sendSms({
      engineerId,
      to: plan.customer.phone,
      body: boilerRegisteredText(plan.customer.firstName, brandName(plan.engineer), plan.passport.viewToken),
      messageClass: "TRANSACTIONAL",
      consentBasis: "plan-member-transactional",
      cancelKey: key,
    });
  }
}

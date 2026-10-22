import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { appUrl } from "@/lib/app-url";
import { cancelScheduledSms, sendSms } from "@/lib/sms";

// Retention spec, section 9 — "Welcome: first 90 days. Welcome message from
// their engineer, then a prompt to set up their Home Passport (boiler photo
// and details)." Queued at activation on the OutboundSms queue; both are
// cancelled if the plan is cancelled first (cancelKey "welcome:<planId>").
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
    await sendSms({
      engineerId: plan.engineerId,
      to: plan.customer.phone,
      body: `Hi ${plan.customer.firstName}, your home now has a Home Passport with ${brand}: a service history that stays with your house. Add a photo of your boiler and its details here: ${appUrl()}/passport/${plan.passport.viewToken}`,
      messageClass: "TRANSACTIONAL",
      consentBasis: "plan-member-transactional",
      sendAfter: daysFrom(now, PASSPORT_PROMPT_DELAY_DAYS),
      cancelKey: `welcome:${plan.id}:passport`,
    });
  }
}

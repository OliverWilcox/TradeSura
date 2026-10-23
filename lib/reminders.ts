// Screen 07 — service anniversaries and the reminder engine (lite).
// ponytail: no self-book slots; reminders say "reply to book" until an
// availability system exists. SMS only; email reminders when there's a queue.
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { sendSms } from "@/lib/sms";
import { resolvePlanTier } from "@/lib/plan-tier";
import { paymentOutstanding } from "@/lib/plan-billing";

export const REMINDER_OFFSETS_DAYS = [30, 14, 3] as const;

export function nextServiceDate(from: Date): Date {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

export type DueService = {
  customerId: string;
  customerName: string;
  dueDate: Date;
  onPlan: boolean;
  tierName?: string;
  hasCp12: boolean;
  planId?: string;
};

// Active plans drive renewals; no-plan customers with a known last service are
// sell opportunities — both belong on the due list (spec Screens 05 + 07).
// `addedById` narrows to one staff engineer's own customers (Build Review 2,
// section 8 — staff see only their own customers' services due).
export async function dueServices(engineerId: string, opts: { addedById?: string } = {}): Promise<DueService[]> {
  const own = opts.addedById ? { addedById: opts.addedById } : {};
  const plans = await prisma.plan.findMany({
    // Retention §3 — service booking pauses while a payment is outstanding.
    where: {
      engineerId,
      status: "ACTIVE",
      activatedAt: { not: null },
      paymentFailedAt: null,
      ...(opts.addedById ? { customer: own } : {}),
    },
    include: {
      customer: true,
      tier: { include: { clauses: { include: { clause: true } } } },
    },
  });
  const due: DueService[] = plans.map((p) => {
    // Follow the plan the customer agreed to, not later edits to the tier.
    const tier = resolvePlanTier(p);
    return {
      customerId: p.customerId,
      customerName: `${p.customer.firstName} ${p.customer.lastName}`,
      dueDate: nextServiceDate(p.serviceStartsAt ?? p.activatedAt!),
      onPlan: true,
      tierName: tier?.name,
      hasCp12: (tier?.clauses ?? []).some((c) => c.code === "CP12"),
      planId: p.id,
    };
  });

  const noPlanCustomers = await prisma.customer.findMany({
    where: {
      engineerId,
      ...own,
      plans: { none: { status: "ACTIVE" } },
      properties: { some: { appliances: { some: { lastServicedAt: { not: null } } } } },
    },
    include: { properties: { include: { appliances: true } } },
  });
  for (const c of noPlanCustomers) {
    const serviced = c.properties
      .flatMap((p) => p.appliances)
      .map((a) => a.lastServicedAt)
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (serviced) {
      due.push({
        customerId: c.id,
        customerName: `${c.firstName} ${c.lastName}`,
        dueDate: nextServiceDate(serviced),
        onPlan: false,
        hasCp12: false,
      });
    }
  }
  return due.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

// Queue 30/14/3-day SMS reminders for active plans. Idempotent via cancelKey;
// called from the jobs endpoint alongside the SMS flush.
export async function queueServiceReminders(): Promise<number> {
  const now = new Date();
  const plans = await prisma.plan.findMany({
    where: { status: "ACTIVE", activatedAt: { not: null } },
    include: { customer: true, engineer: true },
  });
  let queued = 0;
  for (const plan of plans) {
    // Retention spec §3 — service booking holds while a payment is
    // outstanding (startPaymentRescue cancels anything already queued; the
    // reminders come back once it clears).
    if (paymentOutstanding(plan)) continue;
    // §1 — benefits run from the service start date (the first cleared
    // payment after cooling-off), not the sign-up date.
    const due = nextServiceDate(plan.serviceStartsAt ?? plan.activatedAt!);
    const brand = brandName(plan.engineer);
    for (const offset of REMINDER_OFFSETS_DAYS) {
      const sendAfter = new Date(due);
      sendAfter.setDate(sendAfter.getDate() - offset);
      sendAfter.setHours(10, 0, 0, 0);
      if (sendAfter <= now) continue;
      const cancelKey = `svc:${plan.id}:${offset}`;
      // A reminder cancelled during a payment hold is queued again.
      const exists = await prisma.outboundSms.findFirst({ where: { cancelKey, status: { not: "CANCELLED" } } });
      if (exists) continue;
      await sendSms({
        engineerId: plan.engineerId,
        to: plan.customer.phone,
        body: `Hi ${plan.customer.firstName} — your annual service with ${brand} is due by ${due.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" })}. Reply to this text to book it in.`,
        messageClass: "TRANSACTIONAL",
        sendAfter,
        cancelKey,
      });
      queued++;
    }
  }
  return queued;
}

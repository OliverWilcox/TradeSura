// Review 4 / engineer terms 6.6 — yearly payers get 30 days' notice before
// their plan renews: the amount, the date, and how to cancel. Daily job,
// idempotent: one notice per plan per renewal date (Event
// "yearly_renewal_notice").
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { getStripe } from "@/lib/stripe";
import { sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-layout";
import { appUrl } from "@/lib/app-url";
import { addMonths, chargePence, poundsLabel } from "@/lib/billing-interval";

export const RENEWAL_NOTICE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const longDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

// The yearly payment is taken when cooling-off ends, then on each
// anniversary of it. Next one strictly after `now`.
export function nextYearlyRenewal(firstCollection: Date, now: Date): Date {
  let years = 1;
  while (addMonths(firstCollection, 12 * years) <= now) years++;
  return addMonths(firstCollection, 12 * years);
}

// Due once the renewal is 30 days away or closer (a missed daily run still
// sends, just later), and never for a renewal that's already happened.
export function renewalNoticeDue(renewsAt: Date, now: Date): boolean {
  return renewsAt > now && renewsAt.getTime() - now.getTime() <= RENEWAL_NOTICE_DAYS * DAY_MS;
}

export function renewalSmsBody(o: { firstName: string; brand: string; amount: string; date: string; manage: string }) {
  return `Hi ${o.firstName}, ${o.brand} here. Your yearly care plan renews on ${o.date}, when ${o.amount} will be taken by Direct Debit. Nothing to do if you're happy. To cancel before then: ${o.manage}`;
}

async function alreadySent(planId: string, renewsOn: string): Promise<boolean> {
  const hit = await prisma.event.findFirst({
    where: {
      name: "yearly_renewal_notice",
      AND: [{ meta: { path: ["planId"], equals: planId } }, { meta: { path: ["renewsOn"], equals: renewsOn } }],
    },
    select: { id: true },
  });
  return Boolean(hit);
}

// Stripe's own renewal date and amount when we can read them (they follow
// price reviews and any billing-cycle change); our calculation otherwise.
async function stripeRenewal(subscriptionId: string): Promise<{ at: Date; pence: number | null } | "ending" | null> {
  let sub: Stripe.Subscription;
  try {
    sub = await getStripe().subscriptions.retrieve(subscriptionId);
  } catch (err) {
    console.error("[yearly-renewal] subscription lookup failed:", err);
    return null;
  }
  if (sub.status === "canceled" || sub.cancel_at_period_end || sub.cancel_at) return "ending";
  const item = sub.items.data[0];
  if (!item) return null;
  const unit = item.price?.unit_amount;
  return { at: new Date(item.current_period_end * 1000), pence: unit == null ? null : unit * (item.quantity ?? 1) };
}

/** Daily job: 30-day renewal notices to yearly payers. */
export async function sendYearlyRenewalNotices(now = new Date()): Promise<number> {
  const plans = await prisma.plan.findMany({
    where: {
      billingInterval: "year",
      status: { in: ["ACTIVE", "PAUSED"] },
      cancelRequestedAt: null,
    },
    include: { customer: true, engineer: true, tier: true },
  });
  let sent = 0;
  for (const plan of plans) {
    const first = plan.coolingOffEndsAt ?? plan.activatedAt;
    if (!first) continue;
    let renewsAt = nextYearlyRenewal(first, now);
    if (!renewalNoticeDue(renewsAt, now)) continue;
    let pence = chargePence(plan.priceMonthlyPence ?? 0, "year");
    if (plan.stripeSubscriptionId) {
      const live = await stripeRenewal(plan.stripeSubscriptionId);
      if (live === "ending") continue;
      if (live) {
        renewsAt = live.at;
        if (live.pence) pence = live.pence;
        if (!renewalNoticeDue(renewsAt, now)) continue;
      }
    }
    if (pence <= 0) continue;
    const renewsOn = renewsAt.toISOString().slice(0, 10);
    if (await alreadySent(plan.id, renewsOn)) continue;
    // Recorded before sending, so a crash part-way never sends twice.
    await track("yearly_renewal_notice", { type: "SYSTEM" }, { planId: plan.id, renewsOn, amountPence: pence });

    const brand = brandName(plan.engineer);
    const manage = `${appUrl()}/portal/${plan.portalToken}/manage`;
    const amount = poundsLabel(pence);
    const date = longDate(renewsAt);
    await sendSms({
      engineerId: plan.engineerId,
      to: plan.customer.phone,
      body: renewalSmsBody({ firstName: plan.customer.firstName, brand, amount, date, manage }),
      messageClass: "TRANSACTIONAL",
      consentBasis: "plan-member-transactional",
    }).catch((err) => console.error("[yearly-renewal] text failed:", err));
    if (plan.customer.email) {
      await sendEmail({
        to: plan.customer.email,
        replyTo: plan.engineer.email,
        subject: `Your ${brand} care plan renews on ${date} (${plan.ref})`,
        html: `<p>Hi ${escapeHtml(plan.customer.firstName)},</p>
<p>Your yearly ${escapeHtml(plan.tier?.name ?? "care")} plan with ${escapeHtml(brand)} (${plan.ref}) renews soon:</p>
<p><b>Renews on:</b> ${date}<br><b>Amount:</b> ${amount} for the next 12 months, taken by Direct Debit</p>
<p>If you're happy, there's nothing to do. What your plan includes stays the same.</p>
<p>If you'd rather not renew, you can cancel any time before ${date} and nothing more will be taken: <a href="${manage}">manage your plan</a>.</p>
<p>Questions? Just reply to ${escapeHtml(brand)}.</p>`,
      }).catch((err) => console.error("[yearly-renewal] email failed:", err));
    }
    sent++;
  }
  return sent;
}

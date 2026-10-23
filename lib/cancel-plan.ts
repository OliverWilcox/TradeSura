import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { clauseLine } from "@/lib/clauses";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-layout";
import { cancelScheduledSms, notifyEngineer, sendSms } from "@/lib/sms";
import { sendPushNotification } from "@/lib/push";
import { appUrl } from "@/lib/app-url";
import { cancelAtPeriodEnd, undoCancel } from "@/lib/plan-billing";
import { resolvePlanTier } from "@/lib/plan-tier";
import {
  WINBACK_DELAY_DAYS,
  addDays,
  beforeYouGo,
  nextWinterDate,
  offerForReason,
  paidSoFarPence,
  parseWinbackOffer,
  reasonLabel,
  winbackBody,
  winbackSettingKey,
  type CancelReason,
} from "@/lib/retention";

// Retention spec, section 2. One cancellation path for both doors: the
// customer's manage link, and the engineer logging a request made by phone
// or email (source "engineer_logged"). Cancelling always works and is never
// delayed by anything here: the plan ends at the end of the paid month
// (lib/plan-billing.ts), and every request is stored with its reason, the
// offer shown and the outcome.
export type CancelResult =
  | { ok: true; effectiveAt: Date; endedNow?: boolean }
  | { ok: false; status: number; error: string };

export type CancelSource = "customer" | "engineer_logged";

const shortDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
export const longDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

// Whether the annual service on this plan has been carried out since it
// started — a passport service record, or (older data) the appliance stamp.
export async function planServiceUsed(plan: { id: string; customerId: string; activatedAt: Date | null }) {
  const since = plan.activatedAt ?? new Date(0);
  const record = await prisma.serviceRecord.count({
    where: { planId: plan.id, kind: "service", doneAt: { gte: since } },
  });
  if (record > 0) return true;
  const appliance = await prisma.appliance.count({
    where: { property: { customerId: plan.customerId }, lastServicedAt: { gte: since } },
  });
  return appliance > 0;
}

// Everything the customer's three cancel screens and the engineer's card
// need, from live data.
export async function cancelContext(planId: string) {
  const plan = await prisma.plan.findUniqueOrThrow({
    where: { id: planId },
    include: {
      engineer: true,
      customer: true,
      tier: { include: { clauses: { include: { clause: true } } } },
    },
  });
  const liveTiers = (
    await prisma.planTier.findMany({
      where: { engineerId: plan.engineerId, status: "LIVE" },
      select: {
        id: true,
        name: true,
        priceMonthlyPence: true,
        clauseRates: true,
        clauses: { include: { clause: true }, orderBy: { clause: { sortOrder: "asc" } } },
      },
      orderBy: { priceMonthlyPence: "asc" },
    })
  ).map((t) => ({
    id: t.id,
    name: t.name,
    priceMonthlyPence: t.priceMonthlyPence,
    lines: [...t.clauses.map((tc) => clauseLine(tc.clause, t.clauseRates)), "Your Home Passport"],
  }));
  const brand = brandName(plan.engineer);
  const tier = resolvePlanTier(plan);
  const serviceUsed = await planServiceUsed(plan);
  const price = plan.priceMonthlyPence ?? 0;
  const figures = beforeYouGo({
    brand,
    engineerFirstName: plan.engineer.firstName,
    since: plan.serviceStartsAt ?? plan.activatedAt,
    paidPence: paidSoFarPence({
      paymentsCleared: plan.paymentsCleared,
      priceMonthlyPence: price,
      billingInterval: plan.billingInterval,
    }),
    serviceUsed,
    clauses: tier?.clauses ?? [],
  });
  const cheaper = offerForReason("too_expensive", {
    currentPricePence: price,
    currentTierId: plan.tierId,
    liveTiers,
  });
  return { plan, brand, tier, serviceUsed, figures, cheaper };
}

async function ensureRejoinToken(planId: string): Promise<string> {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId }, select: { rejoinToken: true } });
  if (plan.rejoinToken) return plan.rejoinToken;
  const token = randomBytes(16).toString("base64url");
  await prisma.plan.update({ where: { id: planId }, data: { rejoinToken: token } });
  return token;
}

export async function requestCancel(
  planId: string,
  opts: {
    source: CancelSource;
    reason: CancelReason;
    detail?: string | null;
    offer?: string | null;
    moveDate?: Date | null;
    passportConsent?: boolean | null;
    // Reinstating a cancellation the installer marked as saved: that same
    // request goes back to "cancelled" rather than a second one being made.
    existingRequestId?: string;
  },
): Promise<CancelResult> {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    include: { engineer: true, customer: true, tier: true },
  });
  if (!plan) return { ok: false, status: 404, error: "Not found." };
  if (plan.status === "CANCELLED") return { ok: true, effectiveAt: plan.cancelledAt ?? new Date() };
  // Already on its way out: the same answer again, never a second request.
  if (plan.cancelRequestedAt && plan.cancelEffectiveAt) return { ok: true, effectiveAt: plan.cancelEffectiveAt };

  let effectiveAt: Date;
  try {
    ({ effectiveAt } = await cancelAtPeriodEnd(plan.id));
  } catch (err) {
    console.error("[cancel] cancelAtPeriodEnd failed:", err);
    return {
      ok: false,
      status: 502,
      error: "Could not cancel with the payment provider. Try again in a minute.",
    };
  }
  const now = new Date();
  // Inside cooling-off the plan ends straight away (lib/plan-billing.ts).
  const endedNow = effectiveAt.getTime() <= now.getTime();
  await prisma.plan.update({
    where: { id: plan.id },
    data: { cancelRequestedAt: plan.cancelRequestedAt ?? now, cancelEffectiveAt: effectiveAt },
  });
  const rejoinToken = await ensureRejoinToken(plan.id);
  if (opts.existingRequestId) {
    await prisma.cancelRequest.update({
      where: { id: opts.existingRequestId },
      data: { outcome: "cancelled", resolvedAt: now },
    });
  } else {
    await prisma.cancelRequest.create({
      data: {
        planId: plan.id,
        engineerId: plan.engineerId,
        reason: opts.reason,
        detail: opts.detail ?? null,
        offer: opts.offer ?? null,
        outcome: "cancelled",
        source: opts.source,
        moveDate: opts.moveDate ?? null,
        passportConsent: opts.passportConsent ?? null,
        resolvedAt: now,
      },
    });
  }

  // No welcome follow-ups to someone leaving; service reminders that would
  // land after the plan ends go too (deleted on undo, see undoCancellation).
  await cancelScheduledSms(`welcome:${plan.id}`);
  await prisma.outboundSms.updateMany({
    where: { cancelKey: { startsWith: `svc:${plan.id}` }, status: "QUEUED", sendAfter: { gte: effectiveAt } },
    data: { status: "CANCELLED" },
  });
  await queueWinback(plan.id, effectiveAt, rejoinToken);

  await track(
    "plan_cancelled",
    opts.source === "customer"
      ? { type: "CUSTOMER", id: plan.customerId }
      : { type: "ENGINEER", id: plan.engineerId },
    {
      planId: plan.id,
      ref: plan.ref,
      reason: opts.source === "customer" ? "customer_portal" : "engineer_logged",
      reasonCode: opts.reason,
      offer: opts.offer ?? null,
      effectiveAt: effectiveAt.toISOString(),
    },
  );

  // Installer alert: instant, so they can call before the paid month ends.
  const who = `${plan.customer.firstName} ${plan.customer.lastName}`;
  if (opts.source === "customer") {
    const ends = endedNow ? "Plan ended (cooling-off)" : `Plan ends ${shortDate(effectiveAt)}`;
    const line = `${who} wants to cancel · Reason: ${reasonLabel(opts.reason)} · ${ends}`;
    await notifyEngineer(plan.engineerId, endedNow ? `${line}.` : `${line}. A quick call saves most customers.`);
    await sendPushNotification(plan.engineerId, `${who} wants to cancel`, `Reason: ${reasonLabel(opts.reason)} · ${ends}`, {
      url: `/customer/${plan.customerId}`,
    });
  }

  // The confirmation, with the end date and a one-tap rejoin. The request
  // already stands; a mail failure mustn't make anyone think it didn't.
  const brand = brandName(plan.engineer);
  if (plan.customer.email) {
    const rejoin = `${appUrl()}/rejoin/${rejoinToken}`;
    await sendEmail({
      to: plan.customer.email,
      replyTo: plan.engineer.email,
      subject: endedNow
        ? `Your ${brand} care plan is cancelled (${plan.ref})`
        : `Your ${brand} care plan ends on ${longDate(effectiveAt)} (${plan.ref})`,
      html: `<p>Hi ${escapeHtml(plan.customer.firstName)},</p>
<p>${opts.source === "customer" ? "As you asked, your" : `As agreed with ${escapeHtml(brand)}, your`} ${escapeHtml(plan.tier?.name ?? "care")} plan (${plan.ref}) is cancelled.
${
        endedNow
          ? "It has ended today, inside your 14-day cooling-off period, so nothing more will be collected and any payment already taken is refunded in full."
          : `It ends on <b>${longDate(effectiveAt)}</b>, the end of the month you've paid for. Your plan carries on as normal until then, and no more payments will be taken after it.`
      }</p>
<p>Changed your mind? <a href="${rejoin}"><b>Rejoin</b></a> in one tap.</p>
<p>Questions? Just reply to ${escapeHtml(brand)}.</p>`,
    }).catch((err) => console.error("[cancel] confirmation email failed:", err));
  }
  return { ok: true, effectiveAt, endedNow };
}

// The customer or installer takes it back before the end date: billing
// resumes as if nothing happened.
export async function undoCancellation(
  planId: string,
  by: "customer" | "engineer",
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: { customer: true } });
  if (!plan) return { ok: false, status: 404, error: "Not found." };
  if (plan.status === "CANCELLED" || !plan.cancelRequestedAt) {
    return { ok: false, status: 409, error: "This plan isn't waiting to end." };
  }
  if (plan.cancelEffectiveAt && plan.cancelEffectiveAt <= new Date()) {
    return { ok: false, status: 409, error: "This plan has already ended." };
  }
  try {
    await undoCancel(plan.id);
  } catch (err) {
    console.error("[cancel] undoCancel failed:", err);
    return { ok: false, status: 502, error: "Could not update the payment provider. Try again in a minute." };
  }
  await prisma.plan.update({
    where: { id: plan.id },
    data: { cancelRequestedAt: null, cancelEffectiveAt: null },
  });
  const latest = await prisma.cancelRequest.findFirst({
    where: { planId: plan.id, outcome: "cancelled" },
    orderBy: { createdAt: "desc" },
  });
  if (latest) {
    await prisma.cancelRequest.update({
      where: { id: latest.id },
      data: { outcome: "saved", resolvedAt: new Date() },
    });
  }
  await cancelScheduledSms(`winback:${plan.id}`);
  // Let the reminder engine queue this year's service texts again.
  await prisma.outboundSms.deleteMany({
    where: { cancelKey: { startsWith: `svc:${plan.id}` }, status: "CANCELLED" },
  });
  await track("plan_cancel_undone", by === "customer"
    ? { type: "CUSTOMER", id: plan.customerId }
    : { type: "ENGINEER", id: plan.engineerId }, { planId: plan.id, by });
  if (by === "customer") {
    const who = `${plan.customer.firstName} ${plan.customer.lastName}`;
    await notifyEngineer(plan.engineerId, `${who} is keeping their plan after all.`);
    await sendPushNotification(plan.engineerId, "Plan kept", `${who} is keeping their plan after all.`, {
      url: `/customer/${plan.customerId}`,
    });
  }
  return { ok: true };
}

// A save on the customer's screens (kept, paused, switched): stored so the
// dashboards see every reason and outcome, not just the cancels.
export async function recordSave(
  planId: string,
  opts: {
    reason: CancelReason;
    offer: string | null;
    outcome: "saved" | "paused" | "downgraded";
    source?: CancelSource;
    detail?: string | null;
    moveDate?: Date | null;
    passportConsent?: boolean | null;
  },
) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId }, select: { engineerId: true } });
  await prisma.cancelRequest.create({
    data: {
      planId,
      engineerId: plan.engineerId,
      reason: opts.reason,
      offer: opts.offer,
      outcome: opts.outcome,
      source: opts.source ?? "customer",
      detail: opts.detail ?? null,
      moveDate: opts.moveDate ?? null,
      passportConsent: opts.passportConsent ?? null,
      resolvedAt: new Date(),
    },
  });
  await track("cancel_saved", { type: "SYSTEM" }, { planId, reason: opts.reason, offer: opts.offer, outcome: opts.outcome });
}

// Section 9 — win-back: 30 days after the plan ended, and again before
// winter. Marketing class, so lib/sms.ts adds the STOP line, honours
// opt-outs and holds it out of quiet hours.
async function queueWinback(planId: string, effectiveAt: Date, rejoinToken: string) {
  const plan = await prisma.plan.findUniqueOrThrow({
    where: { id: planId },
    include: { customer: true, engineer: true },
  });
  await cancelScheduledSms(`winback:${plan.id}`);
  const setting = await prisma.appSetting.findUnique({ where: { key: winbackSettingKey(plan.engineerId) } });
  const offer = parseWinbackOffer(setting?.value);
  const brand = brandName(plan.engineer);
  const link = `${appUrl()}/rejoin/${rejoinToken}`;
  const first = addDays(effectiveAt, WINBACK_DELAY_DAYS);
  first.setHours(10, 0, 0, 0);
  const winter = nextWinterDate(first);
  for (const [sendAfter, isWinter] of [
    [first, false],
    [winter, true],
  ] as const) {
    await sendSms({
      engineerId: plan.engineerId,
      to: plan.customer.phone,
      body: winbackBody({ firstName: plan.customer.firstName, brand, offer, link, winter: isWinter }),
      messageClass: "MARKETING",
      sendAfter,
      cancelKey: `winback:${plan.id}:${isWinter ? "winter" : "30d"}`,
    });
  }
}

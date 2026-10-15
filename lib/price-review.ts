import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { appUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { stripeConfigured, updateSubscriptionPrice } from "@/lib/stripe";
import { TIER_PRICE_MIN_PENCE } from "@/lib/clauses";

// Build Review 2, ruling 3 — "Annual price review. At most once a year. The
// customer gets 30 days' notice by text and email showing the old price, the
// new price and the date it starts, with a free cancel link in the same
// message. James may add a % cap, so build the cap as a setting."
export const PRICE_REVIEW_NOTICE_DAYS = 30;
export const PRICE_REVIEW_INTERVAL_MONTHS = 12;

// CONFIG: PRICE_REVIEW_CAP_PERCENT — maximum rise per review (e.g. "10").
// Unset means no cap. Moves to the admin settings screen when that exists.
export function priceReviewCapPercent(): number | null {
  const raw = process.env.PRICE_REVIEW_CAP_PERCENT;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

export function noticeEffectiveDate(now: Date = new Date()): Date {
  return new Date(now.getTime() + PRICE_REVIEW_NOTICE_DAYS * 24 * 60 * 60 * 1000);
}

// A new price can start no sooner than a year after the price they're on
// started — their signup, or the last review that took effect.
export function earliestNextReview(opts: { activatedAt: Date; lastEffectiveAt: Date | null }): Date {
  return addMonths(opts.lastEffectiveAt ?? opts.activatedAt, PRICE_REVIEW_INTERVAL_MONTHS);
}

export function priceReviewError(opts: {
  oldPence: number;
  newPence: number;
  capPercent: number | null;
}): string | null {
  if (opts.newPence < TIER_PRICE_MIN_PENCE) return "The minimum plan price is £10 a month.";
  if (opts.newPence === opts.oldPence) return "That's the price they already pay.";
  if (opts.capPercent !== null && opts.newPence > opts.oldPence * (1 + opts.capPercent / 100)) {
    return `A price review can raise the price by at most ${opts.capPercent}%.`;
  }
  return null;
}

const pounds = (p: number) => `£${(p / 100).toFixed(2)}`;
const longDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

type Candidate = {
  planId: string;
  customerName: string;
  oldPence: number;
  eligible: boolean;
  earliest: Date;
  pending: boolean;
};

// Who on this tier a review would reach, and who has to wait (reviewed or
// joined less than a year before the new price would start).
export async function priceReviewCandidates(tierId: string, engineerId: string, now = new Date()) {
  const effectiveAt = noticeEffectiveDate(now);
  const plans = await prisma.plan.findMany({
    where: { tierId, engineerId, status: { in: ["ACTIVE", "PAUSED"] }, activatedAt: { not: null } },
    include: { customer: true, priceReviews: { orderBy: { effectiveAt: "desc" } } },
  });
  const candidates: Candidate[] = plans.map((p) => {
    const pending = p.priceReviews.some((r) => !r.appliedAt && !r.voidedAt);
    const lastEffective = p.priceReviews.find((r) => r.appliedAt)?.effectiveAt ?? null;
    const earliest = earliestNextReview({ activatedAt: p.activatedAt!, lastEffectiveAt: lastEffective });
    return {
      planId: p.id,
      customerName: `${p.customer.firstName} ${p.customer.lastName}`,
      oldPence: p.priceMonthlyPence ?? 0,
      eligible: !pending && earliest <= effectiveAt,
      earliest,
      pending,
    };
  });
  return { effectiveAt, candidates };
}

export async function sendPriceReview(opts: {
  tierId: string;
  engineerId: string;
  newPence: number;
  now?: Date;
}): Promise<{ sent: number; skipped: number; effectiveAt: Date }> {
  const now = opts.now ?? new Date();
  const { effectiveAt, candidates } = await priceReviewCandidates(opts.tierId, opts.engineerId, now);
  const cap = priceReviewCapPercent();
  let sent = 0;
  for (const c of candidates) {
    if (!c.eligible || priceReviewError({ oldPence: c.oldPence, newPence: opts.newPence, capPercent: cap })) {
      continue;
    }
    const plan = await prisma.plan.findUniqueOrThrow({
      where: { id: c.planId },
      include: { customer: true, engineer: true, tier: true },
    });
    await prisma.priceReview.create({
      data: { planId: plan.id, oldPence: c.oldPence, newPence: opts.newPence, noticeSentAt: now, effectiveAt },
    });
    const brand = brandName(plan.engineer);
    const manage = `${appUrl()}/portal/${plan.portalToken}`;
    const lines = `${pounds(c.oldPence)} to ${pounds(opts.newPence)} a month from ${longDate(effectiveAt)}`;
    await sendSms({
      engineerId: plan.engineerId,
      to: plan.customer.phone,
      body: `Hi ${plan.customer.firstName} — ${brand}'s annual price review: your care plan changes from ${lines}. Nothing to do if you're happy. To cancel free of charge before then: ${manage}`,
      messageClass: "TRANSACTIONAL",
      consentBasis: "plan-member-transactional",
    });
    if (plan.customer.email) {
      await sendEmail({
        to: plan.customer.email,
        subject: `Your ${brand} care plan price is changing (${plan.ref})`,
        html: `<p>Hi ${plan.customer.firstName},</p>
<p>${brand} has reviewed their care plan prices. Your ${plan.tier?.name ?? ""} plan (${plan.ref}) will change:</p>
<p><b>Old price:</b> ${pounds(c.oldPence)} a month<br><b>New price:</b> ${pounds(opts.newPence)} a month<br><b>Starts:</b> ${longDate(effectiveAt)}</p>
<p>What your plan includes stays the same. If you're happy, there's nothing to do — the new amount is collected by Direct Debit from that date.</p>
<p>If you'd rather not continue, you can cancel free of charge at any time before then: <a href="${manage}">manage your plan</a>.</p>`,
      }).catch((err) => console.error("[price-review] notice email failed:", err));
    }
    sent++;
  }
  await track("price_review_sent", { type: "ENGINEER", id: opts.engineerId }, {
    tierId: opts.tierId,
    newPence: opts.newPence,
    sent,
    skipped: candidates.length - sent,
  });
  return { sent, skipped: candidates.length - sent, effectiveAt };
}

// Daily job: move each due plan to its new price at Stripe and on the plan.
// A failed Stripe update leaves the row unapplied so the next run retries.
export async function applyDuePriceReviews(now = new Date()): Promise<number> {
  const due = await prisma.priceReview.findMany({
    where: { effectiveAt: { lte: now }, appliedAt: null, voidedAt: null },
    include: { plan: true },
  });
  let applied = 0;
  for (const r of due) {
    if (r.plan.status === "CANCELLED") {
      await prisma.priceReview.update({ where: { id: r.id }, data: { voidedAt: now } });
      continue;
    }
    try {
      if (r.plan.stripeSubscriptionId && stripeConfigured()) {
        await updateSubscriptionPrice(r.plan.stripeSubscriptionId, r.newPence);
      }
      await prisma.$transaction([
        prisma.plan.update({ where: { id: r.planId }, data: { priceMonthlyPence: r.newPence } }),
        prisma.priceReview.update({ where: { id: r.id }, data: { appliedAt: now } }),
      ]);
      await track("price_review_applied", { type: "SYSTEM" }, {
        planId: r.planId,
        oldPence: r.oldPence,
        newPence: r.newPence,
      });
      applied++;
    } catch (err) {
      console.error(`[price-review] apply failed for plan ${r.planId}:`, err);
    }
  }
  return applied;
}

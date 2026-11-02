import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { sendSms } from "@/lib/sms";
import { sendPushNotification } from "@/lib/push";
import { newToken } from "@/lib/plans";
import { profileUrl } from "@/lib/public-url";
import { normaliseUkPhone } from "@/lib/phone";
import { checkEmergency } from "@/lib/compliance/interlock";
import { offerBlockedReason } from "@/lib/verification-state";
import { alertLowRating, isLowRating, isValidStars, publicCustomerName } from "@/lib/ratings";
import { fillFollowUp, reasonContent, type ReasonContent } from "@/lib/visit-reasons";

// 30 Oct update §6 — one at-the-job offer: the reason the installer picked,
// how the customer saw the plans ("Show them now" on the installer's phone,
// or a link sent to theirs), and the review asked for afterwards.

export type OfferChannel = "show" | "sms" | "whatsapp";

const DAY = 24 * 60 * 60 * 1000;

/** Follow-ups at 2 and 7 days (Matt, 30 Oct), sent mid-morning. */
export function followUpTimes(now: Date): [Date, Date] {
  return [2, 7].map((d) => {
    const t = new Date(now.getTime() + d * DAY);
    t.setHours(10, 0, 0, 0);
    return t;
  }) as [Date, Date];
}

export async function startOfferSession(opts: {
  engineerId: string;
  soldById: string | null;
  reason: string;
  channel: OfferChannel;
  planId?: string;
}): Promise<{ token: string; content: ReasonContent }> {
  const token = newToken();
  const content = await reasonContent(opts.reason, token);
  await prisma.offerSession.create({
    data: {
      token,
      engineerId: opts.engineerId,
      soldById: opts.soldById,
      reason: opts.reason,
      variant: content.variant,
      channel: opts.channel,
      planId: opts.planId ?? null,
    },
  });
  if (opts.planId) {
    await prisma.plan.update({
      where: { id: opts.planId },
      data: { visitReason: opts.reason, visitVariant: content.variant },
    });
  }
  // Conversion by reason: offer_started → plan_activated via Plan.visitReason.
  await track("offer_started", { type: "ENGINEER", id: opts.engineerId }, {
    reason: opts.reason,
    variant: content.variant,
    channel: opts.channel,
    soldById: opts.soldById,
    planId: opts.planId ?? null,
  });
  return { token, content };
}

/** Queues the reason's 2- and 7-day texts. Marketing class: STOP line and quiet hours apply. */
export async function queueFollowUps(opts: {
  engineerId: string;
  phone: string;
  firstName: string;
  link: string;
  content: ReasonContent;
  cancelKey: string;
  now?: Date;
}) {
  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: opts.engineerId } });
  const v = { first: opts.firstName, engineer: brandName(engineer), link: opts.link };
  const [d2, d7] = followUpTimes(opts.now ?? new Date());
  for (const [sendAfter, text] of [
    [d2, opts.content.followUp2d],
    [d7, opts.content.followUp7d],
  ] as const) {
    await sendSms({
      engineerId: opts.engineerId,
      to: opts.phone,
      body: fillFollowUp(text, v),
      messageClass: "MARKETING",
      sendAfter,
      cancelKey: opts.cancelKey,
    });
  }
}

export async function sessionForBusiness(token: string, businessId: string) {
  const s = await prisma.offerSession.findUnique({ where: { token } });
  return s && s.engineerId === businessId ? s : null;
}

/** What the review screen needs: did they join, and with which details. */
export async function sessionStatus(token: string, businessId: string) {
  const s = await sessionForBusiness(token, businessId);
  if (!s) return null;
  const [plan, review, engineer] = await Promise.all([
    s.planId ? prisma.plan.findUnique({ where: { id: s.planId }, include: { customer: true } }) : null,
    prisma.rating.findUnique({ where: { offerSessionId: s.id }, select: { id: true } }),
    prisma.engineer.findUnique({ where: { id: s.engineerId }, select: { town: true, tradingName: true, legalName: true, slug: true } }),
  ]);
  return {
    // "Every review moves you up the [Town] page." and the consent line's [Business].
    town: engineer?.town?.trim() || null,
    business: engineer ? brandName(engineer) : null,
    reason: s.reason,
    channel: s.channel,
    joined: Boolean(plan),
    reviewed: Boolean(review),
    customer: plan
      ? {
          firstName: plan.customer.firstName,
          lastName: plan.customer.lastName,
          phone: plan.customer.phone,
          email: plan.customer.email,
        }
      : null,
  };
}

/** Links a plan started on the customer page back to the offer it came from. */
export async function attachPlanToSession(token: string | undefined, engineerId: string, planId: string) {
  if (!token) return;
  const s = await prisma.offerSession.findUnique({ where: { token } });
  if (!s || s.engineerId !== engineerId) return;
  // The first plan started from this offer is the one the review carries.
  await prisma.offerSession.updateMany({ where: { id: s.id, planId: null }, data: { planId } });
  await prisma.plan.update({
    where: { id: planId },
    data: { visitReason: s.reason, visitVariant: s.variant, offerSessionId: s.id },
  });
}

export type ReviewInput = {
  stars: unknown;
  comment?: string | null;
  acknowledged?: boolean;
  /** Non-joiners only: who they are and the contact they verified. */
  name?: string;
  phone?: string | null;
  email?: string | null;
  verifiedPhone?: string | null;
  verifiedEmail?: string | null;
  /** "[Business] may send you occasional plan offers" — ticked by default. */
  consent: boolean;
};

export type ReviewResult =
  | { ok: true; low: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string; emergency?: boolean };

/**
 * "Before I go, would you leave me a quick review?" — every customer, joined
 * or not (30 Oct §6.4). Joiners' details carry over from their sign-up; a
 * non-joiner needs a mobile or email confirmed by a code. No review without
 * one or the other.
 */
export async function submitOfferReview(token: string, businessId: string, input: ReviewInput): Promise<ReviewResult> {
  const s = await sessionForBusiness(token, businessId);
  if (!s) return { ok: false, status: 404, error: "This offer has expired — start a new one." };
  if (await prisma.rating.findUnique({ where: { offerSessionId: s.id }, select: { id: true } })) {
    return { ok: false, status: 409, error: "They've already left a review — thank you." };
  }
  if (!isValidStars(input.stars)) return { ok: false, status: 400, error: "Tap 1 to 5 stars." };
  const stars = input.stars;
  const comment = input.comment?.trim().slice(0, 1000) || null;

  const plan = s.planId ? await prisma.plan.findUnique({ where: { id: s.planId }, include: { customer: true } }) : null;
  let firstName: string;
  let lastName: string;
  let phone: string | null = null;
  let email: string | null = null;
  if (plan) {
    ({ firstName, lastName, phone } = plan.customer);
    email = plan.customer.email;
  } else {
    const parts = (input.name ?? "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { ok: false, status: 400, error: "Enter your name." };
    firstName = parts[0];
    lastName = parts.slice(1).join(" ");
    phone = input.phone ? normaliseUkPhone(input.phone) : null;
    email = input.email?.trim().toLowerCase() || null;
    if (!phone && !email) return { ok: false, status: 400, error: "Enter your mobile or email so we know the review is real." };
    // Only a contact the customer proved with a code counts.
    const phoneOk = phone && input.verifiedPhone === phone;
    const emailOk = email && input.verifiedEmail?.toLowerCase() === email;
    if (!phoneOk && !emailOk) return { ok: false, status: 400, error: "Enter the code we sent you first." };
    if (!phoneOk) phone = null;
    if (!emailOk) email = null;
  }

  // Every free-text customer input runs the gas-emergency interlock (CLAUDE.md compliance 4).
  if (comment) {
    const check = checkEmergency(comment);
    if (check.emergency && !input.acknowledged) {
      await track("emergency_interlock_triggered", { type: "CUSTOMER", id: plan?.customerId }, {
        offerSessionId: s.id,
        matched: check.matched,
        surface: "offer_review",
      });
      await sendPushNotification(
        s.engineerId,
        "Gas safety alert",
        `${firstName} mentioned a possible gas emergency in their review and was told to call 0800 111 999.`,
      );
      return { ok: false, status: 409, error: "emergency", emergency: true };
    }
  }

  const customerName = publicCustomerName(firstName, lastName);
  const rating = await prisma.rating
    .create({
      data: {
        engineerId: s.engineerId,
        planId: plan?.id ?? null,
        source: "offer",
        offerSessionId: s.id,
        requestToken: newToken(),
        stars,
        comment,
        customerName,
        ratedAt: new Date(),
        contactPhone: phone,
        contactEmail: email,
        offerConsent: input.consent,
      },
    })
    .catch(() => null); // unique offerSessionId — a double tap already saved it
  if (!rating) return { ok: false, status: 409, error: "They've already left a review — thank you." };

  await track("rating_given", { type: "CUSTOMER", id: plan?.customerId }, {
    ratingId: rating.id,
    engineerId: s.engineerId,
    stars,
    source: "offer",
    reason: s.reason,
    joined: Boolean(plan),
    consent: input.consent,
  });

  // A non-joiner who agreed to plan offers goes in the book, and hears from
  // the installer at 2 and 7 days (the reason's follow-ups, marketing class).
  if (!plan && phone && input.consent) {
    const customer = await prisma.customer.upsert({
      where: { engineerId_phone: { engineerId: s.engineerId, phone } },
      // An earlier STOP stays in force: sendSms checks the opt-out store.
      update: { email: email ?? undefined },
      create: {
        engineerId: s.engineerId,
        addedById: s.soldById,
        firstName,
        lastName: lastName || "",
        phone,
        email,
        source: "doorstep",
      },
    });
    const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: s.engineerId }, select: { slug: true } });
    await queueFollowUps({
      engineerId: s.engineerId,
      phone,
      firstName,
      link: profileUrl(engineer.slug),
      content: await reasonContent(s.reason, s.token),
      cancelKey: `nudge:review:${customer.id}`,
    });
  }

  const low = isLowRating(stars);
  if (low) await alertLowRating(rating.id);
  else {
    await sendPushNotification(s.engineerId, "New review", `${customerName} gave you ${stars} stars.`, { url: "/ratings" });
  }
  return { ok: true, low };
}

/**
 * Why this person can't make an offer right now, or null: the business's
 * standing plus their own Gas Safe badge (a staff engineer can't sell until
 * their card is approved). Same rule as POST /api/offer.
 */
export async function offerGate(actor: { businessId: string; actorId: string }): Promise<string | null> {
  const [business, person] = await Promise.all([
    prisma.engineer.findUnique({
      where: { id: actor.businessId },
      select: { gasSafeVerifiedAt: true, pausedAt: true, bannedAt: true, stripeChargesEnabled: true },
    }),
    prisma.engineer.findUnique({ where: { id: actor.actorId }, select: { gasSafeVerifiedAt: true } }),
  ]);
  if (!business || !person) return "Not signed in.";
  return offerBlockedReason({ ...business, gasSafeVerifiedAt: person.gasSafeVerifiedAt });
}

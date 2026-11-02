// 30 Oct update §7.7 — "Send me the details": a customer on the plan page
// who's thinking about it leaves a name and mobile with consent. They get
// the plan link now, then again at 2 and 7 days, unless they join first.
// The texts are marketing-class (lib/sms.ts adds STOP, honours opt-outs and
// quiet hours), sent in the engineer's name.
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { cancelScheduledSms, sendSms } from "@/lib/sms";
import { planLinkUrl } from "@/lib/public-url";
import { planSlugs } from "@/lib/plan-slugs";
import { track } from "@/lib/track";
import { SERVICE_SHORT_LINE } from "@/lib/yearly-service";

export const DETAILS_FOLLOW_UP_DAYS = [2, 7] as const;
const DAY = 24 * 60 * 60 * 1000;

export const detailsCancelKey = (id: string) => `details:${id}`;

export function detailsTexts(v: { first: string; brand: string; link: string }) {
  return {
    now: `Hi ${v.first}, here's the ${v.brand} care plan you asked about: ${v.link}`,
    day2: `Hi ${v.first}, ${v.brand} here. ${SERVICE_SHORT_LINE} Your plan link: ${v.link}`,
    day7: `Hi ${v.first}, a last reminder from ${v.brand}: your care plan link is still here when you're ready: ${v.link}`,
  };
}

export async function requestDetails(opts: {
  engineerId: string;
  name: string;
  phone: string;
  tierId?: string | null;
  source?: string;
  /** Hashed (lib/enquiries.ts ipHash), for rate limiting. */
  ip?: string;
  now?: Date;
}): Promise<{ id: string }> {
  const now = opts.now ?? new Date();
  const engineer = await prisma.engineer.findUniqueOrThrow({
    where: { id: opts.engineerId },
    select: { slug: true, tradingName: true, legalName: true },
  });
  // Same order lib/plan-slugs.ts reads, so the plan's own link is stable.
  const live = await prisma.planTier.findMany({
    where: { engineerId: opts.engineerId, status: "LIVE" },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  const tier = live.find((t) => t.id === opts.tierId) ?? null;
  const row = await prisma.detailsRequest.create({
    data: {
      engineerId: opts.engineerId,
      tierId: tier?.id ?? null,
      name: opts.name,
      phone: opts.phone,
      consentAt: now,
      source: opts.source ?? "web",
    },
  });
  const link = planLinkUrl(engineer.slug, tier ? planSlugs(live).get(tier.id) : null);
  const texts = detailsTexts({ first: opts.name.split(/\s+/)[0], brand: brandName(engineer), link: `${link}?src=details` });
  const sends: [string, Date][] = [
    [texts.now, now],
    [texts.day2, new Date(now.getTime() + DETAILS_FOLLOW_UP_DAYS[0] * DAY)],
    [texts.day7, new Date(now.getTime() + DETAILS_FOLLOW_UP_DAYS[1] * DAY)],
  ];
  for (const [body, sendAfter] of sends) {
    await sendSms({
      engineerId: opts.engineerId,
      to: opts.phone,
      body,
      messageClass: "MARKETING",
      consentBasis: "details-request",
      sendAfter,
      cancelKey: detailsCancelKey(row.id),
    });
  }
  await track("details_requested", { type: "CUSTOMER" }, {
    engineerId: opts.engineerId,
    detailsRequestId: row.id,
    tierId: tier?.id,
    ip: opts.ip,
  });
  return { id: row.id };
}

/** Joining stops the follow-ups for that number with this engineer. */
export async function markDetailsJoined(engineerId: string, phone: string | null | undefined): Promise<void> {
  if (!phone) return;
  const open = await prisma.detailsRequest.findMany({ where: { engineerId, phone, joinedAt: null }, select: { id: true } });
  if (!open.length) return;
  await prisma.detailsRequest.updateMany({ where: { id: { in: open.map((r) => r.id) } }, data: { joinedAt: new Date() } });
  for (const r of open) await cancelScheduledSms(detailsCancelKey(r.id));
}

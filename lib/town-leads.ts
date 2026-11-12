import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { brandName } from "@/lib/engineer";
import { notifyEngineer, sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-layout";
import { sendPushNotification } from "@/lib/push";
import { postcodeDistrict } from "@/lib/retention";
import { LISTED_ENGINEER_WHERE } from "@/lib/town";
import { foundingMemberIds } from "@/lib/founding";

// 30 Oct update §10 — "first pick of homeowner leads in their town";
// the window is 24 hours (Matt, 12 Nov: "We agreed 24 hours"). Every other enquiry is addressed to one engineer and is never
// redirected; this is the only kind of lead that isn't: a homeowner on a
// town page asking for "a gas engineer near you". Founding Members in the
// town see it first; after the window it opens to every listed engineer in
// the town. Whoever claims it first gets the contact details.

/** Admin setting (AppSetting) for the Founding-first window, in minutes. */
export const FOUNDING_FIRST_MINUTES_KEY = "town_lead_founding_minutes";
export const DEFAULT_FOUNDING_FIRST_MINUTES = 24 * 60;
/** Unclaimed requests stop showing after this, so the list never fills with stale ones. */
export const LEAD_SHOWN_DAYS = 14;

export function foundingFirstMinutesFrom(setting: string | null | undefined): number {
  const n = Number(setting);
  return Number.isFinite(n) && n >= 0 && n <= 24 * 60 ? Math.round(n) : DEFAULT_FOUNDING_FIRST_MINUTES;
}

async function foundingFirstMinutes(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: FOUNDING_FIRST_MINUTES_KEY } }).catch(() => null);
  return foundingFirstMinutesFrom(row?.value);
}

export type LeadState = { claimedById: string | null; openedAt: Date | null; foundingUntil: Date; createdAt: Date };

/** Open to everyone in the town: by the clock, so it never waits on a job run. */
export function leadOpenToAll(lead: LeadState, now: Date): boolean {
  return lead.openedAt !== null || now >= lead.foundingUntil;
}

/** Who may see and claim an unclaimed request: Founding Members at once, everyone else once it's open. */
export function leadOpenTo(lead: LeadState, viewer: { founding: boolean }, now: Date): boolean {
  if (lead.claimedById) return false;
  if (now.getTime() - lead.createdAt.getTime() > LEAD_SHOWN_DAYS * 86_400_000) return false;
  return viewer.founding || leadOpenToAll(lead, now);
}

/** "Pat" from "Pat Hughes": engineers see a first name and district until they claim it. */
export function leadTeaser(lead: { name: string; postcode: string }): string {
  const first = lead.name.trim().split(/\s+/)[0] || "Someone";
  const district = postcodeDistrict(lead.postcode);
  return district ? `${first} in ${district}` : first;
}

async function townAudience(townSlug: string) {
  const engineers = await prisma.engineer.findMany({
    where: { townSlug, ...LISTED_ENGINEER_WHERE },
    select: { id: true },
  });
  const ids = engineers.map((e) => e.id);
  const founding = await foundingMemberIds(ids);
  return { ids, founding };
}

function windowText(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

async function tell(engineerIds: string[], town: string, teaser: string, mode: "founding" | "open", minutes: number) {
  const body =
    mode === "founding"
      ? `TradeSura: new homeowner request in ${town} (${teaser}). As a Founding Member you get first pick for ${windowText(minutes)}. Open the app to claim it.`
      : `TradeSura: new homeowner request in ${town} (${teaser}). The first engineer to claim it gets it. Open the app to claim it.`;
  for (const id of engineerIds) {
    await sendPushNotification(id, "New homeowner request", `${teaser} in ${town} needs a gas engineer.`, {
      url: "/enquiries",
    }).catch(() => {});
    await notifyEngineer(
      id,
      body,
      mode === "founding"
        ? { template: "town_lead_founding", vars: [town, teaser, windowText(minutes)] }
        : { template: "town_lead_open", vars: [town, teaser] },
    ).catch((err) => console.error("[town-lead] alert failed:", err));
  }
}

export async function createTownLead(
  input: {
    townSlug: string;
    townName: string;
    name: string;
    phone: string | null;
    email: string | null;
    postcode: string;
    message: string;
    emergency: string | null;
  },
  now = new Date(),
) {
  await openDueTownLeads(now).catch((err) => console.error("[town-lead] open failed:", err));
  const minutes = await foundingFirstMinutes();
  const { ids, founding } = await townAudience(input.townSlug);
  // No Founding Members here (or a zero window): open to everyone straight away.
  const foundingFirst = founding.size > 0 && minutes > 0;
  const lead = await prisma.townLead.create({
    data: {
      townSlug: input.townSlug,
      name: input.name,
      phone: input.phone,
      email: input.email,
      postcode: input.postcode.toUpperCase(),
      message: input.message,
      consentAt: now,
      emergency: input.emergency,
      foundingUntil: new Date(now.getTime() + (foundingFirst ? minutes : 0) * 60_000),
      openedAt: foundingFirst ? null : now,
      createdAt: now,
    },
  });
  await track("town_lead_created", { type: "CUSTOMER" }, {
    leadId: lead.id,
    townSlug: input.townSlug,
    foundingFirst,
    foundingCount: founding.size,
    audience: ids.length,
  });
  const teaser = leadTeaser(lead);
  if (foundingFirst) await tell([...founding], input.townName, teaser, "founding", minutes);
  else await tell(ids, input.townName, teaser, "open", minutes);
  return lead;
}

/**
 * Opens every request whose Founding window has passed and tells the rest of
 * the town. Access already opens by the clock (leadOpenToAll); this sends the
 * alert. The jobs cron is daily on the Hobby plan, so it also runs whenever a
 * request comes in or an engineer opens Enquiries. Safe to run twice — the
 * openedAt guard means each request opens (and alerts) once.
 */
export async function openDueTownLeads(now = new Date()): Promise<number> {
  const due = await prisma.townLead.findMany({
    where: { openedAt: null, claimedById: null, foundingUntil: { lte: now } },
    select: { id: true, townSlug: true, name: true, postcode: true },
  });
  let opened = 0;
  for (const lead of due) {
    const { count } = await prisma.townLead.updateMany({
      where: { id: lead.id, openedAt: null, claimedById: null },
      data: { openedAt: now },
    });
    if (count !== 1) continue;
    opened += 1;
    const { ids, founding } = await townAudience(lead.townSlug);
    const page = await prisma.townPage.findUnique({ where: { slug: lead.townSlug }, select: { name: true } });
    await track("town_lead_opened", { type: "SYSTEM" }, { leadId: lead.id, townSlug: lead.townSlug });
    await tell(
      ids.filter((id) => !founding.has(id)),
      page?.name ?? lead.townSlug,
      leadTeaser(lead),
      "open",
      0,
    );
  }
  return opened;
}

/** Requests this engineer can see right now: their town, unclaimed, open to them. */
export async function townLeadsFor(engineerId: string, now = new Date()) {
  const engineer = await prisma.engineer.findFirst({
    where: { id: engineerId, ...LISTED_ENGINEER_WHERE },
    select: { townSlug: true },
  });
  if (!engineer?.townSlug) return [];
  await openDueTownLeads(now).catch((err) => console.error("[town-lead] open failed:", err));
  const founding = (await foundingMemberIds([engineerId])).has(engineerId);
  const rows = await prisma.townLead.findMany({
    where: { townSlug: engineer.townSlug, claimedById: null },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return rows
    .filter((l) => leadOpenTo(l, { founding }, now))
    .map((l) => ({
      id: l.id,
      teaser: leadTeaser(l),
      message: l.message,
      createdAt: l.createdAt.toISOString(),
      foundingOnly: !leadOpenToAll(l, now),
      foundingUntil: l.foundingUntil.toISOString(),
    }));
}

export class LeadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/**
 * First to claim gets it. The claim is one conditional update, so two
 * engineers tapping at once can't both win. The contact details then land in
 * the winner's Enquiries like any other message.
 */
export async function claimTownLead(engineerId: string, leadId: string, now = new Date()) {
  const engineer = await prisma.engineer.findFirst({
    where: { id: engineerId, ...LISTED_ENGINEER_WHERE },
    select: { id: true, townSlug: true, tradingName: true, legalName: true, firstName: true, lastName: true, slug: true },
  });
  if (!engineer) throw new LeadError("Only verified engineers with a live plan and a published profile can take requests.", 403);
  const lead = await prisma.townLead.findUnique({ where: { id: leadId } });
  if (!lead || lead.townSlug !== engineer.townSlug) throw new LeadError("That request isn't in your town.", 404);
  const founding = (await foundingMemberIds([engineerId])).has(engineerId);
  if (!leadOpenTo(lead, { founding }, now)) {
    throw new LeadError(lead.claimedById ? "Another engineer has already taken this one." : "This request isn't open to you yet.", 409);
  }
  const { count } = await prisma.townLead.updateMany({
    where: { id: leadId, claimedById: null, ...(founding ? {} : { foundingUntil: { lte: now } }) },
    data: { claimedById: engineerId, claimedAt: now },
  });
  if (count !== 1) throw new LeadError("Another engineer has already taken this one.", 409);

  const enquiry = await prisma.enquiry.create({
    data: {
      engineerId,
      kind: "message",
      source: "town",
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      message: `${lead.message}\n\nPostcode: ${lead.postcode}`,
    },
  });
  await track("town_lead_claimed", { type: "ENGINEER", id: engineerId }, {
    leadId,
    enquiryId: enquiry.id,
    founding,
    duringFoundingWindow: !leadOpenToAll(lead, now),
    minutesToClaim: Math.round((now.getTime() - lead.createdAt.getTime()) / 60_000),
  });

  // Tell the homeowner who's coming back to them.
  const brand = brandName(engineer);
  const first = lead.name.trim().split(/\s+/)[0] || "there";
  if (lead.phone) {
    await sendSms({
      engineerId,
      to: lead.phone,
      body: `Hi ${first}, ${brand} on TradeSura has picked up your request for a gas engineer and will be in touch soon.`,
      messageClass: "TRANSACTIONAL",
      consentBasis: "town-lead-request",
    }).catch((err) => console.error("[town-lead] homeowner text failed:", err));
  } else if (lead.email) {
    await sendEmail({
      to: lead.email,
      subject: `${brand} will be in touch`,
      html: `<p>Hi ${escapeHtml(first)},</p><p>${escapeHtml(brand)} on TradeSura has picked up your request for a gas engineer and will be in touch soon.</p><p>Smell gas? Call the National Gas Emergency line free on 0800 111 999.</p>`,
    }).catch((err) => console.error("[town-lead] homeowner email failed:", err));
  }
  return {
    enquiryId: enquiry.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    postcode: lead.postcode,
    message: lead.message,
  };
}

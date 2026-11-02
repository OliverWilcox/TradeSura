import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { displayName } from "@/lib/engineer";
import { adminEvent, adminEvents } from "@/lib/admin-api/audit";
import { likeTerm } from "@/lib/admin-api/db";
import { conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { afterResponse, personName } from "@/lib/admin/verifications";
import { companyProfile } from "@/lib/admin/companies";
import { postcodeOf } from "@/lib/addresses";
import { foundingFor, type FoundingStatus } from "@/lib/admin/founding";
import { testMarks } from "@/lib/admin/metrics";
import { planLinkUrl, profileUrl } from "@/lib/public-url";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-layout";
import { sendPushNotification } from "@/lib/push";

// Founding-member packs for the admin API (Part 17.4). A pack is requested at
// signup, but the Verified Member seal never ships to an unverified, paused or
// banned account (Part 14 LAW): those wait in "held" until they can go. Someone
// posts the pack and marks it here; who did is recorded. This replaces the old
// /admin/verifications?key= page.

export type PackTab = "to_post" | "held" | "posted";

const requested = { deletedAt: null, packRequestedAt: { not: null } } satisfies Prisma.EngineerWhereInput;

const TAB_WHERE: Record<PackTab, Prisma.EngineerWhereInput> = {
  to_post: { ...requested, packShippedAt: null, gasSafeVerifiedAt: { not: null }, pausedAt: null, bannedAt: null },
  held: {
    ...requested,
    packShippedAt: null,
    OR: [{ gasSafeVerifiedAt: null }, { pausedAt: { not: null } }, { bannedAt: { not: null } }],
  },
  posted: { ...requested, packShippedAt: { not: null } },
};

const ORDER: Record<PackTab, Prisma.EngineerOrderByWithRelationInput[]> = {
  // Longest-verified first, so nobody waits behind newer badges.
  to_post: [{ gasSafeVerifiedAt: "asc" }, { id: "asc" }],
  held: [{ packRequestedAt: "asc" }, { id: "asc" }],
  posted: [{ packShippedAt: "desc" }, { id: "asc" }],
};

const SELECT = {
  id: true,
  slug: true,
  firstName: true,
  lastName: true,
  tradingName: true,
  legalName: true,
  packAddress: true,
  packRequestedAt: true,
  packShippedAt: true,
  gasSafeVerifiedAt: true,
  pausedAt: true,
  bannedAt: true,
  businessType: true,
  companyNumber: true,
  town: true,
} satisfies Prisma.EngineerSelect;

type Row = Prisma.EngineerGetPayload<{ select: typeof SELECT }>;

function heldBecause(r: Row): "not_verified" | "paused" | "banned" | null {
  if (r.packShippedAt) return null;
  if (r.bannedAt) return "banned";
  if (r.pausedAt) return "paused";
  if (!r.gasSafeVerifiedAt) return "not_verified";
  return null;
}

/**
 * 6.1: whether the pack's postal address can go to the printer. Missing, it's
 * blocked. An address the engineer or an admin has confirmed (by saving their
 * addresses: engineer record 1) goes where they said. Otherwise, for a
 * limited company, Companies House is asked: at the registered office, it's
 * blocked (they gave sign-up the registered office, not where post should
 * go: 302 MD LTD); if Companies House can't be asked ("unchecked"), it's
 * blocked too, since that's the same mistake unchecked (QA-06). Either is
 * cleared by confirming the address on their record.
 */
export type AddressCheck = "ok" | "unchecked" | "missing" | "registered_office";

const CONFIRMED_BY: ReadonlySet<string> = new Set(["engineer", "admin"]);

async function addressChecks(rows: Row[]): Promise<Map<string, AddressCheck>> {
  const confirmed = new Set(
    (await prisma.engineerTradingAddress.findMany({ where: { engineerId: { in: rows.map((r) => r.id) } }, select: { engineerId: true, source: true } }))
      .filter((t) => CONFIRMED_BY.has(t.source))
      .map((t) => t.engineerId),
  );
  const checks = await Promise.all(
    rows.map(async (r): Promise<[string, AddressCheck]> => {
      if (!r.packAddress?.trim()) return [r.id, "missing"];
      if (confirmed.has(r.id) || r.businessType !== "ltd" || !r.companyNumber) return [r.id, "ok"];
      const profile = await companyProfile(r.companyNumber);
      if (!profile) return [r.id, "unchecked"];
      const office = postcodeOf(profile.registeredOffice);
      return [r.id, office && office === postcodeOf(r.packAddress) ? "registered_office" : "ok"];
    }),
  );
  return new Map(checks);
}

/** Name, business or address containing the search text. */
function searchWhere(q: string | undefined): Prisma.EngineerWhereInput {
  if (!q) return {};
  const contains = { contains: likeTerm(q), mode: "insensitive" as const };
  return { OR: [{ firstName: contains }, { lastName: contains }, { tradingName: contains }, { legalName: contains }, { packAddress: contains }] };
}

/** Which pack: Founding, with its town, for an engineer holding a Founding spot (lib/admin/founding.ts); Standard otherwise. */
function packVersion(f: FoundingStatus | undefined): { kind: "standard" | "founding"; town: string | null } {
  return f && (f.state === "top_spot" || f.state === "badge") ? { kind: "founding", town: f.town } : { kind: "standard", town: null };
}

/**
 * A page of packs. With `count: "wont_print"` on the to_post tab it also says
 * how many of the packs matching the search won't print (QA-23), so the admin
 * can say so before a download. That checks every one of them, as a download
 * does, so the admin asks for it only on the list page.
 */
export async function listMemberPacks(q: { tab: PackTab; q?: string; page: number; size: number; count?: "wont_print" }) {
  const where = { AND: [TAB_WHERE[q.tab], searchWhere(q.q)] };
  const [rows, total, toPost, held, posted, matching] = await Promise.all([
    prisma.engineer.findMany({ where, orderBy: ORDER[q.tab], skip: (q.page - 1) * q.size, take: q.size, select: SELECT }),
    prisma.engineer.count({ where }),
    prisma.engineer.count({ where: TAB_WHERE.to_post }),
    prisma.engineer.count({ where: TAB_WHERE.held }),
    prisma.engineer.count({ where: TAB_WHERE.posted }),
    q.tab === "to_post" && q.count === "wont_print" ? prisma.engineer.findMany({ where, select: SELECT }) : null,
  ]);
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  const [checks, founding] = await Promise.all([
    // The page's rows are among `matching`, so one set of checks serves both.
    q.tab === "posted" ? new Map<string, AddressCheck>() : addressChecks(matching ?? rows),
    testMarks().then((marks) => foundingFor(marks, rows.map((r) => r.id))),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      name: personName(r),
      firstName: r.firstName,
      business: displayName(r),
      businessType: r.businessType,
      town: r.town,
      address: r.packAddress,
      addressCheck: checks.get(r.id) ?? "ok",
      version: packVersion(founding.get(r.id)),
      // What Ali's mail-merge template prints: their live page, referral code and the QR the app shows.
      livePage: profileUrl(r.slug),
      referralCode: r.slug,
      qrLink: `${planLinkUrl(r.slug)}?src=qr`,
      requestedAt: iso(r.packRequestedAt),
      verifiedAt: iso(r.gasSafeVerifiedAt),
      postedAt: iso(r.packShippedAt),
      heldBecause: heldBecause(r),
    })),
    page: q.page,
    size: q.size,
    total,
    counts: { to_post: toPost, held, posted },
    wontPrint: matching ? matching.filter((r) => checks.get(r.id) !== "ok").length : null,
  };
}

/** 6.4: tells each engineer their pack is on its way, by push and email. A failed send never undoes the posting. */
async function tellPacksPosted(engineerIds: string[]) {
  const engineers = engineerIds.length ? await prisma.engineer.findMany({ where: { id: { in: engineerIds } }, select: { id: true, email: true, firstName: true } }) : [];
  for (const e of engineers) {
    try {
      await sendPushNotification(e.id, "Your member pack is on its way", "Your TradeSura member pack is in the post.", { url: "/more" });
      if (e.email) {
        await sendEmail({
          to: e.email,
          subject: "Your member pack is on its way",
          html: `<p>Hi ${escapeHtml(e.firstName ?? "there")},</p><p>Your TradeSura member pack is on its way. It's in the post today, so it should be with you in a few days.</p>`,
        });
      }
    } catch (err) {
      console.error("[admin-api] pack posted notice failed:", err);
    }
  }
}

/** Marks a pack as posted. Only one that may go out and hasn't yet: two admins can't both post it. */
export async function markPackPosted(admin: AdminPrincipal, engineerId: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.engineer.updateMany({
      where: { id: engineerId, ...TAB_WHERE.to_post },
      data: { packShippedAt: now },
    });
    if (count === 0) {
      const row = await tx.engineer.findFirst({ where: { id: engineerId, deletedAt: null }, select: SELECT });
      if (!row) throw notFound("There's no engineer with that ID.");
      if (!row.packRequestedAt) throw conflict("This engineer hasn't asked for a member pack.");
      if (row.packShippedAt) throw conflict("This pack has already been marked as posted.");
      throw conflict(
        heldBecause(row) === "not_verified"
          ? "This pack can't go out until the engineer is Gas Safe verified."
          : "This pack can't go out while the engineer is paused or banned.",
      );
    }
    await adminEvent(admin, "member_pack_shipped", { engineerId }, tx);
  });
  await afterResponse(() => tellPacksPosted([engineerId]));
  return { id: engineerId, postedAt: now.toISOString() };
}

/** Why a pack can't be marked posted, for one that wasn't. */
function notPostable(row: Row | undefined): string {
  if (!row) return "There's no engineer with that ID.";
  if (!row.packRequestedAt) return "This engineer hasn't asked for a member pack.";
  if (row.packShippedAt) return "This pack has already been marked as posted.";
  return heldBecause(row) === "not_verified"
    ? "This pack can't go out until the engineer is Gas Safe verified."
    : "This pack can't go out while the engineer is paused or banned.";
}

/**
 * Marks several packs as posted on one date (today if not given). Each goes
 * only if it may go out and hasn't yet, checked and set in one statement, so
 * two admins can't both post one; the rest come back with the reason.
 */
export async function markPacksPosted(admin: AdminPrincipal, engineerIds: string[], postedOn?: string) {
  const at = postedOn ? new Date(`${postedOn}T12:00:00Z`) : new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "Engineer" SET "packShippedAt" = ${at}, "updatedAt" = now()
      WHERE id = ANY(${engineerIds}) AND "deletedAt" IS NULL AND "packRequestedAt" IS NOT NULL AND "packShippedAt" IS NULL
        AND "gasSafeVerifiedAt" IS NOT NULL AND "pausedAt" IS NULL AND "bannedAt" IS NULL
      RETURNING id`;
    const posted = new Set(updated.map((u) => u.id));
    await adminEvents(admin, "member_pack_shipped", [...posted].map((engineerId) => ({ engineerId, ...(postedOn ? { postedOn } : {}) })), tx);
    const others = engineerIds.filter((id) => !posted.has(id));
    const rows = others.length ? await tx.engineer.findMany({ where: { id: { in: others }, deletedAt: null }, select: SELECT }) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      posted: engineerIds.filter((id) => posted.has(id)),
      postedAt: at.toISOString(),
      skipped: others.map((id) => ({ id, reason: notPostable(byId.get(id)) })),
    };
  });
  await afterResponse(() => tellPacksPosted(result.posted));
  return result;
}

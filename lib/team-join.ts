import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { normaliseClaimCode } from "@/lib/claim";
import { normaliseCompanyNumber } from "@/lib/validate";
import { sendPushNotification } from "@/lib/push";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-layout";

// 30 Oct update 3.9 — "Two people from one firm: the second joins as staff on
// the same account, not a second account or Founding spot." A firm is
// recognised at sign-up by its letter code (already claimed) or its company
// number (already on an owner account). The second person then asks the
// owner to add them; the owner adds them from Team (which takes their Gas
// Safe card, as for any staff).

export type Firm = { ownerId: string; businessName: string; ownerFirstName: string | null };

export async function findFirm(opts: { claimCode?: string | null; companyNumber?: string | null }): Promise<Firm | null> {
  const live = { ownerId: null, deletedAt: null, bannedAt: null, leftAt: null } as const;
  let owner = null;
  if (opts.claimCode) {
    const claim = await prisma.claimCode.findUnique({
      where: { code: normaliseClaimCode(opts.claimCode) },
      select: { redeemedByEngineerId: true },
    });
    if (claim?.redeemedByEngineerId) {
      owner = await prisma.engineer.findFirst({ where: { id: claim.redeemedByEngineerId, ...live } });
    }
  }
  const number = opts.companyNumber ? normaliseCompanyNumber(opts.companyNumber) : "";
  if (!owner && number) {
    owner = await prisma.engineer.findFirst({ where: { companyNumber: number, ...live }, orderBy: { createdAt: "asc" } });
  }
  return owner ? { ownerId: owner.id, businessName: brandName(owner), ownerFirstName: owner.firstName } : null;
}

export type JoinRequest = { firstName: string; lastName: string; email: string; phone: string; gasSafeNo?: string };

/** Records the request and tells the owner by push and email. Returns the request's id. */
export async function requestToJoin(firm: Firm, who: JoinRequest): Promise<string> {
  const event = await prisma.event.create({
    data: {
      name: "team_join_requested",
      actorType: "SYSTEM",
      meta: { ownerId: firm.ownerId, ...who },
    },
    select: { id: true },
  });
  const name = `${who.firstName} ${who.lastName}`;
  await sendPushNotification(firm.ownerId, `${name} wants to join your team`, `Add them to ${firm.businessName} in Team.`, {
    url: `/team-add?request=${event.id}`,
  }).catch(() => {});
  const owner = await prisma.engineer.findUnique({ where: { id: firm.ownerId }, select: { email: true } });
  if (owner?.email) {
    await sendEmail({
      to: owner.email,
      subject: `${name} wants to join ${firm.businessName} on TradeSura`,
      html: `<p>Hi ${escapeHtml(firm.ownerFirstName ?? "there")},</p>
<p>${escapeHtml(name)} (${escapeHtml(who.email)}) tried to sign up for ${escapeHtml(firm.businessName)}, which already has your account, so we've asked them to join your team instead.</p>
<p>To add them, open the TradeSura app, go to Account, then Team, then Add an engineer, and add their Gas Safe ID card. Staff are free and see no money or settings.</p>
<p>If you don't know them, you can ignore this email.</p>`,
    }).catch((err) => console.error("[team-join] owner email failed:", err));
  }
  return event.id;
}

/** The request, for the owner's Add an engineer form. Only ever the owner's own. */
export async function joinRequestFor(ownerId: string, id: string): Promise<JoinRequest | null> {
  const event = await prisma.event.findUnique({ where: { id } });
  const meta = (event?.meta ?? {}) as Partial<JoinRequest> & { ownerId?: string };
  if (event?.name !== "team_join_requested" || meta.ownerId !== ownerId) return null;
  return {
    firstName: meta.firstName ?? "",
    lastName: meta.lastName ?? "",
    email: meta.email ?? "",
    phone: meta.phone ?? "",
    gasSafeNo: meta.gasSafeNo,
  };
}


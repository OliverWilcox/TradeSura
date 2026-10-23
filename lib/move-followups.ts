import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { notifyEngineer } from "@/lib/sms";
import { sendPushNotification } from "@/lib/push";
import { passportForCustomer } from "@/lib/passport";

// Retention spec §4 "Boiler stickers and the next owner" + §2 — a customer
// who cancels because they're moving, and consents to the Home Passport
// passing to the next owner, triggers two things a week after the moving
// date: the installer gets a "new owner" lead, and TradeSura queues a
// welcome letter to the address for posting (shown in /admin/retention).
export const MOVE_FOLLOWUP_DELAY_DAYS = 7;
// Older moves are left alone so a first run doesn't send stale leads.
export const MOVE_FOLLOWUP_WINDOW_DAYS = 60;
const DAY = 24 * 60 * 60 * 1000;

export type LetterMeta = {
  passportId: string;
  address: string;
  engineerId: string;
  letterFor: "new_owner";
  cancelRequestId: string;
};

export function letterAddress(p: { addressLine1: string; town: string | null; postcode: string }): string {
  return ["The Homeowner", p.addressLine1, p.town, p.postcode].filter(Boolean).join("\n");
}

export function newOwnerLeadText(addressLine1: string, moveDate: Date): string {
  const when = moveDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `New owner moving into ${addressLine1} around ${when} — the boiler's history is on the Home Passport; they may want a plan.`;
}

async function alreadyDone(name: string, path: string, value: string): Promise<boolean> {
  const hit = await prisma.event.findFirst({ where: { name, meta: { path: [path], equals: value } }, select: { id: true } });
  return Boolean(hit);
}

/** Daily job. Idempotent: one lead per cancel request, one letter per passport per move. */
export async function moveFollowUps(now = new Date()): Promise<{ leads: number; letters: number }> {
  const due = new Date(now.getTime() - MOVE_FOLLOWUP_DELAY_DAYS * DAY);
  const oldest = new Date(now.getTime() - MOVE_FOLLOWUP_WINDOW_DAYS * DAY);
  const requests = await prisma.cancelRequest.findMany({
    where: { reason: "moving", passportConsent: true, moveDate: { lte: due, gte: oldest } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      engineerId: true,
      moveDate: true,
      plan: { select: { customerId: true, passportId: true } },
    },
  });

  let leads = 0;
  let letters = 0;
  for (const r of requests) {
    if (!r.moveDate) continue;
    if (await alreadyDone("new_owner_lead_sent", "cancelRequestId", r.id)) continue;

    const passportId = r.plan.passportId ?? (await passportForCustomer(r.plan.customerId));
    if (!passportId) continue; // no real address on file — nothing to follow up
    const passport = await prisma.homePassport.findUnique({
      where: { id: passportId },
      select: { id: true, addressLine1: true, town: true, postcode: true },
    });
    if (!passport) continue;

    // Recorded before sending, so a crash part-way never double-texts.
    await track("new_owner_lead_sent", { type: "SYSTEM" }, {
      cancelRequestId: r.id,
      engineerId: r.engineerId,
      passportId,
    });
    const engineer = await prisma.engineer.findUnique({
      where: { id: r.engineerId },
      select: { leftAt: true, deletedAt: true },
    });
    if (engineer && !engineer.leftAt && !engineer.deletedAt) {
      const text = newOwnerLeadText(passport.addressLine1, r.moveDate);
      await sendPushNotification(r.engineerId, "New owner lead", text);
      await notifyEngineer(r.engineerId, text).catch((err) => console.error("[move] lead text failed:", err));
      leads += 1;
    }

    // Two plans at one address (say gas and another trade) means one letter.
    const recentLetter = await prisma.event.findFirst({
      where: {
        name: "welcome_letter_queued",
        ts: { gte: oldest },
        meta: { path: ["passportId"], equals: passportId },
      },
      select: { id: true },
    });
    if (!recentLetter) {
      const meta: LetterMeta = {
        passportId,
        address: letterAddress(passport),
        engineerId: r.engineerId,
        letterFor: "new_owner",
        cancelRequestId: r.id,
      };
      await track("welcome_letter_queued", { type: "SYSTEM" }, meta);
      letters += 1;
    }
  }
  return { leads, letters };
}

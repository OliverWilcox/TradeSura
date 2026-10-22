import { del } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { cancelScheduledSms } from "@/lib/sms";
import { offerNearbyEngineers } from "@/lib/installer-leaves";

// Build Review 2, section 10 — "Delete my account inside the app" (App Store
// rule 5.1.1). The Engineer row is anonymised rather than hard-deleted: plans,
// payments, fees and referral commission must stay intact for accounts, and
// they reference it. Everything that identifies a person goes.

export type DeleteResult =
  | { ok: true }
  | { ok: false; status: number; error: string; livePlans?: number };

const scrubbedEngineer = (id: string) => ({
  email: `deleted-${id}@deleted.invalid`,
  firstName: null,
  lastName: null,
  phone: null,
  phoneVerifiedAt: null,
  smsSignInEnabled: false,
  appleSub: null,
  logoUrl: null,
  postcode: null,
  gasSafeNo: null,
  gasSafeName: null,
  gasSafeCompany: null,
  gasSafeCategories: null,
  gasSafeCardUrl: null,
  expoPushToken: null,
  packAddress: null,
  attribution: undefined,
  deletedAt: new Date(),
});

async function removeBlob(url: string | null) {
  if (!url) return;
  await del(url).catch((err) => console.error("[delete-account] blob delete failed:", err));
}

export async function deleteStaffAccount(staffId: string): Promise<DeleteResult> {
  const staff = await prisma.engineer.findUniqueOrThrow({ where: { id: staffId } });
  await removeBlob(staff.gasSafeCardUrl);
  // Their customers and sales stay with the business (section 8).
  await prisma.engineer.update({
    where: { id: staffId },
    data: { ...scrubbedEngineer(staffId), tradingName: null, staffRemovedAt: staff.staffRemovedAt ?? new Date() },
  });
  await track("account_deleted", { type: "ENGINEER", id: staffId }, { role: "staff" });
  return { ok: true };
}

export async function deleteOwnerAccount(engineerId: string): Promise<DeleteResult> {
  // "Live plans need handling first: the owner is told to end or hand over
  // plans." Customers are paying them by Direct Debit — that can't vanish
  // with the account.
  // A plan already ended from the customer's page runs out its paid month
  // (Retention spec §2) with no more collections, so it doesn't block.
  const livePlans = await prisma.plan.count({
    where: { engineerId, status: { in: ["ACTIVE", "PAUSED"] }, cancelRequestedAt: null },
  });
  if (livePlans > 0) {
    return {
      ok: false,
      status: 409,
      livePlans,
      error: `You have ${livePlans} customer${livePlans === 1 ? "" : "s"} on a live plan. End their plans from each customer's page (or email info@tradesura.com to hand them to another engineer), then delete your account.`,
    };
  }

  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });

  // Unsent offers: stop the links and their nudges.
  const pending = await prisma.plan.findMany({ where: { engineerId, status: "PENDING" }, select: { id: true } });
  for (const p of pending) await cancelScheduledSms(`nudge:${p.id}`);
  await prisma.plan.updateMany({
    where: { engineerId, status: "PENDING" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });

  // Retention spec §9 — customers still running out a paid month are
  // offered a nearby engineer before their details are scrubbed below.
  await offerNearbyEngineers(engineerId).catch((err) =>
    console.error("[delete-account] nearby-engineer offer failed:", err),
  );

  // Customers: addresses deleted; names and numbers scrubbed. Plan and
  // payment records stay, attached to an anonymous customer.
  const customers = await prisma.customer.findMany({ where: { engineerId }, select: { id: true } });
  const customerIds = customers.map((c) => c.id);
  if (customerIds.length) {
    await prisma.appliance.deleteMany({ where: { property: { customerId: { in: customerIds } } } });
    await prisma.property.deleteMany({ where: { customerId: { in: customerIds } } });
    for (const id of customerIds) {
      await prisma.customer.update({
        where: { id },
        data: { firstName: "Deleted", lastName: "customer", phone: `deleted-${id}`, email: null },
      });
    }
  }

  // Staff lose access with the business.
  const staff = await prisma.engineer.findMany({ where: { ownerId: engineerId, deletedAt: null } });
  for (const s of staff) await deleteStaffAccount(s.id);

  await prisma.planTier.updateMany({ where: { engineerId, status: { not: "STOPPED" } }, data: { status: "STOPPED" } });
  await removeBlob(engineer.gasSafeCardUrl);
  await removeBlob(engineer.logoUrl);
  await prisma.engineer.update({
    where: { id: engineerId },
    data: { ...scrubbedEngineer(engineerId), tradingName: "Deleted account" },
  });
  // The Stripe connected account is left for TradeSura to close once any
  // balance has paid out — it can't be deleted while money is moving.
  await track("account_deleted", { type: "ENGINEER", id: engineerId }, {
    role: "owner",
    stripeAccountId: engineer.stripeAccountId,
  });
  return { ok: true };
}

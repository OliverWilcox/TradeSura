import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { displayName } from "@/lib/engineer";
import { deleteOwnerAccount, deleteStaffAccount } from "@/lib/delete-account";
import { adminEvent } from "@/lib/admin-api/audit";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { engineerSearch, engineerStatus, STATUS_WHERE, type EngineerStatus } from "@/lib/admin/engineers";
import { customerSearch } from "@/lib/admin/customers";
import { personName, verificationStatus } from "@/lib/admin/verifications";
import { maskEmail, maskPhone } from "@/lib/admin/mask";

// Every engineer and customer account, to find and delete: for a tester who
// wants to sign up again, or anyone who asks to be removed. An engineer is
// deleted exactly as the app's own "Delete my account" does it
// (lib/delete-account.ts): the row is anonymised, not removed, so plans,
// payments and fees stay for the accounts, and the email, mobile, Gas Safe
// number and Apple ID are free for a new sign-up. Like the app, it's refused
// while customers are on a live plan. A customer is removed the way an
// owner's deletion removes their customers: homes gone, name and contact
// details scrubbed, plan records kept.

/**
 * Open plans: live ones block deleting (customers are paying by Direct Debit);
 * ending ones run out their paid month; pending ones are offers not yet taken
 * up, withdrawn on delete.
 */
type PlanCounts = { live: number; ending: number; pending: number };

const noPlans = (): PlanCounts => ({ live: 0, ending: 0, pending: 0 });

/** A plan customers are paying for that hasn't been cancelled: it stops an owner being deleted. */
const LIVE_PLAN = { status: { in: ["ACTIVE", "PAUSED"] }, cancelRequestedAt: null } satisfies Prisma.PlanWhereInput;
/** Any plan that hasn't ended: it stops a customer being deleted. */
const OPEN_PLAN = { status: { in: ["ACTIVE", "PAUSED"] } } satisfies Prisma.PlanWhereInput;

async function openPlans(where: Prisma.PlanWhereInput, keyOf: (p: { engineerId: string; customerId: string }) => string) {
  const plans = await prisma.plan.findMany({
    where: { ...where, status: { in: ["PENDING", "ACTIVE", "PAUSED"] } },
    select: { engineerId: true, customerId: true, status: true, cancelRequestedAt: true },
  });
  const counts = new Map<string, PlanCounts>();
  for (const p of plans) {
    const c = counts.get(keyOf(p)) ?? noPlans();
    if (p.status === "PENDING") c.pending++;
    else if (p.cancelRequestedAt) c.ending++;
    else c.live++;
    counts.set(keyOf(p), c);
  }
  return counts;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function engineerBlocker(plans: PlanCounts) {
  if (!plans.live) return null;
  return plans.live === 1
    ? "Has a live customer plan. It has to end first: the engineer can end it from the customer's page in the app."
    : `Has ${plans.live} live customer plans. They have to end first: the engineer can end them from each customer's page in the app.`;
}

// A customer on their own has no engineer leaving to explain an ending plan
// to them, and the plan's last messages would go to a scrubbed number, so a
// customer waits until every plan has ended.
function customerBlocker(plans: PlanCounts) {
  const open = plans.live + plans.ending;
  if (!open) return null;
  return open === 1 ? "On a plan that hasn't ended yet. They can be deleted once it has." : `On ${open} plans that haven't ended yet. They can be deleted once those have.`;
}

/**
 * Several searches at once, separated by commas or semicolons, so a person's
 * emails and mobile can be found together. Each is matched as the engineer
 * and customer lists match a search (contact details only whole).
 */
function searchTerms(q: string | undefined) {
  return (q ?? "").split(/[,;]/).map((t) => t.trim()).filter(Boolean).slice(0, 20);
}

const ENGINEER_SELECT = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  tradingName: true,
  legalName: true,
  slug: true,
  ownerId: true,
  owner: { select: { tradingName: true, legalName: true, slug: true } },
  bannedAt: true,
  pausedAt: true,
  leftAt: true,
  gasSafeNo: true,
  gasSafeVerifiedAt: true,
  gasSafeRejectedAt: true,
  stripeAccountId: true,
  createdAt: true,
  _count: { select: { staff: { where: { deletedAt: null } }, customers: true } },
} satisfies Prisma.EngineerSelect;

const CUSTOMER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  createdAt: true,
  engineer: { select: { id: true, tradingName: true, legalName: true, slug: true } },
} satisfies Prisma.CustomerSelect;

export type EngineerAccountQuery = {
  q?: string;
  role?: "owner" | "staff";
  status?: EngineerStatus;
  /** yes: can be deleted now; no: an owner with a live customer plan. */
  deletable?: "yes" | "no";
  joinedFrom?: Date;
  joinedTo?: Date;
  dir?: "asc" | "desc";
  page: number;
  size: number;
};

/** Engineer accounts (owners and staff), newest first, with what deleting each would do. Contact details masked. */
export async function listEngineerAccounts(q: EngineerAccountQuery) {
  const and: Prisma.EngineerWhereInput[] = [{ deletedAt: null }];
  const terms = searchTerms(q.q);
  if (terms.length) and.push({ OR: terms.map(engineerSearch) });
  if (q.role) and.push(q.role === "staff" ? { ownerId: { not: null } } : { ownerId: null });
  if (q.status) and.push(STATUS_WHERE[q.status]);
  // Staff never have plans of their own, so they can always go.
  if (q.deletable === "yes") and.push({ OR: [{ ownerId: { not: null } }, { plans: { none: LIVE_PLAN } }] });
  if (q.deletable === "no") and.push({ ownerId: null, plans: { some: LIVE_PLAN } });
  if (q.joinedFrom || q.joinedTo) and.push({ createdAt: { ...(q.joinedFrom ? { gte: q.joinedFrom } : {}), ...(q.joinedTo ? { lt: q.joinedTo } : {}) } });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.engineer.findMany({ where, orderBy: [{ createdAt: q.dir ?? "desc" }, { id: "asc" }], skip: (q.page - 1) * q.size, take: q.size, select: ENGINEER_SELECT }),
    prisma.engineer.count({ where }),
  ]);
  const owners = rows.filter((e) => !e.ownerId).map((e) => e.id);
  const byEngineer = owners.length ? await openPlans({ engineerId: { in: owners } }, (p) => p.engineerId) : new Map<string, PlanCounts>();
  const items = rows.map((e) => {
    // Staff sell inside the owner's business: plans and customers are the owner's.
    const plans = byEngineer.get(e.id) ?? noPlans();
    return {
      id: e.id,
      role: e.ownerId ? ("staff" as const) : ("owner" as const),
      name: personName(e),
      business: displayName(e.owner ?? e),
      ownerId: e.ownerId,
      email: maskEmail(e.email),
      phone: e.phone ? maskPhone(e.phone) : null,
      status: engineerStatus(e),
      verification: verificationStatus(e),
      joinedAt: e.createdAt.toISOString(),
      staff: e.ownerId ? 0 : e._count.staff,
      customers: e.ownerId ? 0 : e._count.customers,
      plans,
      stripeAccount: !e.ownerId && !!e.stripeAccountId,
      blocked: e.ownerId ? null : engineerBlocker(plans),
    };
  });
  return { items, page: q.page, size: q.size, total };
}

export type CustomerAccountQuery = {
  q?: string;
  /** yes: can be deleted now; no: on a plan that hasn't ended. */
  deletable?: "yes" | "no";
  addedFrom?: Date;
  addedTo?: Date;
  dir?: "asc" | "desc";
  page: number;
  size: number;
};

/** Customers on every engineer's book, newest first, with what deleting each would do. Contact details masked. */
export async function listCustomerAccounts(q: CustomerAccountQuery) {
  const and: Prisma.CustomerWhereInput[] = [{ engineer: { deletedAt: null } }];
  const terms = searchTerms(q.q);
  if (terms.length) and.push({ OR: terms.map(customerSearch) });
  if (q.deletable === "yes") and.push({ plans: { none: OPEN_PLAN } });
  if (q.deletable === "no") and.push({ plans: { some: OPEN_PLAN } });
  if (q.addedFrom || q.addedTo) and.push({ createdAt: { ...(q.addedFrom ? { gte: q.addedFrom } : {}), ...(q.addedTo ? { lt: q.addedTo } : {}) } });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: [{ createdAt: q.dir ?? "desc" }, { id: "asc" }], skip: (q.page - 1) * q.size, take: q.size, select: CUSTOMER_SELECT }),
    prisma.customer.count({ where }),
  ]);
  const byCustomer = rows.length ? await openPlans({ customerId: { in: rows.map((c) => c.id) } }, (p) => p.customerId) : new Map<string, PlanCounts>();
  const items = rows.map((c) => {
    const plans = byCustomer.get(c.id) ?? noPlans();
    return {
      id: c.id,
      name: personName(c),
      engineer: { id: c.engineer.id, business: displayName(c.engineer) },
      email: c.email ? maskEmail(c.email) : null,
      phone: maskPhone(c.phone),
      addedAt: c.createdAt.toISOString(),
      plans,
      blocked: customerBlocker(plans),
    };
  });
  return { items, page: q.page, size: q.size, total };
}

export type DeleteOutcome = "deleted" | "gone" | "refused" | "failed";
export type DeleteResultItem = { type: "engineer" | "customer"; id: string; name: string; outcome: DeleteOutcome; message: string };

const item = (type: DeleteResultItem["type"], id: string, name: string, outcome: DeleteOutcome, message: string): DeleteResultItem => ({ type, id, name, outcome, message });

/** Notes and open claims about someone go with them. */
async function closeAdminRecords(subjectType: "engineer" | "customer", id: string, db: Prisma.TransactionClient = prisma) {
  await db.adminNote.updateMany({ where: { subjectType, subjectId: id, deletedAt: null }, data: { deletedAt: new Date() } });
  if (subjectType === "engineer") await db.verificationClaim.deleteMany({ where: { engineerId: id } });
}

/** One delete request: who asked and why (if they said), names as they were before anything was deleted, and owners deleted so far. */
type Run = { admin: AdminPrincipal; reason?: string; names: Map<string, string>; deletedOwners: Map<string, string> };

async function deleteEngineer(run: Run, id: string): Promise<DeleteResultItem> {
  const e = await prisma.engineer.findUnique({ where: { id }, select: { ...ENGINEER_SELECT, deletedAt: true } });
  if (!e) return item("engineer", id, "Unknown engineer", "gone", "There's no engineer with that ID.");
  const name = run.names.get(id) ?? "Engineer";
  const business = displayName(e.owner ?? e);
  if (e.ownerId && run.deletedOwners.has(e.ownerId)) return item("engineer", id, name, "deleted", `Deleted with ${run.deletedOwners.get(e.ownerId)}.`);
  if (e.deletedAt) return item("engineer", id, name, "gone", "This account was already deleted.");

  if (e.ownerId) {
    await deleteStaffAccount(id);
    await closeAdminRecords("engineer", id);
    await adminEvent(run.admin, "admin_account_deleted", { engineerId: id, ownerId: e.ownerId, role: "staff", reason: run.reason });
    return item("engineer", id, name, "deleted", `Deleted, and taken off the team at ${business}.`);
  }

  const staff = await prisma.engineer.findMany({ where: { ownerId: id, deletedAt: null }, select: { id: true } });
  const result = await deleteOwnerAccount(id);
  if (!result.ok) {
    const blocked = result.livePlans ? engineerBlocker({ live: result.livePlans, ending: 0, pending: 0 }) : null;
    return item("engineer", id, name, "refused", blocked ?? result.error);
  }
  run.deletedOwners.set(id, business);
  for (const s of staff) await closeAdminRecords("engineer", s.id);
  await closeAdminRecords("engineer", id);
  await adminEvent(run.admin, "admin_account_deleted", {
    engineerId: id,
    role: "owner",
    reason: run.reason,
    staffDeleted: staff.length,
    customersRemoved: e._count.customers,
    // Left for TradeSura to close in Stripe once any balance has paid out.
    stripeAccountId: e.stripeAccountId,
  });
  const also = [staff.length ? plural(staff.length, "staff account") : null, e._count.customers ? plural(e._count.customers, "customer") : null].filter(Boolean);
  return item("engineer", id, name, "deleted", also.length ? `Deleted, with ${also.join(" and ")}.` : "Deleted.");
}

async function deleteCustomer(run: Run, id: string): Promise<DeleteResultItem> {
  const c = await prisma.customer.findUnique({ where: { id }, select: { phone: true, engineerId: true, engineer: { select: { deletedAt: true } } } });
  if (!c) return item("customer", id, "Unknown customer", "gone", "There's no customer with that ID.");
  const name = run.names.get(id) ?? "Customer";
  if (run.deletedOwners.has(c.engineerId)) return item("customer", id, name, "deleted", `Deleted with ${run.deletedOwners.get(c.engineerId)}.`);
  if (c.engineer.deletedAt || c.phone === `deleted-${id}`) return item("customer", id, name, "gone", "This customer was already deleted.");

  return prisma.$transaction(async (tx) => {
    const plans = await tx.plan.findMany({ where: { customerId: id, status: { in: ["PENDING", "ACTIVE", "PAUSED"] } }, select: { id: true, status: true, cancelRequestedAt: true } });
    const counts = noPlans();
    for (const p of plans) counts[p.status === "PENDING" ? "pending" : p.cancelRequestedAt ? "ending" : "live"]++;
    const blocked = customerBlocker(counts);
    if (blocked) return item("customer", id, name, "refused", blocked);

    // Offers they hadn't taken up: withdrawn, with their reminder texts (as cancelScheduledSms does).
    const pending = plans.map((p) => p.id);
    if (pending.length) {
      await tx.outboundSms.updateMany({ where: { status: "QUEUED", OR: pending.map((p) => ({ cancelKey: { startsWith: `nudge:${p}` } })) }, data: { status: "CANCELLED" } });
      await tx.plan.updateMany({ where: { id: { in: pending } }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    }
    await tx.appliance.deleteMany({ where: { property: { customerId: id } } });
    await tx.property.deleteMany({ where: { customerId: id } });
    await tx.customer.update({ where: { id }, data: { firstName: "Deleted", lastName: "customer", phone: `deleted-${id}`, email: null } });
    await closeAdminRecords("customer", id, tx);
    await adminEvent(run.admin, "admin_customer_deleted", { customerId: id, engineerId: c.engineerId, reason: run.reason, offersWithdrawn: pending.length }, tx);
    return item("customer", id, name, "deleted", pending.length ? `Deleted, and ${plural(pending.length, "offer")} withdrawn.` : "Deleted.");
  });
}

/**
 * Deletes each engineer and customer, owners first so their staff and
 * customers are reported as deleted with them. Each stands alone: one that's
 * refused or fails doesn't stop the rest.
 */
export async function deleteAccounts(admin: AdminPrincipal, input: { engineerIds: string[]; customerIds: string[]; reason?: string }) {
  const engineerIds = [...new Set(input.engineerIds)];
  const customerIds = [...new Set(input.customerIds)];
  // Names first: deleting an owner scrubs their staff and customers.
  const [engineers, customers] = await Promise.all([
    prisma.engineer.findMany({ where: { id: { in: engineerIds } }, select: { id: true, ownerId: true, firstName: true, lastName: true, tradingName: true, legalName: true, slug: true } }),
    prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, firstName: true, lastName: true } }),
  ]);
  const run: Run = {
    admin,
    reason: input.reason,
    names: new Map([...engineers.map((e) => [e.id, e.ownerId ? personName(e) : displayName(e)] as const), ...customers.map((c) => [c.id, personName(c)] as const)]),
    deletedOwners: new Map(),
  };
  const staffIds = new Set(engineers.filter((e) => e.ownerId).map((e) => e.id));
  const items: DeleteResultItem[] = [];

  const attempt = async (type: DeleteResultItem["type"], id: string, work: () => Promise<DeleteResultItem>) => {
    try {
      items.push(await work());
    } catch (err) {
      console.error(`[admin-api] deleting ${type} ${id} failed (request ${admin.requestId}):`, err);
      items.push(item(type, id, run.names.get(id) ?? (type === "engineer" ? "Engineer" : "Customer"), "failed", "That didn't work. Try again."));
    }
  };
  for (const id of engineerIds.sort((a, b) => Number(staffIds.has(a)) - Number(staffIds.has(b)))) await attempt("engineer", id, () => deleteEngineer(run, id));
  for (const id of customerIds) await attempt("customer", id, () => deleteCustomer(run, id));
  return { items };
}

import { prisma } from "@/lib/db";
import { getActor, type Actor } from "@/lib/auth";
import { passportForCustomer, passportState, type PassportState } from "@/lib/passport";

export type PassportAccess =
  | { ok: true; actor: Actor; customerId: string; passportId: string | null; state: PassportState | null }
  | { ok: false; status: 401 | 404; error: string };

// The engineer's (or their staff's) view onto one customer's Home Passport.
// Staff act only on customers they added, same as every customer route.
export async function passportAccess(customerId: string): Promise<PassportAccess> {
  const actor = await getActor();
  if (!actor) return { ok: false, status: 401, error: "Not signed in." };
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      engineerId: actor.businessId,
      ...(actor.role === "staff" ? { addedById: actor.actorId } : {}),
    },
    select: { id: true, plans: { select: { id: true, status: true } } },
  });
  if (!customer) return { ok: false, status: 404, error: "Not found." };
  // A passport only exists once the customer has (or had) a plan with us.
  const everOnPlan = customer.plans.some((p) => p.status !== "PENDING");
  const passportId = everOnPlan ? await passportForCustomer(customer.id) : null;
  if (passportId) {
    // Plans activated before passports existed get linked on first look.
    await prisma.plan.updateMany({
      where: { customerId: customer.id, passportId: null, status: { not: "PENDING" } },
      data: { passportId },
    });
  }
  return {
    ok: true,
    actor,
    customerId: customer.id,
    passportId,
    state: passportId ? await passportState(passportId) : null,
  };
}

// This business's live plan for the customer — what a logged service is "on".
export async function livePlanId(businessId: string, customerId: string): Promise<string | null> {
  const plan = await prisma.plan.findFirst({
    where: { engineerId: businessId, customerId, status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return plan?.id ?? null;
}

// Only photos we stored ourselves (Vercel Blob) go onto a passport.
export function isOwnPhotoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { track } from "@/lib/track";
import { commissionFor, commissionRuleOf, londonMonth } from "@/lib/grow";

// Matt, 6 Nov — staff commission. The owner sets a reward per plan their
// staff sell, per sign-up or a month while it's live, and sees who sold
// what. TradeSura only works it out; the owner pays it. Staff never see
// money or settings (Build Review 2), so all of this is owner-only.
const Body = z.object({
  type: z.enum(["signup", "monthly"]),
  pence: z.number().int().min(1).max(100_000),
});

async function ownerOnly(): Promise<{ error: NextResponse } | { ownerId: string }> {
  const actor = await getActor();
  if (!actor) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if (actor.role === "staff") return { error: NextResponse.json({ error: "Only the owner can see commission." }, { status: 403 }) };
  return { ownerId: actor.businessId };
}

export async function GET() {
  const auth = await ownerOnly();
  if ("error" in auth) return auth.error;
  const now = new Date();
  const month = londonMonth(now);
  const [owner, staff] = await Promise.all([
    prisma.engineer.findUniqueOrThrow({ where: { id: auth.ownerId }, select: { staffCommissionType: true, staffCommissionPence: true } }),
    prisma.engineer.findMany({
      where: { ownerId: auth.ownerId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, staffRemovedAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const rule = commissionRuleOf(owner);
  const plans = await prisma.plan.findMany({
    where: { engineerId: auth.ownerId, soldById: { in: staff.map((s) => s.id) } },
    select: { soldById: true, status: true, activatedAt: true, cancelledAt: true },
  });
  return NextResponse.json({
    rule,
    staff: staff.map((s) => {
      const sold = plans.filter((p) => p.soldById === s.id);
      const earned = commissionFor(rule, sold, month.start, now);
      return {
        id: s.id,
        name: [s.firstName, s.lastName].filter(Boolean).join(" ") || "Team member",
        removed: Boolean(s.staffRemovedAt),
        offers: sold.length,
        signedUp: sold.filter((p) => p.activatedAt).length,
        live: sold.filter((p) => p.status === "ACTIVE").length,
        ...earned,
      };
    }),
  });
}

export async function PUT(req: Request) {
  const auth = await ownerOnly();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick how it's paid and enter an amount." }, { status: 400 });
  await prisma.engineer.update({
    where: { id: auth.ownerId },
    data: { staffCommissionType: parsed.data.type, staffCommissionPence: parsed.data.pence },
  });
  await track("grow_commission_set", { type: "ENGINEER", id: auth.ownerId }, parsed.data);
  return NextResponse.json({ ok: true });
}

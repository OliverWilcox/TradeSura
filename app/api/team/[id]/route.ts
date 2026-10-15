import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";

// Section 8 — "the owner can remove an engineer at any time. Access stops
// straight away, and their customers stay with the business." Customers and
// plans already live on the owner's row; getActor() refuses the staff token
// from the next request.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ownerId = await getEngineerId();
  if (!ownerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  const staff = await prisma.engineer.findFirst({ where: { id, ownerId, staffRemovedAt: null } });
  if (!staff) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await prisma.engineer.update({
    where: { id },
    data: { staffRemovedAt: new Date(), expoPushToken: null },
  });
  await track("staff_removed", { type: "ENGINEER", id: ownerId }, { staffId: id });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";

// Ticks off the getting-started hub's "Invite engineers you know" step the
// first time the engineer shares their invite.
export async function POST() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { count } = await prisma.engineer.updateMany({
    where: { id: engineerId, inviteSharedAt: null },
    data: { inviteSharedAt: new Date() },
  });
  await track("invite_shared", { type: "ENGINEER", id: engineerId }, { first: count > 0 });
  return NextResponse.json({ ok: true });
}

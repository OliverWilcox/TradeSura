import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { offerGate, startOfferSession } from "@/lib/offer-session";

// 30 Oct update §6 — "Show them now": the customer joins on the installer's
// phone. Starts the offer with its visit reason and returns the plan page
// address, tagged so the page is tailored to the reason and the plan they
// start comes back to this offer (and the review after it).
const Body = z.object({ reason: z.string().min(1).max(40) });

export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const blocked = await offerGate(actor);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick why you were there." }, { status: 400 });

  const staffId = actor.role === "staff" ? actor.actorId : null;
  const { token } = await startOfferSession({
    engineerId: actor.businessId,
    soldById: staffId,
    reason: parsed.data.reason,
    channel: "show",
  });
  const { slug } = await prisma.engineer.findUniqueOrThrow({ where: { id: actor.businessId }, select: { slug: true } });
  const q = new URLSearchParams({ demo: "1", o: token, ...(staffId ? { by: staffId } : {}) });
  return NextResponse.json({ token, path: `/${slug}?${q}` });
}

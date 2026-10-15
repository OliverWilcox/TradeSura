import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { isExpoPushToken } from "@/lib/push";

const Body = z.object({ token: z.string().min(1).max(200) });

// Build Guide v2 Part 11 — the app registers a device's Expo push token
// here once permission is granted (asked "after the first plan goes live,"
// per spec — see mobile's onboarding/dashboard for where that ask fires).
// One token per engineer: a second device registering replaces the first
// rather than fanning a send out to both, which matches how every other
// per-engineer setting here works (one trading name, one logo, ...) and
// keeps this a single nullable column rather than a table.
export async function POST(req: Request) {
  // The token belongs to the person on this device — owner or staff.
  const engineerId = (await getActor())?.actorId ?? null;
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A push token is required." }, { status: 400 });
  }
  if (!isExpoPushToken(parsed.data.token)) {
    return NextResponse.json({ error: "That doesn't look like an Expo push token." }, { status: 400 });
  }

  await prisma.engineer.update({
    where: { id: engineerId },
    data: { expoPushToken: parsed.data.token },
  });
  return NextResponse.json({ ok: true });
}

// Sign-out (or a denied/revoked permission) clears the token so a stale
// device doesn't keep receiving another engineer's notifications after
// this one signs out of it — mirrors clearStripeSkipped's sign-out cleanup
// in mobile/lib/auth-context.tsx.
export async function DELETE() {
  // The token belongs to the person on this device — owner or staff.
  const engineerId = (await getActor())?.actorId ?? null;
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  await prisma.engineer.update({
    where: { id: engineerId },
    data: { expoPushToken: null },
  });
  return NextResponse.json({ ok: true });
}

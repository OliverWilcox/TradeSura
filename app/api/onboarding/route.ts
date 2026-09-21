import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { verifyGasSafe } from "@/lib/gas-safe";
import { uniqueSlug } from "@/lib/slug";
import { sendPushNotification } from "@/lib/push";

const Body = z.object({
  regNo: z.string().min(1).max(20),
  tradingName: z.string().min(2).max(80),
  logoUrl: z.string().url().max(400).optional().or(z.literal("")),
});

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the form and try again." }, { status: 400 });
  }

  // Re-verify server-side — the badge is earned, not claimed.
  const record = await verifyGasSafe(parsed.data.regNo);
  if (!record) {
    return NextResponse.json(
      { error: "No match on the Gas Safe register. Check the number and try again." },
      { status: 404 },
    );
  }

  const slug = await uniqueSlug(parsed.data.tradingName, engineerId);
  await prisma.engineer.update({
    where: { id: engineerId },
    data: {
      gasSafeNo: record.regNo,
      gasSafeName: record.name,
      gasSafeCompany: record.company,
      gasSafeCategories: record.categories,
      gasSafeVerifiedAt: new Date(),
      tradingName: parsed.data.tradingName,
      logoUrl: parsed.data.logoUrl || null,
      slug,
    },
  });
  // Build Guide v2 Part 6.4 — badge-granted's push effect (see
  // app/api/auth/request/route.ts for the fuller note). This route isn't
  // currently called by the mobile app (no /api/onboarding caller found),
  // but it's real, reachable code that grants the badge, so it fires the
  // same event as the signup path for whenever something does call it.
  await sendPushNotification(
    engineerId,
    "You're verified",
    "You're Gas Safe verified — your member pack is on its way",
  );
  return NextResponse.json({ ok: true, slug });
}

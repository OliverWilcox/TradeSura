import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { WINBACK_OFFERS, parseWinbackOffer, winbackSettingKey } from "@/lib/retention";

// Retention spec, section 9 — the engineer's choice of win-back offer, sent
// 30 days after a plan ends and again before winter. "none" is a plain
// one-tap rejoin; the offer applies to texts queued after it's changed.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const row = await prisma.appSetting.findUnique({ where: { key: winbackSettingKey(engineerId) } });
  const offer = parseWinbackOffer(row?.value);
  return NextResponse.json({
    offer,
    options: Object.entries(WINBACK_OFFERS).map(([value, label]) => ({
      value,
      label: label || "Rejoin in one tap (no offer)",
    })),
  });
}

const Body = z.object({ offer: z.enum(Object.keys(WINBACK_OFFERS) as [string, ...string[]]) });

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick an offer." }, { status: 400 });
  const key = winbackSettingKey(engineerId);
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: parsed.data.offer },
    update: { value: parsed.data.offer },
  });
  return NextResponse.json({ ok: true, offer: parsed.data.offer });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { TRADE_PACKS } from "@/lib/trades";

// Mobile counterpart to the query in app/trades/page.tsx (restored — see
// CLAUDE.md's 2026-08-03 scope note).
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const registered = await prisma.event.findMany({
    where: { name: "trade_interest_registered", actorId: engineerId },
    select: { meta: true },
  });
  const already = new Set(
    registered.map((e) => (e.meta as { trade?: string } | null)?.trade).filter(Boolean) as string[],
  );

  return NextResponse.json(
    TRADE_PACKS.map((t) => ({
      code: t.code,
      name: t.name,
      anchor: t.anchor,
      live: t.live,
      registered: already.has(t.code),
    })),
  );
}

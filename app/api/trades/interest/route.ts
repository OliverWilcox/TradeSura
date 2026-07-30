import { NextResponse } from "next/server";
import { z } from "zod";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { TRADE_PACKS } from "@/lib/trades";

const Body = z.object({ code: z.string().min(1).max(40) });

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  const pack = parsed.success && TRADE_PACKS.find((t) => t.code === parsed.data.code);
  if (!pack) return NextResponse.json({ error: "Unknown trade." }, { status: 400 });

  await track("trade_interest_registered", { type: "ENGINEER", id: engineerId }, {
    trade: pack.code,
    name: pack.name,
  });
  return NextResponse.json({ ok: true });
}

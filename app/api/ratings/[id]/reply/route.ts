import { NextResponse } from "next/server";
import { z } from "zod";
import { getEngineerId } from "@/lib/auth";
import { REPLY_MAX, replyToRating } from "@/lib/ratings";

const Body = z.object({ reply: z.string().max(REPLY_MAX + 50) });

// Section 5 — one public reply per rating, from the installer.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: `Keep your reply under ${REPLY_MAX} characters.` }, { status: 400 });
  const result = await replyToRating(engineerId, id, parsed.data.reply);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

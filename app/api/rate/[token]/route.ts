import { NextResponse } from "next/server";
import { z } from "zod";
import { submitRating } from "@/lib/ratings";

const Body = z.object({
  stars: z.number(),
  comment: z.string().max(2000).optional(),
  acknowledged: z.boolean().default(false),
});

// Section 5 — the customer's one-tap rating. The comment runs the
// gas-emergency interlock server-side (409 + emergency until acknowledged),
// same contract as the portal's report form.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Tap 1 to 5 stars." }, { status: 400 });
  const result = await submitRating(token, parsed.data);
  if (!result.ok) {
    if (result.emergency) return NextResponse.json({ emergency: true }, { status: 409 });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}

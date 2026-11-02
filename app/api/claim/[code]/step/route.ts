import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { CLAIM_STEPS, claimForPage } from "@/lib/claim";

// 30 Oct update §1.9 — "Log every step per code": the steps only the
// browser sees (ticks seen, code copied, store opened). Each step is logged
// once per code, so a reload or a double tap doesn't inflate the funnel.
const Body = z.object({ step: z.enum(CLAIM_STEPS) });

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown step." }, { status: 400 });
  const row = await claimForPage((await params).code);
  if (!row) return NextResponse.json({ ok: true });
  const { step } = parsed.data;
  const seen = await prisma.event.findFirst({
    where: { name: "claim_step", AND: [{ meta: { path: ["code"], equals: row.code } }, { meta: { path: ["step"], equals: step } }] },
    select: { id: true },
  });
  if (!seen) await track("claim_step", { type: "SYSTEM" }, { code: row.code, step, variantCell: row.variantCell });
  return NextResponse.json({ ok: true });
}

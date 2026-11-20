import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { checkEmergency } from "@/lib/compliance/interlock";
import { raiseSafetyComplaint, SAFETY_COMPLAINT_LIMITS } from "@/lib/safety-complaints";

const Body = z.object({
  message: z.string().trim().min(SAFETY_COMPLAINT_LIMITS.min).max(SAFETY_COMPLAINT_LIMITS.max),
  acknowledged: z.boolean().default(false),
});

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const plan = await prisma.plan.findUnique({ where: { portalToken: token }, select: { id: true, engineerId: true, customerId: true } });
  if (!plan) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Tell us a little more about what happened." }, { status: 400 });
  }

  const check = checkEmergency(parsed.data.message);
  if (check.emergency && !parsed.data.acknowledged) {
    await track("emergency_interlock_triggered", { type: "CUSTOMER", id: plan.customerId }, { planId: plan.id, matched: check.matched, surface: "portal_safety" });
    return NextResponse.json({ emergency: true }, { status: 409 });
  }

  await raiseSafetyComplaint({ engineerId: plan.engineerId, customerId: plan.customerId, planId: plan.id, message: parsed.data.message, from: "homeowner" });
  return NextResponse.json({ ok: true });
}

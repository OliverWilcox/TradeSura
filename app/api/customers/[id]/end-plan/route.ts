import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { requestCancel } from "@/lib/cancel-plan";
import { CANCEL_REASON_CODES, type CancelReason } from "@/lib/retention";

// Build Review 2, ruling 5 + Retention spec section 2 — the engineer ends a
// plan, or logs a cancellation the customer asked for by phone or email.
// Same flow as the customer's manage link (source "engineer_logged"): the
// plan ends at the end of the paid month, never straight away.
const Body = z.object({
  reason: z.string().trim().min(2).max(80),
  reasonCode: z.enum(CANCEL_REASON_CODES).optional(),
  detail: z.string().trim().max(300).optional(),
});

// The app's older reason chips, mapped onto the stored reason codes.
function codeFor(label: string): CancelReason {
  if (/moving/i.test(label)) return "moving";
  if (/expensive|cost|afford/i.test(label)) return "too_expensive";
  if (/not using/i.test(label)) return "not_using";
  if (/unhappy/i.test(label)) return "unhappy";
  return "other";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick a reason for ending the plan." }, { status: 400 });
  }

  const { id } = await ctx.params;
  const plan = await prisma.plan.findFirst({
    where: { customerId: id, engineerId, status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!plan) return NextResponse.json({ error: "This customer has no plan to end." }, { status: 404 });

  const reasonCode = parsed.data.reasonCode ?? codeFor(parsed.data.reason);
  const result = await requestCancel(plan.id, {
    source: "engineer_logged",
    reason: reasonCode,
    detail: parsed.data.detail ?? (reasonCode === "other" ? parsed.data.reason : null),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, effectiveAt: result.effectiveAt.toISOString() });
}

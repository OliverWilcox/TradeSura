import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { completePaymentRescue } from "@/lib/plan-billing";

const Body = z.object({ setupIntentId: z.string().startsWith("seti_") });

// Called by /u/{code} straight after the customer confirms the new mandate,
// so the retry doesn't wait on the webhook (setup_intent.succeeded does the
// same thing, idempotently).
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const plan = await prisma.plan.findUnique({ where: { rescueCode: code.toUpperCase() } });
  if (!plan) return NextResponse.json({ error: "This link has expired." }, { status: 404 });

  const si = await getStripe().setupIntents.retrieve(parsed.data.setupIntentId);
  // Only a SetupIntent we made for this plan's rescue.
  if (si.metadata?.planId !== plan.id || si.metadata?.purpose !== "rescue") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (si.status !== "succeeded") return NextResponse.json({ ok: true, pending: true });
  const paymentMethodId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  if (!paymentMethodId) return NextResponse.json({ ok: true, pending: true });
  try {
    await completePaymentRescue(plan.id, {
      paymentMethodId,
      mandateId: typeof si.mandate === "string" ? si.mandate : si.mandate?.id,
    });
  } catch (err) {
    // The mandate is in place; the webhook retries the rest.
    console.error("[rescue] complete failed:", err);
  }
  return NextResponse.json({ ok: true });
}

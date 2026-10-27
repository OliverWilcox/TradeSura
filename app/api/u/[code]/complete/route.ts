import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStripe, rescueCheckoutResult } from "@/lib/stripe";
import { completePaymentRescue } from "@/lib/plan-billing";

const Body = z.object({ sessionId: z.string().startsWith("cs_") });

// Called by /u/{code} straight after the customer finishes the rescue
// Checkout, so the retry doesn't wait on the webhook
// (checkout.session.completed does the same thing, idempotently).
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const plan = await prisma.plan.findUnique({ where: { rescueCode: code.toUpperCase() } });
  if (!plan) return NextResponse.json({ error: "This link has expired." }, { status: 404 });

  const session = await getStripe().checkout.sessions.retrieve(parsed.data.sessionId);
  // Only a Checkout we opened for this plan's rescue.
  if (session.metadata?.planId !== plan.id || session.metadata?.purpose !== "rescue") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (session.status !== "complete") return NextResponse.json({ ok: true, pending: true });
  const done = await rescueCheckoutResult(session);
  if (!done) return NextResponse.json({ ok: true, pending: true });
  try {
    await completePaymentRescue(plan.id, { paymentMethodId: done.paymentMethodId, mandateId: done.mandateId ?? undefined });
  } catch (err) {
    // The mandate is in place; the webhook retries the rest.
    console.error("[rescue] complete failed:", err);
  }
  return NextResponse.json({ ok: true });
}

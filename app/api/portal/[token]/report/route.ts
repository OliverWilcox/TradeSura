import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { checkEmergency } from "@/lib/compliance/interlock";
import { sendEmail } from "@/lib/email";

const Body = z.object({
  message: z.string().min(5).max(2000),
  acknowledged: z.boolean().default(false),
});

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const plan = await prisma.plan.findUnique({
    where: { portalToken: token },
    include: { engineer: true, customer: true },
  });
  if (!plan) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Tell us a little more about the problem." }, { status: 400 });
  }

  // Gas-emergency interlock: server-side, cannot be bypassed by disabling JS.
  // Every trigger is logged; the form only proceeds after acknowledgement.
  const check = checkEmergency(parsed.data.message);
  if (check.emergency && !parsed.data.acknowledged) {
    await track("emergency_interlock_triggered", { type: "CUSTOMER", id: plan.customerId }, {
      planId: plan.id,
      matched: check.matched,
      surface: "portal_report",
    });
    return NextResponse.json({ emergency: true }, { status: 409 });
  }

  await track("problem_reported", { type: "CUSTOMER", id: plan.customerId }, {
    planId: plan.id,
    message: parsed.data.message,
    emergencyAcknowledged: check.emergency ? parsed.data.acknowledged : undefined,
  });

  await sendEmail({
    to: plan.engineer.email,
    subject: `Problem report — ${plan.customer.firstName} ${plan.customer.lastName} (${plan.ref})`,
    html: `<p><b>${plan.customer.firstName} ${plan.customer.lastName}</b> (${plan.customer.phone}) reports:</p>
<blockquote>${parsed.data.message.replace(/</g, "&lt;")}</blockquote>
${check.emergency ? `<p><b>⚠ Emergency wording detected (${check.matched}) — the customer was shown the 0800 111 999 script and acknowledged it.</b></p>` : ""}`,
  });

  return NextResponse.json({ ok: true });
}

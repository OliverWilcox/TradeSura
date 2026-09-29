import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { sendSms } from "@/lib/sms";
import { appUrl } from "@/lib/app-url";

const Body = z.object({ customerId: z.string().min(1) });

// E9 — the non-member "pitch moment". One engineer-tapped message that books
// the service AND offers the plan. Never auto-sent (his voice, his consent
// basis) — that's why it's an explicit action, not a queued reminder.
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const customer = await prisma.customer.findFirst({
    where: { id: parsed.data.customerId, engineerId },
  });
  if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const brand = brandName(engineer);
  const link = `${appUrl()}/p/${engineer.slug}?src=reminder`;

  const res = await sendSms({
    engineerId,
    to: customer.phone,
    body: `Hi ${customer.firstName} — ${brand} here. Your boiler's annual service is due. I can book you in — or my care plan includes the service every year: ${link}`,
    messageClass: "MARKETING",
    consentBasis: "engineer-initiated",
  });
  if (res.sent === false && res.reason === "opted-out") {
    return NextResponse.json({ error: "This customer has opted out of texts." }, { status: 409 });
  }

  await track("reminder_sent", { type: "ENGINEER", id: engineerId }, {
    customerId: customer.id,
    kind: "non_member_offer",
  });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normaliseUkPhone } from "@/lib/phone";
import { clientIp, ipHash, recentAttempts } from "@/lib/enquiries";
import { isSuppressed } from "@/lib/suppression";
import { requestDetails } from "@/lib/details-request";
import { offerBlockedReason } from "@/lib/verification-state";

// 30 Oct update §7.7 — "Send me the details" on the plan page. Consent is
// required (the texts are marketing-class); a number that has opted out of
// texts is told so rather than silently ignored.
const Body = z.object({
  name: z.string().trim().min(2).max(60),
  phone: z.string().min(6).max(20),
  consent: z.literal(true),
  tierId: z.string().max(40).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Add your name and mobile, and tick to say we can text you." }, { status: 400 });
  }
  const phone = normaliseUkPhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "Enter a UK mobile number, like 07700 900123." }, { status: 400 });

  const engineer = await prisma.engineer.findUnique({ where: { slug } });
  if (!engineer || engineer.leftAt || engineer.deletedAt) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // Same gate as Join: nothing is sent for an engineer who can't take sign-ups yet.
  if (offerBlockedReason({ ...engineer, stripeChargesEnabled: engineer.stripeChargesEnabled })) {
    return NextResponse.json({ error: "This engineer isn't taking sign-ups online just yet." }, { status: 409 });
  }
  const ip = ipHash(clientIp(req));
  if ((await recentAttempts("details_requested", ip, 60, engineer.id)) >= 3) {
    return NextResponse.json({ error: "We've already sent the details. Check your texts." }, { status: 429 });
  }
  if (await isSuppressed("sms", phone)) {
    return NextResponse.json({ error: "That number has opted out of texts. Text START to resubscribe, or join now." }, { status: 409 });
  }
  await requestDetails({ engineerId: engineer.id, name: parsed.data.name, phone, tierId: parsed.data.tierId, ip });
  return NextResponse.json({ ok: true });
}

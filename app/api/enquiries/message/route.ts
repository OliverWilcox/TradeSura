import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { checkEmergency } from "@/lib/compliance/interlock";
import { normaliseUkPhone } from "@/lib/phone";
import {
  ENQUIRY_SOURCES,
  alertEngineerOfMessage,
  clientIp,
  enquiryFieldsError,
  enquirySpamVerdict,
  ipHash,
  recentAttempts,
} from "@/lib/enquiries";

const Body = z.object({
  slug: z.string().min(1).max(60),
  source: z.enum(ENQUIRY_SOURCES).default("profile"),
  name: z.string().max(80).default(""),
  phone: z.string().max(30).default(""),
  email: z.string().max(200).default(""),
  message: z.string().max(2000).default(""),
  // Spam guard: a field people never see, and when the form was opened.
  website: z.string().max(200).optional(),
  startedAt: z.number().optional(),
  acknowledged: z.boolean().default(false),
});

// Public: the profile's Message form. Goes to the engineer's app (Enquiries)
// plus a push and a text/email alert.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check your details and try again." }, { status: 400 });
  const b = parsed.data;

  const engineer = await prisma.engineer.findUnique({
    where: { slug: b.slug },
    select: { id: true, showMessageButton: true, leftAt: true, deletedAt: true, bannedAt: true },
  });
  if (!engineer || !engineer.showMessageButton || engineer.leftAt || engineer.deletedAt || engineer.bannedAt) {
    return NextResponse.json({ error: "This engineer isn't taking messages here." }, { status: 404 });
  }

  const ip = ipHash(clientIp(req));
  const verdict = enquirySpamVerdict({
    honeypot: b.website,
    startedAt: b.startedAt,
    now: Date.now(),
    recentFromIp: await recentAttempts("enquiry_message_attempt", ip, 60),
  });
  await track("enquiry_message_attempt", { type: "SYSTEM" }, { ip, engineerId: engineer.id, ok: verdict.ok });
  if (!verdict.ok) {
    if (verdict.silent) return NextResponse.json({ ok: true });
    return NextResponse.json(
      { error: "You've sent a few messages already — please try again in an hour, or call instead." },
      { status: 429 },
    );
  }

  const fieldError = enquiryFieldsError(b);
  if (fieldError) return NextResponse.json({ error: fieldError }, { status: 400 });

  // CLAUDE.md §Compliance 4 — customer free text runs the gas-emergency
  // interlock; the message only goes once they've acknowledged the script.
  const check = checkEmergency(b.message);
  if (check.emergency && !b.acknowledged) {
    await track("emergency_interlock_triggered", { type: "CUSTOMER" }, {
      engineerId: engineer.id,
      matched: check.matched,
      surface: "profile_message",
    });
    return NextResponse.json({ emergency: true }, { status: 409 });
  }

  const enquiry = await prisma.enquiry.create({
    data: {
      engineerId: engineer.id,
      kind: "message",
      source: b.source,
      name: b.name.trim(),
      phone: b.phone.trim() ? (normaliseUkPhone(b.phone) ?? b.phone.trim()) : null,
      email: b.email.trim().toLowerCase() || null,
      message: b.message.trim(),
    },
  });
  await track("enquiry_message", { type: "CUSTOMER" }, {
    enquiryId: enquiry.id,
    engineerId: engineer.id,
    source: b.source,
    emergency: check.emergency ? check.matched : undefined,
  });
  await alertEngineerOfMessage(enquiry.id, check.emergency ? check.matched : null).catch((err) =>
    console.error("[enquiry] alert failed:", err),
  );
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { CALL_DEDUPE_MINUTES, ENQUIRY_SOURCES, clientIp, ipHash, recentAttempts } from "@/lib/enquiries";

const Body = z.object({
  slug: z.string().min(1).max(60),
  source: z.enum(ENQUIRY_SOURCES).default("profile"),
});

// Public: the profile's "Call {name}" button logs a tap here (sendBeacon)
// just before the phone dials. Repeat taps from one visitor count once.
export async function POST(req: Request) {
  const raw = await req.text().catch(() => "");
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const engineer = await prisma.engineer.findUnique({
    where: { slug: parsed.data.slug },
    select: { id: true, showCallButton: true, leftAt: true, deletedAt: true },
  });
  if (!engineer || !engineer.showCallButton || engineer.leftAt || engineer.deletedAt) {
    return NextResponse.json({ ok: true });
  }
  const ip = ipHash(clientIp(req));
  if ((await recentAttempts("enquiry_call_tap", ip, CALL_DEDUPE_MINUTES, engineer.id)) > 0) {
    return NextResponse.json({ ok: true });
  }
  await track("enquiry_call_tap", { type: "SYSTEM" }, { ip, engineerId: engineer.id });
  await prisma.enquiry.create({
    data: { engineerId: engineer.id, kind: "call", source: parsed.data.source },
  });
  return NextResponse.json({ ok: true });
}

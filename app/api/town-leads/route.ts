import { NextResponse } from "next/server";
import { z } from "zod";
import { track } from "@/lib/track";
import { checkEmergency } from "@/lib/compliance/interlock";
import { normaliseUkPhone } from "@/lib/phone";
import { postcodeDistrict } from "@/lib/retention";
import { loadTown } from "@/lib/town";
import { clientIp, enquiryFieldsError, enquirySpamVerdict, ipHash, recentAttempts } from "@/lib/enquiries";
import { createTownLead } from "@/lib/town-leads";

const Body = z.object({
  town: z.string().min(1).max(80),
  name: z.string().max(80).default(""),
  phone: z.string().max(30).default(""),
  email: z.string().max(200).default(""),
  postcode: z.string().max(10).default(""),
  message: z.string().max(2000).default(""),
  consent: z.boolean().default(false),
  // Spam guard: a field people never see, and when the form was opened.
  website: z.string().max(200).optional(),
  startedAt: z.number().optional(),
  acknowledged: z.boolean().default(false),
});

// Public: "Find a gas engineer near you" on a town page (30 Oct update §10).
// Not addressed to anyone — Founding Members in the town get first pick.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check your details and try again." }, { status: 400 });
  const b = parsed.data;

  const { page, engineers, isPublic } = await loadTown(b.town);
  if (!isPublic) return NextResponse.json({ error: "This town page isn't taking requests." }, { status: 404 });

  const ip = ipHash(clientIp(req));
  const verdict = enquirySpamVerdict({
    honeypot: b.website,
    startedAt: b.startedAt,
    now: Date.now(),
    recentFromIp: await recentAttempts("town_lead_attempt", ip, 60),
  });
  await track("town_lead_attempt", { type: "SYSTEM" }, { ip, townSlug: b.town, ok: verdict.ok });
  if (!verdict.ok) {
    if (verdict.silent) return NextResponse.json({ ok: true });
    return NextResponse.json({ error: "You've sent a few requests already — please try again in an hour." }, { status: 429 });
  }

  const fieldError = enquiryFieldsError(b);
  if (fieldError) return NextResponse.json({ error: fieldError }, { status: 400 });
  if (!postcodeDistrict(b.postcode)) return NextResponse.json({ error: "Check your postcode." }, { status: 400 });
  if (!b.consent) {
    return NextResponse.json({ error: "Tick the box so we can pass your details to a local engineer." }, { status: 400 });
  }

  // CLAUDE.md §Compliance 4 — free text runs the gas-emergency interlock first.
  const check = checkEmergency(b.message);
  if (check.emergency && !b.acknowledged) {
    await track("emergency_interlock_triggered", { type: "CUSTOMER" }, { matched: check.matched, surface: "town_lead", townSlug: b.town });
    return NextResponse.json({ emergency: true }, { status: 409 });
  }

  await createTownLead({
    townSlug: b.town,
    townName: page?.name || engineers.find((e) => e.town)?.town || b.town,
    name: b.name.trim(),
    phone: b.phone.trim() ? (normaliseUkPhone(b.phone) ?? b.phone.trim()) : null,
    email: b.email.trim().toLowerCase() || null,
    postcode: b.postcode.trim(),
    message: b.message.trim(),
    emergency: check.emergency ? check.matched : null,
  });
  return NextResponse.json({ ok: true });
}

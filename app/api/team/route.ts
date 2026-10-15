import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { brandName } from "@/lib/engineer";
import { sendEmail } from "@/lib/email";
import { normaliseUkPhone } from "@/lib/phone";
import { uniqueSlug } from "@/lib/slug";
import { GAS_SAFE_NO } from "@/lib/validate";
import { storeGasSafeCard } from "@/lib/gas-safe-card";
import { staffCheckStatus } from "@/lib/team";

// Build Review 2, section 8 — the owner's Team page. Owners only
// (getEngineerId is null for staff).

export async function GET() {
  const ownerId = await getEngineerId();
  if (!ownerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const staff = await prisma.engineer.findMany({
    where: { ownerId, staffRemovedAt: null, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { plansSold: { where: { activatedAt: { not: null } } } } },
      plansSold: { where: { activatedAt: { gte: weekAgo } }, select: { id: true } },
    },
  });
  return NextResponse.json({
    staff: staff.map((s) => ({
      id: s.id,
      name: `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim(),
      email: s.email,
      phone: s.phone,
      check: staffCheckStatus(s),
      rejectReason: s.gasSafeRejectReason,
      joined: Boolean(s.emailVerifiedAt),
      signUpsTotal: s._count.plansSold,
      signUpsThisWeek: s.plansSold.length,
    })),
  });
}

const Body = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(20).optional(),
  gasSafeNo: z.string().transform((s) => s.replace(/\s/g, "")).pipe(z.string().regex(GAS_SAFE_NO)),
  cardBase64: z.string().min(1),
  cardMimeType: z.string().min(1),
});

export async function POST(req: Request) {
  const ownerId = await getEngineerId();
  if (!ownerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const msg =
      field === "email"
        ? "Enter their email — it's how they sign in."
        : field === "gasSafeNo"
          ? "Enter their Gas Safe number — digits only."
          : field === "cardBase64" || field === "cardMimeType"
            ? "Add a photo of their Gas Safe ID card."
            : "Add their first and last name.";
    return NextResponse.json({ error: msg, field }, { status: 400 });
  }
  const b = parsed.data;
  const phone = b.phone ? normaliseUkPhone(b.phone) : null;
  if (b.phone && !phone) {
    return NextResponse.json({ error: "That mobile number doesn't look right.", field: "phone" }, { status: 400 });
  }

  const owner = await prisma.engineer.findUniqueOrThrow({ where: { id: ownerId } });
  const clash = await prisma.engineer.findFirst({
    where: { OR: [{ email: b.email }, ...(phone ? [{ phone }] : []), { gasSafeNo: b.gasSafeNo }] },
    select: { email: true, phone: true, gasSafeNo: true },
  });
  if (clash) {
    const what =
      clash.email === b.email ? "email" : clash.gasSafeNo === b.gasSafeNo ? "Gas Safe number" : "mobile number";
    return NextResponse.json(
      { error: `That ${what} already has a TradeSura account. Ask us to move it to your team: info@tradesura.com` },
      { status: 409 },
    );
  }

  const card = await storeGasSafeCard(b.cardBase64, b.cardMimeType);
  if (!card.ok) return NextResponse.json({ error: card.error, field: "cardBase64" }, { status: 400 });

  const staff = await prisma.engineer.create({
    data: {
      ownerId,
      email: b.email,
      slug: await uniqueSlug(`${b.firstName} ${b.lastName} ${owner.slug}`),
      firstName: b.firstName,
      lastName: b.lastName,
      phone,
      tradingName: owner.tradingName,
      businessType: owner.businessType,
      // Each staff card is its own check in the admin queue; they can't send
      // offers until it's approved.
      gasSafeNo: b.gasSafeNo,
      gasSafeCardUrl: card.url,
      gasSafeReviewRequestedAt: new Date(),
    },
  });
  await track("staff_added", { type: "ENGINEER", id: ownerId }, { staffId: staff.id });

  const brand = brandName(owner);
  await sendEmail({
    to: b.email,
    subject: `${brand} has added you to their team on TradeSura`,
    html: `<p>Hi ${b.firstName},</p>
<p>${brand} has added you as an engineer on TradeSura, so you can sign customers up to ${brand}'s care plans.</p>
<p>Download the TradeSura app, tap <b>Sign in</b> and enter this email address — we'll send you a code. You don't need to set up a business or payments.</p>
<p>We're checking your Gas Safe registration now, usually within 24 hours. You can add customers straight away, and send plan offers once the check is done.</p>`,
  }).catch((err) => console.error("[team] invite email failed:", err));

  return NextResponse.json({ id: staff.id });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { uniqueSlug } from "@/lib/slug";
import { standingCopy, gasSafeStatus, paymentsStatus } from "@/lib/verification-state";

import { smsAvailable } from "@/lib/contact-verification";

const Body = z.object({
  tradingName: z.string().min(2).max(80),
  // Optional so older clients that only send the trading name keep working.
  // Accounts from older signup builds have no name at all — this is how the
  // engineer fills it in (greeting, avatar initials).
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  logoUrl: z.string().url().max(400).optional().or(z.literal("")),
});

// Mobile counterpart to the settings form's initial values in app/more/page.tsx.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const engineer = await prisma.engineer.findUnique({ where: { id: engineerId } });
  if (!engineer) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({
    tradingName: engineer.tradingName ?? "",
    logoUrl: engineer.logoUrl ?? "",
    slug: engineer.slug,
    firstName: engineer.firstName,
    lastName: engineer.lastName,
    phone: engineer.phone,
    smsSignInEnabled: engineer.smsSignInEnabled,
    smsAvailable: smsAvailable(),
    phoneVerifiedAt: engineer.phoneVerifiedAt,
    businessType: engineer.businessType,
    companyNumber: engineer.companyNumber,
    postcode: engineer.postcode,
    // Part 6.4/17.3 — the same truth source the dashboard strip and Payouts'
    // banner read. `standing` is the collapsed single-line ladder (used only
    // when banned/paused outranks everything else); `gasSafe`/`payments` are
    // Part 13's two independent status lines.
    standing: standingCopy(engineer),
    gasSafe: gasSafeStatus(engineer),
    payments: paymentsStatus(engineer),
  });
}

export async function PATCH(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    const messages: Record<string, string> = {
      firstName: "Enter your first name.",
      lastName: "Enter your last name.",
      tradingName: "Enter your trading name — at least 2 characters.",
    };
    return NextResponse.json({ error: messages[field] ?? "Check the form and try again." }, { status: 400 });
  }

  const slug = await uniqueSlug(parsed.data.tradingName, engineerId);
  await prisma.engineer.update({
    where: { id: engineerId },
    data: {
      tradingName: parsed.data.tradingName,
      ...(parsed.data.firstName ? { firstName: parsed.data.firstName } : {}),
      ...(parsed.data.lastName ? { lastName: parsed.data.lastName } : {}),
      logoUrl: parsed.data.logoUrl || null,
      slug,
    },
  });
  return NextResponse.json({ ok: true, slug });
}

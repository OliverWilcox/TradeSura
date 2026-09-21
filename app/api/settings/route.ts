import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { uniqueSlug } from "@/lib/slug";
import { standingCopy, gasSafeStatus, paymentsStatus } from "@/lib/verification-state";

const Body = z.object({
  tradingName: z.string().min(2).max(80),
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
    return NextResponse.json({ error: "Check the form and try again." }, { status: 400 });
  }

  const slug = await uniqueSlug(parsed.data.tradingName, engineerId);
  await prisma.engineer.update({
    where: { id: engineerId },
    data: {
      tradingName: parsed.data.tradingName,
      logoUrl: parsed.data.logoUrl || null,
      slug,
    },
  });
  return NextResponse.json({ ok: true, slug });
}

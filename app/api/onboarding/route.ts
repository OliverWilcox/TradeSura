import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { verifyGasSafe } from "@/lib/gas-safe";
import { uniqueSlug } from "@/lib/slug";

const Body = z.object({
  regNo: z.string().min(1).max(20),
  tradingName: z.string().min(2).max(80),
  logoUrl: z.string().url().max(400).optional().or(z.literal("")),
});

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the form and try again." }, { status: 400 });
  }

  // Re-verify server-side — the badge is earned, not claimed.
  const record = await verifyGasSafe(parsed.data.regNo);
  if (!record) {
    return NextResponse.json(
      { error: "No match on the Gas Safe register. Check the number and try again." },
      { status: 404 },
    );
  }

  const slug = await uniqueSlug(parsed.data.tradingName, engineerId);
  await prisma.engineer.update({
    where: { id: engineerId },
    data: {
      gasSafeNo: record.regNo,
      gasSafeName: record.name,
      gasSafeCompany: record.company,
      gasSafeCategories: record.categories,
      // 29 Sept review — the badge is granted by a reviewer in the admin
      // queue, never self-served; a register match only queues it.
      gasSafeReviewRequestedAt: new Date(),
      gasSafeRejectedAt: null,
      tradingName: parsed.data.tradingName,
      logoUrl: parsed.data.logoUrl || null,
      slug,
    },
  });
  return NextResponse.json({ ok: true, slug });
}

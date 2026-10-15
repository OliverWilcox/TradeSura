import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const Body = z.object({
  line1: z.string().trim().min(1).max(160),
  town: z.string().trim().min(1).max(80),
  postcode: z.string().trim().regex(/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i),
});

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your address, town and a valid UK postcode." }, { status: 400 });
  const { token } = await ctx.params;
  // Lock the plan while saving, so retries cannot create duplicate properties.
  const saved = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ customerId: string }[]>`
      SELECT "customerId" FROM "Plan" WHERE "signupToken" = ${token} AND status = 'PENDING' FOR UPDATE`;
    if (!rows[0]) return false;
    const customerId = rows[0].customerId;
    const data = { addressLine1: parsed.data.line1, town: parsed.data.town,
      postcode: parsed.data.postcode.replace(/\s/g, "").toUpperCase().replace(/(.{3})$/, " $1") };
    const existing = await tx.property.findFirst({ where: { customerId, ...data } });
    if (!existing) await tx.property.create({ data: { customerId, ...data } });
    return true;
  });
  if (!saved) return NextResponse.json({ error: "This signup link is no longer available — ask your engineer for a new one." }, { status: 409 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normaliseUkPhone } from "@/lib/phone";

const Body = z.object({ phone: z.string().min(6).max(20) });

// Signup step 1 — 4 Oct build notes, P0: "This mobile is already registered.
// Sign in instead?" the moment the number is entered (one mobile, one
// account). Same shape as check-email.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const phone = parsed.success ? normaliseUkPhone(parsed.data.phone) : null;
  if (!phone) {
    return NextResponse.json({ error: "That doesn't look like a UK mobile number." }, { status: 400 });
  }
  const existing = await prisma.engineer.findUnique({ where: { phone }, select: { id: true } });
  return NextResponse.json({ available: !existing });
}

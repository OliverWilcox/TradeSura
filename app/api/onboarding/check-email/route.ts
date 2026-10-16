import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const Body = z.object({ email: z.string().email().max(200) });

// Signup step 1 — "email format + already-registered check" (29 Sept
// review). Sign-in already answers "No account found" for an unknown email,
// so this reveals nothing new about who's registered.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
  }
  const existing = await prisma.engineer.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    select: { id: true },
  });
  return NextResponse.json({ available: !existing });
}

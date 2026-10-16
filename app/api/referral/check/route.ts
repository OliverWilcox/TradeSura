import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";

// Signup step 1 — referral code: "accepted or politely rejected, never
// blocking" (29 Sept review). A code is the referrer's slug, the same thing
// their invite link carries (/r/{slug}).
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code")?.trim().toLowerCase();
  if (!code) return NextResponse.json({ valid: false });
  const referrer = await prisma.engineer.findUnique({
    where: { slug: code },
    select: { tradingName: true, slug: true, firstName: true },
  });
  if (!referrer) return NextResponse.json({ valid: false });
  return NextResponse.json({ valid: true, name: referrer.firstName || brandName(referrer) });
}

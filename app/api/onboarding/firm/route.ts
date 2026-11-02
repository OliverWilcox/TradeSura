import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyToken } from "@/lib/auth";
import { findFirm } from "@/lib/team-join";

// 30 Oct update 3.9 — sign-up step 3 asks whether this firm is already on
// TradeSura (its letter code was claimed, or its company number is on an
// owner account). Gated by the verified-mobile token from step 1, like the
// Companies House lookup, so it isn't an open directory.
const Body = z.object({
  phoneToken: z.string().min(1),
  claimCode: z.string().max(20).optional(),
  companyNumber: z.string().max(20).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ firm: null });
  const phone = await verifyToken(parsed.data.phoneToken);
  if (phone?.verified !== "1") {
    return NextResponse.json({ error: "Phone verification expired — go back and verify your mobile again." }, { status: 400 });
  }
  const firm = await findFirm(parsed.data);
  return NextResponse.json({
    firm: firm ? { businessName: firm.businessName, ownerFirstName: firm.ownerFirstName } : null,
  });
}

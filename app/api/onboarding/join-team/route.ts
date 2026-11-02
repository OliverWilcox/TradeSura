import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyToken } from "@/lib/auth";
import { track } from "@/lib/track";
import { findFirm, requestToJoin } from "@/lib/team-join";
import { GAS_SAFE_NO } from "@/lib/validate";

// 30 Oct update 3.9 — the second person from a firm asks its owner to add
// them as staff, instead of making a second account (or taking a second
// Founding spot). Only verified details are passed on: the email and mobile
// come from step 1's verification tokens, never straight from the client.
const Body = z.object({
  phoneToken: z.string().min(1),
  emailToken: z.string().min(1),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  gasSafeNo: z
    .string()
    .transform((s) => s.replace(/\s/g, ""))
    .pipe(z.string().regex(GAS_SAFE_NO))
    .optional(),
  claimCode: z.string().max(20).optional(),
  companyNumber: z.string().max(20).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check your details and try again." }, { status: 400 });
  const b = parsed.data;
  const [phone, email] = await Promise.all([verifyToken(b.phoneToken), verifyToken(b.emailToken)]);
  if (phone?.verified !== "1" || !phone.phone || email?.emailVerified !== "1" || !email.email) {
    return NextResponse.json(
      { error: "Your verification has expired — go back to step 1 and verify again.", code: "email_unverified" },
      { status: 400 },
    );
  }
  const firm = await findFirm(b);
  if (!firm) return NextResponse.json({ error: "We couldn't find that business's account any more." }, { status: 404 });
  const requestId = await requestToJoin(firm, {
    firstName: b.firstName,
    lastName: b.lastName,
    email: email.email,
    phone: phone.phone,
    gasSafeNo: b.gasSafeNo,
  });
  await track("team_join_request_sent", { type: "ENGINEER", id: firm.ownerId }, { requestId }).catch(() => {});
  return NextResponse.json({ ok: true, ownerFirstName: firm.ownerFirstName, businessName: firm.businessName });
}

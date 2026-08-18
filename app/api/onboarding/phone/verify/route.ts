import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { signToken, verifyToken } from "@/lib/auth";

const Body = z.object({ requestToken: z.string().min(1), code: z.string().min(4).max(8) });

// Step 2 of the phone check: on a match, hands back a short-lived "this phone
// is verified" token. /api/auth/request re-verifies it server-side before
// trusting it, so the wizard can carry it around client-side safely.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the code." }, { status: 400 });
  }

  const payload = await verifyToken(parsed.data.requestToken);
  if (!payload?.phone || !payload.codeHash) {
    return NextResponse.json(
      { error: "That code has expired — request a new one." },
      { status: 400 },
    );
  }

  const submittedHash = createHash("sha256").update(parsed.data.code.trim()).digest("hex");
  if (submittedHash !== payload.codeHash) {
    return NextResponse.json({ error: "That code doesn't match — check and try again." }, { status: 400 });
  }

  const phoneToken = await signToken({ phone: payload.phone, verified: "1" }, "30m");
  return NextResponse.json({ phoneToken, phone: payload.phone });
}

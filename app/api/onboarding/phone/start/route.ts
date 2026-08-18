import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { signToken } from "@/lib/auth";
import { normaliseUkPhone } from "@/lib/phone";
import { sendVerificationCode } from "@/lib/sms";

const Body = z.object({ phone: z.string().min(6).max(20) });

// Step 1 of the signup wizard's phone check. Stateless like magic-link auth —
// the code's hash (never the code itself, since a signed JWT is readable by
// whoever holds it) rides in a short-lived token the client carries to
// /verify, rather than a DB row.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your mobile number." }, { status: 400 });
  }
  const phone = normaliseUkPhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json({ error: "That doesn't look like a UK mobile number." }, { status: 400 });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = createHash("sha256").update(code).digest("hex");
  const requestToken = await signToken({ phone, codeHash }, "10m");
  await sendVerificationCode(phone, code);

  return NextResponse.json({ requestToken });
}

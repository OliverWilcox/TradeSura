import { NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { signToken } from "@/lib/auth";
import { sessionToken } from "@/lib/sign-in-code";

const Body = z.object({ identityToken: z.string().min(1).max(5000) });

const APPLE_ISSUER = "https://appleid.apple.com";
const appleKeys = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));
// The iOS app's bundle id — Apple sets it as the identity token's audience.
const APPLE_AUDIENCE = process.env.APPLE_BUNDLE_ID || "com.tradesura.engineerx";

// "Continue with Apple" (30 Sept build notes, step 1 item 5). The app never
// trusts what the Apple sheet hands it directly — only claims from an
// identity token whose signature checks out against Apple's keys.
//   - Apple id already linked (or the Apple email already has an account,
//     which then gets linked) → signed in, same as /api/auth/request.
//   - Otherwise → a short-lived appleToken for the signup to carry, plus the
//     verified email to pre-fill. The account is linked at "Create my free
//     account"; phone, Gas Safe and business steps still apply.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Apple sign-in didn't complete — try again." }, { status: 400 });
  }

  let sub: string;
  let email: string | null;
  try {
    const { payload } = await jwtVerify(parsed.data.identityToken, appleKeys, {
      issuer: APPLE_ISSUER,
      audience: APPLE_AUDIENCE,
    });
    if (!payload.sub) throw new Error("no sub");
    sub = payload.sub;
    email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch (err) {
    console.error("[auth/apple] identity token rejected:", (err as Error).message);
    return NextResponse.json(
      { error: "Apple sign-in couldn't be checked — try again, or use your email." },
      { status: 401 },
    );
  }

  let engineer = await prisma.engineer.findUnique({ where: { appleSub: sub } });
  if (!engineer && email) {
    const byEmail = await prisma.engineer.findUnique({ where: { email } });
    if (byEmail && !byEmail.appleSub) {
      engineer = await prisma.engineer.update({ where: { id: byEmail.id }, data: { appleSub: sub } });
    }
  }
  if (engineer) {
    const token = await sessionToken(engineer.id);
    return NextResponse.json({ token });
  }

  const appleToken = await signToken({ appleSub: sub, ...(email ? { appleEmail: email } : {}) }, "1h");
  return NextResponse.json({ appleToken, email });
}

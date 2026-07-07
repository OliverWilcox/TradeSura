import { NextResponse } from "next/server";
import { z } from "zod";
import { signToken } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

const Body = z.object({ email: z.string().email().max(200) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();
  const token = await signToken({ email }, "15m");
  const link = `${process.env.APP_URL}/api/auth/callback?token=${token}`;

  await sendEmail({
    to: email,
    subject: "Sign in to Tradeshura",
    html: `<p>Tap to sign in to Tradeshura:</p><p><a href="${link}">${link}</a></p><p>This link is valid for 15 minutes.</p>`,
  });

  // Dev email driver only prints to the server console; surface the link in
  // dev so the flow is walkable in a browser.
  return NextResponse.json({
    ok: true,
    ...(process.env.NODE_ENV !== "production" ? { devLink: link } : {}),
  });
}

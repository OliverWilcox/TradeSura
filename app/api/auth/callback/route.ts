import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, verifyToken } from "@/lib/auth";
import { track } from "@/lib/track";
import { uniqueSlug } from "@/lib/slug";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const payload = token ? await verifyToken(token) : null;
  if (!payload?.email) {
    return NextResponse.redirect(`${process.env.APP_URL}/signin?error=expired`);
  }

  let engineer = await prisma.engineer.findUnique({ where: { email: payload.email } });
  if (!engineer) {
    const slug = await uniqueSlug(payload.email.split("@")[0]);
    engineer = await prisma.engineer.create({ data: { email: payload.email, slug } });
    await track("engineer_signed_up", { type: "ENGINEER", id: engineer.id }, { slug });
  }

  await createSession(engineer.id);
  const dest = engineer.gasSafeVerifiedAt ? "/" : "/onboarding";
  return NextResponse.redirect(`${process.env.APP_URL}${dest}`);
}

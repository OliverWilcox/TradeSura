import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { QUALIFICATION_PROMPTS } from "@/lib/clauses";
import { confirmedQualifications } from "@/lib/plan-rules";

// Review 3 R12 — switching on an option that needs a qualification asks the
// engineer to confirm they hold it. Stored with the date; the admin
// verification queue shows it. No lookup, no greying out.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const engineer = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { qualificationConfirmations: true },
  });
  return NextResponse.json({
    prompts: QUALIFICATION_PROMPTS,
    confirmed: confirmedQualifications(engineer?.qualificationConfirmations),
  });
}

const Body = z.object({ code: z.string() });

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !QUALIFICATION_PROMPTS[parsed.data.code]) {
    return NextResponse.json({ error: "That option doesn't need a confirmation." }, { status: 400 });
  }
  const engineer = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { qualificationConfirmations: true },
  });
  const confirmed = {
    ...confirmedQualifications(engineer?.qualificationConfirmations),
    [parsed.data.code]: new Date().toISOString(),
  };
  await prisma.engineer.update({ where: { id: engineerId }, data: { qualificationConfirmations: confirmed } });
  await track("qualification_confirmed", { type: "ENGINEER", id: engineerId }, { code: parsed.data.code });
  return NextResponse.json({ confirmed });
}

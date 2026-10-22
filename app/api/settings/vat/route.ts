import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";

// R5 (Build Review 3) — "VAT registered" on the engineer's account. When on,
// customer pages show prices as "£X a month including VAT". Owners only:
// getEngineerId() is null for staff, who see no settings.
const Body = z.object({ vatRegistered: z.boolean() });

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the form and try again." }, { status: 400 });

  await prisma.engineer.update({
    where: { id: engineerId },
    data: { vatRegistered: parsed.data.vatRegistered },
  });
  await track(
    "vat_registered_changed",
    { type: "ENGINEER", id: engineerId },
    { vatRegistered: parsed.data.vatRegistered },
  ).catch(() => {});
  return NextResponse.json({ ok: true, vatRegistered: parsed.data.vatRegistered });
}

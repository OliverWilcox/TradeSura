import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";

// Installer messages on WhatsApp (lib/whatsapp.ts). Meta needs a recorded
// opt-in, so the switch on Account stores when it was given; off goes back
// to texts. Owners only: getEngineerId() is null for staff.
const Body = z.object({ enabled: z.boolean() });

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the form and try again." }, { status: 400 });

  const { enabled } = parsed.data;
  await prisma.engineer.update({
    where: { id: engineerId },
    data: { whatsappOptInAt: enabled ? new Date() : null },
  });
  await track(enabled ? "whatsapp_opted_in" : "whatsapp_opted_out", { type: "ENGINEER", id: engineerId }, { via: "account" }).catch(
    () => {},
  );
  return NextResponse.json({ ok: true, whatsappUpdates: enabled });
}

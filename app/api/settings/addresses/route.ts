import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { AddressInput, saveAddresses } from "@/lib/addresses";

// The engineer's trading address (sets their town and town page) and where
// their post goes: "same" as trading, or an address of its own.
const Body = z.object({ trading: AddressInput, correspondence: z.union([z.literal("same"), AddressInput]) });

const MESSAGES: Record<string, string> = {
  lines: "Enter the first line of the address.",
  town: "Enter the town.",
  postcode: "Enter a full UK postcode, like HD9 2TT.",
};

export async function PUT(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const which = issue?.path[0] === "correspondence" ? "correspondence" : "trading";
    const field = String(issue?.path[1] ?? "");
    return NextResponse.json({ error: MESSAGES[field] ?? "Check the address and try again.", field: which }, { status: 400 });
  }
  const saved = await prisma.$transaction((tx) => saveAddresses(tx, engineerId, parsed.data, { source: "engineer" }));
  await track("addresses_changed", { type: "ENGINEER", id: engineerId }, { townChanged: saved.townBefore !== saved.town, sameAsTrading: saved.correspondenceSameAsTrading });
  return NextResponse.json({ ok: true, town: saved.town, correspondenceSameAsTrading: saved.correspondenceSameAsTrading });
}

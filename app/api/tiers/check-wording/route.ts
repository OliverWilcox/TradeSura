import { NextResponse } from "next/server";
import { z } from "zod";
import { getEngineerId } from "@/lib/auth";
import { checkWording } from "@/lib/compliance/blocklist";

const Body = z.object({ text: z.string().min(1).max(80) });

// Instant wording feedback for the mobile plan builder's custom-label field.
// The blocklist itself (lib/compliance/blocklist.ts) is compliance-critical
// (CLAUDE.md §Compliance 1) and stays server-side only — the web client
// gets to run it locally because it's the same codebase, but duplicating
// the regex list into the separate mobile app would risk the two drifting
// apart. PUT /api/tiers/[tierId] re-checks authoritatively on save either way.
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter some text." }, { status: 400 });
  }
  return NextResponse.json(checkWording(parsed.data.text));
}

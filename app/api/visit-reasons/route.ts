import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth";
import { reasonList } from "@/lib/visit-reasons";

// 30 Oct update §6 — the installer's one-tap "Why were you there?" list.
// Matt edits it in the admin (VisitReasonContent); the defaults ship in
// lib/visit-reasons.ts so the app never shows an empty list.
export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ reasons: await reasonList() });
}

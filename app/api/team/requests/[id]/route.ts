import { NextResponse } from "next/server";
import { getEngineerId } from "@/lib/auth";
import { joinRequestFor } from "@/lib/team-join";

// 30 Oct update 3.9 — the owner opens a "wants to join your team" push; the
// Add an engineer form fills in from the request. Owners only, own requests.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getEngineerId();
  if (!ownerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const request = await joinRequestFor(ownerId, (await params).id);
  if (!request) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(request);
}

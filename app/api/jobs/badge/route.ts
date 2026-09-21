import { NextResponse } from "next/server";
import { getEngineerId } from "@/lib/auth";
import { dueServices } from "@/lib/reminders";

// Build Guide v2 Part 3: the Reminders bell wears a red count badge only when
// items are due this week or overdue — zero items, no badge. This is the
// tab bar's one lightweight poll (it deliberately doesn't ride on /api/me,
// which can touch Stripe).
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const cutoff = new Date(Date.now() + WEEK_MS);
  const due = await dueServices(engineerId);
  return NextResponse.json({ due: due.filter((d) => d.dueDate <= cutoff).length });
}

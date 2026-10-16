import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth";
import { dueServices } from "@/lib/reminders";

// Build Guide v2 Part 3: the Reminders bell wears a red count badge only when
// items are due this week or overdue — zero items, no badge. This is the
// tab bar's one lightweight poll (it deliberately doesn't ride on /api/me,
// which can touch Stripe).
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const cutoff = new Date(Date.now() + WEEK_MS);
  const due = await dueServices(actor.businessId, {
    addedById: actor.role === "staff" ? actor.actorId : undefined,
  });
  const now = new Date();
  // Part 11: the app-icon badge mirrors overdue only; the tab badge also
  // counts this week.
  return NextResponse.json({
    due: due.filter((d) => d.dueDate <= cutoff).length,
    overdue: due.filter((d) => d.dueDate < now).length,
  });
}

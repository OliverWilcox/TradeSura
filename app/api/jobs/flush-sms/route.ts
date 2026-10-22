import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getEngineerId } from "@/lib/auth";
import { flushSmsQueue } from "@/lib/sms";
import { queueServiceReminders } from "@/lib/reminders";
import { applyDuePriceReviews } from "@/lib/price-review";
import { endUnpaidPlans, resumeDuePausedPlans } from "@/lib/plan-billing";

// Queue due service reminders (Part 11's 30/14/3 engine), apply due price
// reviews, then flush the SMS
// queue (quiet-hours holds, offer nudges). Vercel Cron calls GET daily — see
// vercel.json; on the Hobby plan once a day is the most it allows.
async function run() {
  const remindersQueued = await queueServiceReminders();
  // Ruling 3 — price reviews whose 30-day notice has run out take effect.
  const priceReviewsApplied = await applyDuePriceReviews();
  // Retention spec — pauses that have run their course, and failed payments
  // still unpaid after the 14-day grace period.
  const pausesEnded = await resumeDuePausedPlans();
  const unpaidPlansEnded = await endUnpaidPlans();
  const sent = await flushSmsQueue();
  return NextResponse.json({ sent, remindersQueued, priceReviewsApplied, pausesEnded, unpaidPlansEnded });
}

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
function isCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return Boolean(secret) && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export async function GET(req: Request) {
  if (!isCron(req)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return run();
}

// The dev-only "Run queue now" button in Account. Signed-in engineers only —
// it was previously callable by anyone.
export async function POST() {
  if (!(await getEngineerId())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return run();
}

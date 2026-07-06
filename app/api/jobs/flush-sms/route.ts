import { NextResponse } from "next/server";
import { flushSmsQueue } from "@/lib/sms";

// Dev queue flush for quiet-hours + nudge messages.
// ponytail: manual flush; a cron hits this in deployment
export async function POST() {
  const sent = await flushSmsQueue();
  return NextResponse.json({ sent });
}

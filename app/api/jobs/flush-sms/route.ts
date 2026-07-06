import { NextResponse } from "next/server";
import { flushSmsQueue } from "@/lib/sms";
import { queueServiceReminders } from "@/lib/reminders";

// One dev job endpoint: queue due service reminders, then flush the SMS queue.
// ponytail: manual trigger + More-tab button; a cron hits this in deployment
export async function POST() {
  const remindersQueued = await queueServiceReminders();
  const sent = await flushSmsQueue();
  return NextResponse.json({ sent, remindersQueued });
}

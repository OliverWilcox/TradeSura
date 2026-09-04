import { NextResponse } from "next/server";
import { z } from "zod";
import { track } from "@/lib/track";

// W0's four events fire before anyone is signed in, so there's no
// engineer/customer to attach them to yet — SYSTEM actor, same as other
// pre-account analytics. Deliberately a narrow whitelist, not a general
// anonymous-event endpoint, since this is unauthenticated.
const Body = z.object({
  event: z.enum([
    "welcome_viewed",
    "welcome_start_tapped",
    "welcome_signin_tapped",
    "welcome_dismissed",
  ]),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad event." }, { status: 400 });
  await track(parsed.data.event, { type: "SYSTEM" }, parsed.data.meta);
  return NextResponse.json({ ok: true });
}

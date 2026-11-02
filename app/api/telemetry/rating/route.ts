import { NextResponse } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/auth";
import { track } from "@/lib/track";

// Matt, 30 Oct §8 — which happy moment asked for an App Store / Play rating.
// (Whether they rated isn't knowable: the OS never says.)
const Body = z.object({ moment: z.enum(["verified", "first_customer", "first_payout"]) });

export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check your request." }, { status: 400 });
  await track("rating_prompt_shown", { type: "ENGINEER", id: actor.actorId }, { moment: parsed.data.moment });
  return NextResponse.json({ ok: true });
}

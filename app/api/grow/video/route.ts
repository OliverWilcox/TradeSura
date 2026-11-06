import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { track } from "@/lib/track";
import { howToVideoUrl } from "@/lib/grow";

// Matt, 6 Nov — "How to offer a plan in 60 seconds": ticks once watched.
// Nothing to watch until the video's address is set, so nothing to tick.
export async function POST() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!howToVideoUrl()) return NextResponse.json({ error: "The video isn't out yet." }, { status: 409 });
  const me = await prisma.engineer.findUnique({ where: { id: actor.actorId }, select: { howToVideoWatchedAt: true } });
  if (!me?.howToVideoWatchedAt) {
    await prisma.engineer.update({ where: { id: actor.actorId }, data: { howToVideoWatchedAt: new Date() } });
    await track("grow_video_watched", { type: "ENGINEER", id: actor.actorId }, {});
  }
  return NextResponse.json({ ok: true });
}

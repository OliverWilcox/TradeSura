import { prisma } from "@/lib/db";
import type { ActorType } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";

export async function track(
  name: string,
  actor: { type: ActorType; id?: string },
  meta?: Record<string, unknown>,
) {
  await prisma.event.create({
    data: {
      name,
      actorType: actor.type,
      actorId: actor.id,
      meta: (meta ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

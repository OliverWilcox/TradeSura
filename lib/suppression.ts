import { prisma } from "@/lib/db";

// One cross-channel opt-out store. STOP replies and unsubscribe links write
// here; every marketing send path checks it. See CLAUDE.md §Compliance 5.

export async function isSuppressed(channel: "sms" | "email", value: string): Promise<boolean> {
  const v = channel === "email" ? value.toLowerCase() : value;
  return Boolean(await prisma.suppression.findUnique({ where: { channel_value: { channel, value: v } } }));
}

export async function suppress(channel: "sms" | "email", value: string, source: string) {
  const v = channel === "email" ? value.toLowerCase() : value;
  await prisma.suppression.upsert({
    where: { channel_value: { channel, value: v } },
    update: { source },
    create: { channel, value: v, source },
  });
}

export async function unsuppress(channel: "sms" | "email", value: string) {
  const v = channel === "email" ? value.toLowerCase() : value;
  await prisma.suppression.deleteMany({ where: { channel, value: v } });
}

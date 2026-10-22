// Retention spec §9 — the win-back offer is honoured at checkout: a customer
// arriving from their rejoin link gets the engineer's "first month free" if
// that's the offer the engineer chose, on top of the 14-day cooling-off.
import { prisma } from "@/lib/db";
import { parseWinbackOffer, winbackSettingKey } from "@/lib/retention";

export async function rejoinFreeMonth(engineerId: string, rejoinToken: string | undefined | null): Promise<boolean> {
  if (!rejoinToken) return false;
  const plan = await prisma.plan.findFirst({
    where: { rejoinToken, engineerId, status: "CANCELLED" },
    select: { id: true },
  });
  if (!plan) return false;
  const setting = await prisma.appSetting.findUnique({ where: { key: winbackSettingKey(engineerId) } });
  return parseWinbackOffer(setting?.value) === "first_month_free";
}

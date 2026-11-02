import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { pushSupported } from "@/lib/push";

// 30 Oct update §6.1 — the 5pm nudge, one of the ways into an offer now that
// installers don't log jobs. A local notification on the phone, Monday to
// Friday at 17:00: the server's cron only runs once a day (Hobby plan), and
// this needs no signal. Tapping it opens Offer a plan (data.url, handled in
// app/_layout.tsx).
const ID_PREFIX = "offer-5pm-";
// expo-notifications weekday: 1 = Sunday … 7 = Saturday.
const WEEKDAYS = [2, 3, 4, 5, 6];

export async function scheduleOfferNudge(): Promise<void> {
  if (!pushSupported() || Platform.OS === "web") return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") return;
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  const have = new Set(existing.map((n) => n.identifier).filter((id) => id.startsWith(ID_PREFIX)));
  for (const weekday of WEEKDAYS) {
    const identifier = `${ID_PREFIX}${weekday}`;
    if (have.has(identifier)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: "Anyone you saw today?",
        body: "Offer them a plan. It takes about 90 seconds and the app does the selling.",
        data: { url: "/offer" },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday, hour: 17, minute: 0 },
    });
  }
}

/** While offers are locked (or on sign-out) there's nothing to nudge towards. */
export async function cancelOfferNudge(): Promise<void> {
  if (Platform.OS === "web") return;
  await Promise.all(WEEKDAYS.map((w) => Notifications.cancelScheduledNotificationAsync(`${ID_PREFIX}${w}`).catch(() => {})));
}

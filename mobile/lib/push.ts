import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { api } from "@/lib/api";

// Build Guide v2 Part 11 — push notifications. The backend half lives in
// ../../lib/push.ts; this registers the device's Expo token with it.

// Foreground pushes still show a banner — a payout or a gas-safety alert
// matters just as much while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Simulators can't receive pushes and web has no Expo push token.
export function pushSupported(): boolean {
  return Platform.OS !== "web" && Device.isDevice;
}

export async function pushPermission(): Promise<Notifications.PermissionStatus | null> {
  if (!pushSupported()) return null;
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

// Asks the OS (only if not yet decided) and registers the token. Returns
// whether the device ended up registered. Safe to call on every launch:
// tokens can rotate, and the backend just overwrites the stored one.
export async function registerForPush(ask: boolean): Promise<boolean> {
  if (!pushSupported()) return false;
  let { status } = await Notifications.getPermissionsAsync();
  if (status === "undetermined" && ask) {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== "granted") return false;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "TradeSura",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api("/api/me/push-token", { method: "POST", body: JSON.stringify({ token: data }) });
    return true;
  } catch (err) {
    console.warn("[push] registration failed:", err);
    return false;
  }
}

// Sign-out: stop this device receiving the engineer's notifications. Must
// run while the bearer token is still valid.
export async function unregisterPush(): Promise<void> {
  if (!pushSupported()) return;
  await api("/api/me/push-token", { method: "DELETE" }).catch(() => {
    // Best-effort — a failure never blocks sign-out.
  });
}

export function setOverdueBadge(count: number) {
  if (Platform.OS === "web") return;
  Notifications.setBadgeCountAsync(count).catch(() => {});
}

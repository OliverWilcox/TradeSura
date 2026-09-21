// Build Guide v2 Part 11 — push notifications. Thin provider interface,
// same shape as lib/sms.ts and lib/email.ts: one function callers use, all
// the actual delivery detail lives here.
//
// No new dependency (CLAUDE.md's "keep dependencies minimal") — Expo's push
// API is one plain JSON POST, so a raw fetch does the whole job. Reach for
// expo-server-sdk instead once real volume needs its batching/receipt
// tooling; a single-token send per event doesn't.
import { prisma } from "@/lib/db";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

// Expo issues tokens as "ExponentPushToken[...]" (classic) or
// "ExpoPushToken[...]" (current) — accept either rather than assuming one.
export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[.+\]$/.test(token);
}

// Never throws — a push is a nice-to-have on top of the SMS/email a given
// event already sends (see activate.ts, auth/request/route.ts), not
// something worth failing the triggering request over. Every caller can
// fire-and-forget this the same way notifyEngineer (lib/sms.ts) is used.
export async function sendPushNotification(
  engineerId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
) {
  const engineer = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { expoPushToken: true },
  });
  if (!engineer?.expoPushToken) return; // no device registered — silent no-op, not an error
  try {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify({
        to: engineer.expoPushToken,
        title,
        body,
        ...(data ? { data } : {}),
      }),
    });
    const json = await res.json().catch(() => null);
    // Expo's push API returns 200 with a per-message ticket even on some
    // failures (e.g. DeviceNotRegistered) — log rather than throw so a
    // stale token doesn't take down whatever event triggered the send.
    if (!res.ok || json?.data?.status === "error") {
      console.error("[push] Expo push send failed:", res.status, json);
      // DeviceNotRegistered means the token is dead (uninstalled, or a new
      // token issued) — clear it so future sends don't keep hitting Expo
      // with a token guaranteed to fail.
      if (json?.data?.details?.error === "DeviceNotRegistered") {
        await prisma.engineer
          .update({ where: { id: engineerId }, data: { expoPushToken: null } })
          .catch(() => {});
      }
    }
  } catch (err) {
    console.error("[push] Expo push send threw:", err);
  }
}

import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import { api, ApiError } from "@/lib/api";

// 30 Oct update §6.7 — no signal (lofts, basements): an offer that can't
// reach the server is kept on the phone with the customer's name and mobile,
// and the link goes out by text automatically once the phone is back online.
// No error screen. Persisted so it survives the app being closed.

export type QueuedOffer = {
  id: string;
  savedAt: string;
  reason: string;
  tierId: string;
  customerId?: string | null;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  town?: string;
  postcode?: string;
};

const KEY = "ts_offer_queue";

// Web is a dev preview only (mobile/CLAUDE.md): localStorage there.
const file = Platform.OS === "web" ? null : new File(Paths.document, "offer-queue.json");

async function read(): Promise<QueuedOffer[]> {
  try {
    const raw = file ? (file.exists ? await file.text() : null) : globalThis.localStorage?.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function write(list: QueuedOffer[]): Promise<void> {
  const raw = JSON.stringify(list);
  if (file) {
    if (!file.exists) file.create();
    file.write(raw);
  } else globalThis.localStorage?.setItem(KEY, raw);
}

/** Status 0 is "never reached the server" (lib/api.ts) — the only case we queue. */
export function isOffline(e: unknown): boolean {
  return e instanceof ApiError && e.status === 0;
}

export async function queueOffer(offer: Omit<QueuedOffer, "id" | "savedAt">): Promise<void> {
  const list = await read();
  list.push({ ...offer, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, savedAt: new Date().toISOString() });
  await write(list);
}

export async function queuedOffers(): Promise<QueuedOffer[]> {
  return read();
}

let flushing = false;

/**
 * Sends whatever is waiting. Stops at the first offer that still can't reach
 * the server (still no signal); drops one the server refuses outright (e.g.
 * the plan was retired), so one bad entry never blocks the rest.
 */
export async function flushOfferQueue(): Promise<{ sent: number; left: number }> {
  if (flushing) return { sent: 0, left: (await read()).length };
  flushing = true;
  let sent = 0;
  try {
    let list = await read();
    while (list.length) {
      const o = list[0];
      try {
        await api("/api/offer", {
          method: "POST",
          body: JSON.stringify({
            tierId: o.tierId,
            reason: o.reason,
            channel: "sms",
            ...(o.customerId
              ? { customerId: o.customerId }
              : {
                  firstName: o.firstName,
                  lastName: o.lastName,
                  phone: o.phone,
                  email: o.email || undefined,
                  addressLine1: o.addressLine1,
                  town: o.town,
                  postcode: o.postcode,
                }),
          }),
        });
        sent += 1;
      } catch (e) {
        if (isOffline(e)) break;
        console.warn("[offer-queue] dropped an offer the server refused:", e);
      }
      list = list.slice(1);
      await write(list);
    }
    return { sent, left: list.length };
  } finally {
    flushing = false;
  }
}

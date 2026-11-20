import { createHmac } from "node:crypto";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { claimForPage } from "@/lib/claim";

// Letter → app without Branch or AppsFlyer (Matt, 13 Nov). When the claim
// page sends someone to the App Store, we note the code against a one-way
// hash of their network address. On the app's first open (no code in hand,
// nothing on the clipboard) it asks whether a claim page was opened from the
// same network in the last hour, and gets the code back only when exactly one
// was. The raw address is never stored. Android doesn't need this: the Play
// Store passes the code through (storeUrl's referrer).

const WINDOW_MS = 60 * 60 * 1000;

function networkAddress(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || null;
}

/** One-way, keyed: the hint can only be matched by our own server. */
export function networkKey(req: Request): string | null {
  const address = networkAddress(req);
  const secret = process.env.SESSION_SECRET;
  if (!address || !secret) return null;
  return createHmac("sha256", secret).update(`install-match:${address}`).digest("hex").slice(0, 32);
}

export async function recordInstallHint(code: string, req: Request): Promise<void> {
  const net = networkKey(req);
  if (net) await track("claim_install_hint", { type: "SYSTEM" }, { code, net });
}

/** The single claim code opened from this network in the last hour, still unclaimed; otherwise null. */
export async function matchInstall(req: Request, now = new Date()): Promise<string | null> {
  const net = networkKey(req);
  if (!net) return null;
  const hints = await prisma.event.findMany({
    where: { name: "claim_install_hint", ts: { gte: new Date(now.getTime() - WINDOW_MS) }, meta: { path: ["net"], equals: net } },
    select: { meta: true },
    take: 20,
  });
  const codes = [...new Set(hints.map((h) => (h.meta as { code?: string } | null)?.code).filter((c): c is string => Boolean(c)))];
  if (codes.length !== 1) return null;
  const row = await claimForPage(codes[0]);
  return row ? row.code : null;
}

import { prisma } from "@/lib/db";
import { signToken, verifyToken } from "@/lib/auth";
import { track } from "@/lib/track";
import { ipHash, recentAttempts } from "@/lib/enquiries";

// Forgiving of case, spaces and dashes: "ts 48217" / "TS-48217" → "TS-48217".
export function normaliseClaimCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = cleaned.match(/^TS(\d{4,8})$/);
  return m ? `TS-${m[1]}` : cleaned;
}

export type ResolvedClaim =
  | {
      valid: true;
      personalised: boolean;
      /** What's printed on the letter, and nothing else from our list (30 Oct update §1.2). */
      businessName?: string;
      town?: string;
      letterBatch: string;
      variantCell: string;
      /**
       * §3.3 — what they confirmed on the claim page, for the app to show
       * back. Only with the personal link's token: codes are short and
       * guessable, so a bare code never reveals a mobile or an address.
       */
      claimed?: {
        tradingAddress: string | null;
        tradingTown: string | null;
        correspondenceAddress: string | null;
        mobile: string | null;
      };
    }
  | { valid: false };

// The secret in the personal link we text (§1.4): single-purpose, tied to
// one code, and it expires. It's what lets the app load the mobile and
// addresses they confirmed; the code alone never does.
const APP_TOKEN_PURPOSE = "claim-app";
export const CLAIM_APP_TOKEN_TTL = "30d";

export async function claimAppToken(code: string): Promise<string> {
  return signToken({ purpose: APP_TOKEN_PURPOSE, code }, CLAIM_APP_TOKEN_TTL);
}

export async function appTokenAllows(token: string | null | undefined, code: string): Promise<boolean> {
  if (!token) return false;
  const p = await verifyToken(token);
  return Boolean(p && p.purpose === APP_TOKEN_PURPOSE && p.code === code);
}

export async function resolveClaimCode(input: string, appToken?: string | null): Promise<ResolvedClaim> {
  const code = normaliseClaimCode(input);
  const row = await prisma.claimCode.findUnique({ where: { code } });
  if (!row) return { valid: false };
  // Suppressed (opted out): the code still works, but no personalisation.
  if (row.suppressedAt) {
    return { valid: true, personalised: false, letterBatch: row.letterBatch, variantCell: row.variantCell };
  }
  const showClaimed = Boolean(row.claimedAt) && (await appTokenAllows(appToken, row.code));
  return {
    valid: true,
    personalised: true,
    businessName: row.businessName,
    ...(row.town ? { town: row.town } : {}),
    letterBatch: row.letterBatch,
    variantCell: row.variantCell,
    ...(showClaimed
      ? {
          claimed: {
            tradingAddress: row.tradingAddress,
            tradingTown: row.tradingTown,
            correspondenceAddress: row.correspondenceAddress,
            mobile: row.mobile,
          },
        }
      : {}),
  };
}

// Codes are short (TS-48217), so every lookup by code — the claim page, the
// resolver, the claim APIs — counts against the caller's IP. A letter
// recipient scans a handful of times; a guesser hits this fast.
export const CLAIM_LOOKUPS_PER_WINDOW = 30;
export const CLAIM_LOOKUP_WINDOW_MINUTES = 10;

/** Records one lookup and says whether this IP is over the limit (then refuse). */
export async function claimLookupLimited(ipHashed: string): Promise<boolean> {
  const recent = await recentAttempts("claim_lookup", ipHashed, CLAIM_LOOKUP_WINDOW_MINUTES);
  if (recent >= CLAIM_LOOKUPS_PER_WINDOW) return true;
  await track("claim_lookup", { type: "SYSTEM" }, { ip: ipHashed });
  return false;
}

export function requestIp(h: { get(name: string): string | null }): string {
  return ipHash(h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown");
}

// ---------- 30 Oct update §1: the claim page, tradesura.com/c/CODE ----------

export type ClaimAddress = { line1: string; town: string; postcode: string };

/** Stored the same way as Engineer.packAddress: "line1\ntown\npostcode". */
export function addressText(a: ClaimAddress): string {
  return [a.line1.trim(), a.town.trim(), a.postcode.trim().toUpperCase()].join("\n");
}

export function parseAddressText(s: string | null | undefined): ClaimAddress | null {
  if (!s) return null;
  const [line1 = "", town = "", postcode = ""] = s.split("\n");
  return line1 && town && postcode ? { line1, town, postcode } : null;
}

const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export function addressError(a: Partial<ClaimAddress> | null | undefined, what: string): string | null {
  if (!a?.line1?.trim()) return `Enter the first line of your ${what}.`;
  if (!a.town?.trim()) return `Enter the town for your ${what}.`;
  if (!a.postcode?.trim() || !UK_POSTCODE.test(a.postcode.trim())) return `Enter a UK postcode for your ${what}.`;
  if (a.line1.length > 160 || a.town.length > 80) return `Check your ${what}.`;
  return null;
}

/** The steps the claim page logs per code (§1.9). */
export const CLAIM_STEPS = [
  "scan",
  "ticks_seen",
  "form_completed",
  "code_texted",
  "code_copied",
  "store_opened",
  "store_fallback_tapped",
  "desktop_shown",
  "app_link_opened",
] as const;
export type ClaimStep = (typeof CLAIM_STEPS)[number];

/** The code row a claim page may show and act on: real, and not yet used for an account. */
export async function claimForPage(input: string) {
  const code = normaliseClaimCode(input);
  const row = await prisma.claimCode.findUnique({ where: { code } });
  return row;
}

/** The personal link in the text: opens the app with the code (and its token) once installed. */
export function claimAppLink(base: string, code: string, token: string): string {
  return `${base}/c/${encodeURIComponent(code)}/app?t=${encodeURIComponent(token)}`;
}

export function claimText(code: string, link: string): string {
  return `TradeSura: your claim code is ${code}. Tap here once the app's installed: ${link}`;
}

/** Store links by platform. The custom product page / listing URLs come from env once approved (§2). */
export function storeUrl(platform: "ios" | "android", code: string): string {
  if (platform === "ios") return process.env.APP_STORE_CLAIM_URL?.trim() || "https://apps.apple.com/gb/app/tradesura";
  // Android's install referrer carries the code through the install (§3.1).
  const base =
    process.env.PLAY_STORE_CLAIM_URL?.trim() || "https://play.google.com/store/apps/details?id=com.tradesura.engineer";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}referrer=${encodeURIComponent(`claim=${code}`)}`;
}

export function platformOf(userAgent: string | null | undefined): "ios" | "android" | "desktop" {
  const ua = userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

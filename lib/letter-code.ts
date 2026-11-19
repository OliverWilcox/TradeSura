import { appUrl } from "@/lib/app-url";

export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SUFFIX_LENGTH = 4;
const SHAPE = new RegExp(`^([A-Z]{1,10})([${CODE_ALPHABET}]{${SUFFIX_LENGTH}})$`);

function randomChar(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  const byte = new Uint8Array(1);
  do crypto.getRandomValues(byte);
  while (byte[0]! >= limit);
  return CODE_ALPHABET[byte[0]! % CODE_ALPHABET.length]!;
}

export function letterCodeSuffix(): string {
  for (;;) {
    const s = Array.from({ length: SUFFIX_LENGTH }, randomChar).join("");
    if (/\d/.test(s)) return s;
  }
}

export function letterCodeOf(cleaned: string): string | null {
  const m = cleaned.match(SHAPE);
  return m && /\d/.test(m[2]!) ? `${m[1]}-${m[2]}` : null;
}

export function claimLink(code: string): string {
  return `${appUrl()}/c/${code}`;
}

const LIVE_BASES = new Set(["https://tradesura.com", "https://www.tradesura.com"]);

export function printedLinkProblem(base = appUrl()): string | null {
  if (LIVE_BASES.has(base)) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return `The claim links' address, ${base}, isn't a web address.`;
  }
  if (url.protocol !== "https:") return `The claim links would start ${url.origin}, which isn't https.`;
  return `The claim links would start ${base}/c/, which isn't the live site, https://tradesura.com.`;
}

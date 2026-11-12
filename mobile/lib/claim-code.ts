// A letter's claim code in what someone typed or pasted (the letter, the text
// we sent, or its link). Two shapes: SMITH-7K3Q from uploaded batches (Matt,
// 4 Nov: the name, then four characters without 0, O, 1, I or L, one at least
// a digit) and TS-48217 from before. The server's twin is lib/letter-code.ts
// with lib/claim.ts; tests/claim.test.ts keeps the two in step. No React
// Native imports here, so that test can load it.

const SUFFIX = "[2-9A-HJKMNP-Z]{4}";
const LEGACY = /\bTS[\s-]?(\d{4,8})\b/;
/** Typed on its own: the dash or space is optional (smith7k3q). */
const TYPED = new RegExp(`^([A-Z]{1,10})[\\s-]?(${SUFFIX})$`);
/** Inside longer text or a link: only with its dash, so ordinary words aren't taken for one. */
const IN_TEXT = new RegExp(`\\b([A-Z]{1,10})-(${SUFFIX})\\b`);

const withDigit = (m: RegExpMatchArray | null) => (m && /\d/.test(m[2]!) ? `${m[1]}-${m[2]}` : null);

/** "SMITH-7K3Q", "smith 7k3q", "TS-48217", or a text or link holding one → the code as printed; null when there's none. */
export function findClaimCode(text: string | null | undefined): string | null {
  const t = (text ?? "").toUpperCase().trim();
  const legacy = t.match(LEGACY);
  if (legacy) return `TS-${legacy[1]}`;
  return withDigit(t.match(TYPED)) ?? withDigit(t.match(IN_TEXT));
}

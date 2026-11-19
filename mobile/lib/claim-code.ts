const SUFFIX = "[2-9A-HJKMNP-Z]{4}";
const LEGACY = /\bTS[\s-]?(\d{4,8})\b/;
const TYPED = new RegExp(`^([A-Z]{1,10})[\\s-]?(${SUFFIX})$`);
const IN_TEXT = new RegExp(`\\b([A-Z]{1,10})-(${SUFFIX})\\b`);

const withDigit = (m: RegExpMatchArray | null) => (m && /\d/.test(m[2]!) ? `${m[1]}-${m[2]}` : null);

export function findClaimCode(text: string | null | undefined): string | null {
  const t = (text ?? "").toUpperCase().trim();
  const legacy = t.match(LEGACY);
  if (legacy) return `TS-${legacy[1]}`;
  return withDigit(t.match(TYPED)) ?? withDigit(t.match(IN_TEXT));
}

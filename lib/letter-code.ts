import { appUrl } from "@/lib/app-url";

// Matt, 4 Nov: a letter's code can't be guessed from another one (SMITH-7K3Q,
// where TS-48217 was a number in a run): the surname or business name, then
// four characters drawn at random. No 0, O, 1, I or L, so it reads back over
// the phone; at least one digit, so a hyphenated word in pasted text isn't
// taken for a code. mobile/lib/claim-code.ts finds the same shapes in what's
// typed or pasted (tests/claim.test.ts keeps the two in step).

export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SUFFIX_LENGTH = 4;
const SHAPE = new RegExp(`^([A-Z]{1,10})([${CODE_ALPHABET}]{${SUFFIX_LENGTH}})$`);

/** One character of the alphabet, evenly: bytes past the last whole run of it are drawn again. */
function randomChar(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  const byte = new Uint8Array(1);
  do crypto.getRandomValues(byte);
  while (byte[0]! >= limit);
  return CODE_ALPHABET[byte[0]! % CODE_ALPHABET.length]!;
}

/** Four random characters, at least one a digit: 7K3Q. */
export function letterCodeSuffix(): string {
  for (;;) {
    const s = Array.from({ length: SUFFIX_LENGTH }, randomChar).join("");
    if (/\d/.test(s)) return s;
  }
}

/** A cleaned code (upper case, letters and digits only) in the letter shape, with its dash: SMITH7K3Q → SMITH-7K3Q. */
export function letterCodeOf(cleaned: string): string | null {
  const m = cleaned.match(SHAPE);
  return m && /\d/.test(m[2]!) ? `${m[1]}-${m[2]}` : null;
}

/** The link the letter's QR code opens: the claim page. */
export function claimLink(code: string): string {
  return `${appUrl()}/c/${code}`;
}

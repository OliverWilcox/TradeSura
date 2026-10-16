// Server-side twin of mobile/lib/validate.ts (29 Sept review, systemic
// defect 1) — the app validates for instant feedback, this is the check
// that actually guards the data.

export const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/;
// 8 digits, or one of the build notes' prefixes + 6 digits (30 Sept, step 3).
export const COMPANY_NUMBER = /^(\d{8}|(SC|NI|OC|SO|NC)\d{6})$/;
// 1–7 digits: older registrations can be as short as 2, so no fixed length.
// The exact number is confirmed in the manual check against the ID photo.
export const GAS_SAFE_NO = /^\d{1,7}$/;

// 6 or 7 digits get their leading zeros back (1234567 → 01234567).
export function normaliseCompanyNumber(v: string): string {
  const n = v.replace(/\s/g, "").toUpperCase();
  return /^\d{6,7}$/.test(n) ? n.padStart(8, "0") : n;
}

export function normalisePostcode(v: string): string {
  const p = v.replace(/\s/g, "").toUpperCase();
  return p.length > 3 ? `${p.slice(0, -3)} ${p.slice(-3)}` : p;
}

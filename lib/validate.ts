// Server-side twin of mobile/lib/validate.ts (29 Sept review, systemic
// defect 1) — the app validates for instant feedback, this is the check
// that actually guards the data.

export const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/;
export const COMPANY_NUMBER = /^(\d{8}|[A-Z]{2}\d{6})$/;
export const GAS_SAFE_NO = /^\d{6,7}$/;

export function normaliseCompanyNumber(v: string): string {
  return v.replace(/\s/g, "").toUpperCase();
}

export function normalisePostcode(v: string): string {
  const p = v.replace(/\s/g, "").toUpperCase();
  return p.length > 3 ? `${p.slice(0, -3)} ${p.slice(-3)}` : p;
}

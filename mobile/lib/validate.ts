// Signup validation (29 Sept review, systemic defect 1). Each returns the
// plain-English message to show under the field, or null when it's fine.
// Hand-duplicated from ../../lib/validate.ts for instant feedback — the
// server re-checks every one, so drift shows up as a server error, never as
// bad data (same trade as the display constants in tier/[tierId].tsx).

export function normaliseUkMobile(v: string): string | null {
  const digits = v.replace(/[\s()-]/g, "");
  const m = digits.match(/^(?:\+44|0044|44|0)(7\d{9})$/);
  return m ? `+44${m[1]}` : null;
}

export function checkRequired(v: string, what: string): string | null {
  return v.trim() ? null : `Enter your ${what}.`;
}

export function checkUkMobile(v: string): string | null {
  if (!v.trim()) return "Enter your mobile number.";
  return normaliseUkMobile(v) ? null : "Enter a UK mobile number, like 07123 456789.";
}

export function checkEmail(v: string): string | null {
  if (!v.trim()) return "Enter your email address.";
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
    ? null
    : "That email doesn't look right — check for typos.";
}

export function checkGasSafeNo(v: string): string | null {
  const d = v.replace(/\s/g, "");
  if (!d) return "Enter your Gas Safe registration number.";
  return /^\d{6,7}$/.test(d) ? null : "Gas Safe numbers are 6 or 7 digits.";
}

export function normaliseCompanyNumber(v: string): string {
  return v.replace(/\s/g, "").toUpperCase();
}

export function checkCompanyNumber(v: string): string | null {
  const n = normaliseCompanyNumber(v);
  if (!n) return "Enter your company number — it's required for a limited company.";
  return /^(\d{8}|[A-Z]{2}\d{6})$/.test(n)
    ? null
    : "Company numbers are 8 characters, like 12345678 or SC123456.";
}

export function checkUkPostcode(v: string): string | null {
  const p = v.trim().toUpperCase();
  if (!p) return "Enter your business postcode.";
  return /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/.test(p)
    ? null
    : "Enter a full UK postcode, like HD9 2TT.";
}

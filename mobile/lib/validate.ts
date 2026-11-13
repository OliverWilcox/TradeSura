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

// The engineer's own licence number: 7 digits on the front of the Gas Safe
// ID card (Matt, 4 Nov). The business registration number is asked for
// separately, below.
export function checkGasSafeNo(v: string): string | null {
  const d = v.replace(/\s/g, "");
  if (!d) return "Enter your licence number.";
  if (/\D/.test(d)) return "Use digits only — no letters.";
  return d.length === 7 ? null : "Your licence number is 7 digits.";
}

// The business's Gas Safe registration number, from the same card.
export function checkRegistrationNo(v: string): string | null {
  const d = v.replace(/\s/g, "");
  if (!d) return "Enter your business registration number.";
  if (/\D/.test(d)) return "Use digits only — no letters.";
  return d.length >= 4 && d.length <= 7 ? null : "Check the business registration number on your card.";
}

// 6 or 7 digits get their leading zeros back (1234567 → 01234567).
export function normaliseCompanyNumber(v: string): string {
  const n = v.replace(/\s/g, "").toUpperCase();
  return /^\d{6,7}$/.test(n) ? n.padStart(8, "0") : n;
}

export function checkCompanyNumber(v: string): string | null {
  const n = normaliseCompanyNumber(v);
  if (!n) return "Enter your company number — it's required for a limited company.";
  return /^(\d{8}|(SC|NI|OC|SO|NC)\d{6})$/.test(n)
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

/**
 * The expiry on a Gas Safe ID card as the API takes it (YYYY-MM-DD), from
 * "31/03/2027" or, for a card showing only month and year, "03/2027" (the
 * end of that month). An error when it's not a date, has passed, or is
 * more than 5 years away (lib/gas-safe-card.ts cardExpiry).
 */
export function cardExpiryOf(v: string): { iso: string } | { error: string } {
  const s = v.trim();
  const full = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const month = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (!full && !month) return { error: "Enter the expiry date on your card, like 31/03/2027." };
  const y = Number(full ? full[3] : month![2]);
  const m = Number(full ? full[2] : month![1]);
  const d = full ? Number(full[1]) : new Date(Date.UTC(y, m, 0)).getUTCDate();
  const date = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || m > 12 || date.getUTCDate() !== d) return { error: "That isn't a real date — check the card." };
  const today = new Date().toISOString().slice(0, 10);
  const iso = date.toISOString().slice(0, 10);
  if (iso < today) return { error: "That date has passed. Add a photo of your current card." };
  if (y > new Date().getUTCFullYear() + 5) return { error: "Check the year — cards last up to 5 years." };
  return { iso };
}

import { normaliseUkPhone } from "@/lib/phone";

// Contact details as the admin API shows them until someone reveals them.
// Email uses the same mask as sign-in ("d•••@example.com").
export { maskEmail } from "@/lib/sign-in-code";

/** "+447700900123" → "•••• 123". */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 3 ? `•••• ${digits.slice(-3)}` : "••••";
}

/**
 * Search terms for contact details, matched whole only. Searching by fragments
 * would let anyone who can list people rebuild a masked number or address a
 * few characters at a time, without the recorded reveal.
 */
export function exactContactSearch(q: string): { email: string | null; phone: string | null } {
  const term = q.trim();
  return { email: term.includes("@") ? term : null, phone: normaliseUkPhone(term) };
}

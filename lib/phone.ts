// UK mobile/landline normalisation to E.164. Returns null when it can't be a
// UK number — callers treat that as a validation error.
export function normaliseUkPhone(input: string): string | null {
  const cleaned = input.replace(/[\s\-().]/g, "");
  if (!/^\+?\d{10,13}$/.test(cleaned)) return null;
  if (cleaned.startsWith("+44")) return cleaned.length === 13 ? cleaned : null;
  if (cleaned.startsWith("44")) return cleaned.length === 12 ? `+${cleaned}` : null;
  if (cleaned.startsWith("0")) return cleaned.length === 11 ? `+44${cleaned.slice(1)}` : null;
  return null;
}

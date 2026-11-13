// Gas Safe numbers are digits; users type them with spaces.
// Returns digits-only form, or null if the input can't be a Gas Safe number.
// Matt, 4 Nov: numbers are never checked against a stored copy of the
// register; the checker looks them up on the live Gas Safe Register.
export function normaliseRegNo(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /[a-z]/i.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 4 || digits.length > 8) return null;
  return digits;
}

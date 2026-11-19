import { GAS_SAFE_REGISTRATION_NO } from "@/lib/validate";

export function normaliseRegNo(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /[a-z]/i.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (!GAS_SAFE_REGISTRATION_NO.test(digits)) return null;
  return digits;
}

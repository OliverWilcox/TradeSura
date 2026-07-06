// CLAUDE.md §Compliance 4 — gas-emergency interlock. Runs on every free-text
// customer input. Over-triggering is acceptable; missing a real emergency is not.

const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bgas\s+leak\w*\b/i, label: "gas leak" },
  { re: /\bleak\w*\s+gas\b/i, label: "leaking gas" },
  { re: /\bcarbon\s+monoxide\b/i, label: "carbon monoxide" },
  { re: /\bco\s+(alarm|detector|monitor)\b/i, label: "CO alarm" },
  { re: /\bfumes?\b/i, label: "fumes" },
];

export type InterlockResult = { emergency: false } | { emergency: true; matched: string };

export function checkEmergency(text: string): InterlockResult {
  for (const p of PATTERNS) {
    if (p.re.test(text)) return { emergency: true, matched: p.label };
  }
  // Compound checks: either word alone is common ("gas boiler", "smells odd"),
  // together they are an emergency signal.
  if (/\bsmell\w*\b/i.test(text) && /\bgas\b/i.test(text)) {
    return { emergency: true, matched: "smell of gas" };
  }
  if (/\bdizz(y|iness)\b/i.test(text) && /\bboiler\b/i.test(text)) {
    return { emergency: true, matched: "dizziness near boiler" };
  }
  return { emergency: false };
}

export const EMERGENCY_LINE = "0800 111 999";

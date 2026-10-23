// Retention §9 welcome touch — the homeowner sets up their Home Passport
// (boiler photo and details). Pure rules, no database, so
// tests/passport-setup.test.ts can pin "never overwrite the engineer".

export const MAX_BOILER_PHOTOS = 4;
export const MAX_SETUP_UPLOAD = 2;

type Boiler = { make: string | null; model: string | null; installedAt: Date | null; photoUrls: string[] };

export function passportNeedsSetup(boiler: Boiler | null): boolean {
  return !boiler || boiler.photoUrls.length === 0 || !boiler.make?.trim() || !boiler.model?.trim();
}

/** Month is 1–12 or null ("not sure"), so a year alone means January of it. */
export function fittedDate(year: number | null, month: number | null, now = new Date()): Date | null {
  if (!year || !Number.isInteger(year) || year < 1950 || year > now.getFullYear()) return null;
  const m = month && month >= 1 && month <= 12 ? month : 1;
  const d = new Date(Date.UTC(year, m - 1, 1));
  return d > now ? null : d;
}

/**
 * Only fills blanks: anything an engineer already entered stays. Photos are
 * appended, never replacing, up to MAX_BOILER_PHOTOS in all.
 */
export function homeownerBoilerPatch(
  existing: Boiler,
  input: { make?: string | null; model?: string | null; installedAt?: Date | null; photoUrls?: string[] },
): { data: Partial<Boiler>; filled: string[] } {
  const data: Partial<Boiler> = {};
  const filled: string[] = [];
  const make = input.make?.trim().slice(0, 60);
  const model = input.model?.trim().slice(0, 60);
  if (make && !existing.make?.trim()) {
    data.make = make;
    filled.push("make");
  }
  if (model && !existing.model?.trim()) {
    data.model = model;
    filled.push("model");
  }
  if (input.installedAt && !existing.installedAt) {
    data.installedAt = input.installedAt;
    filled.push("installedAt");
  }
  const room = Math.max(0, MAX_BOILER_PHOTOS - existing.photoUrls.length);
  const added = (input.photoUrls ?? []).filter((u) => !existing.photoUrls.includes(u)).slice(0, room);
  if (added.length) {
    data.photoUrls = [...existing.photoUrls, ...added];
    filled.push("photos");
  }
  return { data, filled };
}

import { z } from "zod";

// Body fields several admin routes share.

/** Why a change was made. Required for anything that affects an engineer or customer. */
export const reason = z.string({ error: "Say why." }).trim().min(3, "Say why.").max(500, "Keep it under 500 characters.");

export const optionalReason = z.string().trim().max(500, "Keep it under 500 characters.").optional();

export const ReasonBody = z.strictObject({ reason });

export const NoteBody = z.strictObject({
  body: z.string({ error: "Write the note." }).trim().min(1, "Write the note.").max(2000, "Keep notes under 2,000 characters."),
});

/** A calendar date in a query string (YYYY-MM-DD), as the start of that day in UTC. Years 2000–2099 only. */
export const isoDay = z.iso
  .date()
  .refine((d) => d >= "2000-01-01" && d < "2100-01-01", "Choose a date between 2000 and 2100.")
  .transform((d) => new Date(`${d}T00:00:00Z`));

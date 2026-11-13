import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { LetterRow, MAX_LETTERS_PER_BATCH, listLetterBatches, uploadLetterBatch } from "@/lib/admin/letters";

const Body = z.strictObject({
  /** Printed on every letter: the day their Founding place is held until (YYYY-MM-DD). */
  reservedUntil: z.iso.date({ error: "Use a date like 2026-12-31." }),
  rows: z.array(LetterRow).min(1, "The batch has no letters.").max(MAX_LETTERS_PER_BATCH, `Upload up to ${MAX_LETTERS_PER_BATCH} letters at a time.`),
});

// Letter batches (Matt, 4 Nov), newest first, with each one's codes claimed and signed up.
export const GET = adminRoute("letters:read", async () => listLetterBatches());

// Upload a batch: each row becomes a reserved code at once (SMITH-7K3Q), named
// for this month (2026-11-A). A whole batch is up to about 2 MB of JSON.
export const POST = adminRoute("letters:write", async ({ req, admin }) => uploadLetterBatch(admin, await parseBody(req, Body, { maxBytes: 2 * 1024 * 1024 })));

import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { BATCH_NAME, LetterRow, MAX_LETTERS_PER_BATCH, listLetterBatches, uploadLetterBatch } from "@/lib/admin/letters";

const Body = z.strictObject({
  name: z.string().trim().regex(BATCH_NAME, "Name the batch with letters, numbers, spaces or hyphens, up to 40 characters."),
  area: z.string().trim().min(1, "Say which area the letters went to.").max(80),
  postedOn: z.iso.date({ error: "Give the date posted as a date (year-month-day)." }),
  count: z.number().int().min(1).max(MAX_LETTERS_PER_BATCH),
  reservedUntil: z.iso.date({ error: "Give the reservation date as a date (year-month-day)." }),
  rows: z.array(LetterRow).min(1, "The batch has no letters.").max(MAX_LETTERS_PER_BATCH, `Upload up to ${MAX_LETTERS_PER_BATCH} letters at a time.`),
});

export const GET = adminRoute("letters:read", async () => listLetterBatches());

export const POST = adminRoute("letters:write", async ({ req, admin }) => uploadLetterBatch(admin, await parseBody(req, Body, { maxBytes: 2 * 1024 * 1024 })));

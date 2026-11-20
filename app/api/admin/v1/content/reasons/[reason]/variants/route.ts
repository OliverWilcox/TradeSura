import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { addVariant, setSplit } from "@/lib/admin/content";

export const POST = adminRoute<{ reason: string }>("content:write", async ({ admin, params }) => addVariant(admin, params.reason));

const Split = z.strictObject({
  weights: z
    .array(z.strictObject({ variant: z.string().trim().min(1).max(2), weight: z.number().int("Use whole numbers.").min(0).max(100) }))
    .min(1)
    .max(26),
});

export const PUT = adminRoute<{ reason: string }>("content:write", async ({ req, admin, params }) => setSplit(admin, params.reason, (await parseBody(req, Split)).weights));

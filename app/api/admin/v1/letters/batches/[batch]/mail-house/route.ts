import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { mailHouseFile } from "@/lib/admin/letters";

const Query = z.strictObject({ second: z.enum(["1", "true"]).optional() });

export const GET = adminRoute<{ batch: string }>("letters:export", async ({ req, params }) => mailHouseFile(params.batch, { second: Boolean(parseQuery(req, Query).second) }));

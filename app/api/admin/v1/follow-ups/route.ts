import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { pageParams } from "@/lib/admin-api/pagination";
import { followUpLists } from "@/lib/admin/follow-ups";

const Query = z.strictObject({
  tab: z.enum(["calls", "stripe", "letters"]).default("calls"),
  q: z.string().trim().max(100).optional(),
  ...pageParams,
});

export const GET = adminRoute("engineers:read", async ({ req, admin }) => followUpLists(parseQuery(req, Query), { letters: admin.permissions.includes("letters:read") }));

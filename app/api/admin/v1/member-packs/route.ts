import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { pageParams } from "@/lib/admin-api/pagination";
import { listMemberPacks } from "@/lib/admin/member-packs";

const Query = z.strictObject({
  tab: z.enum(["to_post", "held", "posted"]).default("to_post"),
  q: z.string().trim().max(100).optional(),
  ...pageParams,
});

// Founding-member packs: ready to post (badge live), held (not verified yet, or
// paused or banned), or posted. Includes each engineer's postal address.
// q searches name, business and address.
export const GET = adminRoute("member_packs:read", async ({ req }) => listMemberPacks(parseQuery(req, Query)));

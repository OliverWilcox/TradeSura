import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { reason } from "@/lib/admin-api/schemas";
import { giveSpot } from "@/lib/admin/towns";

const Body = z.strictObject({ engineerId: z.string().trim().min(1).max(40), reason });

// The manual override (Matt, 4 Nov): give a free top spot to an engineer in
// the town, out of turn. Needs a reason; recorded like the app's own awards.
export const POST = adminRoute<{ slug: string }>("towns:write", async ({ req, admin, params }) => giveSpot(admin, params.slug, await parseBody(req, Body)));

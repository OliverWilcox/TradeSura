import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { reason } from "@/lib/admin-api/schemas";
import { releaseSpot } from "@/lib/admin/towns";

const Body = z.strictObject({ reason, to: z.string().trim().min(1).max(40).nullable() });

// The manual override (Matt, 4 Nov): release a top spot before its 60 days
// are up. It passes to the next in line, or to the engineer named in `to`.
export const POST = adminRoute<{ slug: string; spotId: string }>("towns:write", async ({ req, admin, params }) =>
  releaseSpot(admin, params.slug, params.spotId, await parseBody(req, Body)),
);

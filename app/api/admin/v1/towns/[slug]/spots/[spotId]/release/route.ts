import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { reason } from "@/lib/admin-api/schemas";
import { releaseSpot } from "@/lib/admin/towns";

const Body = z.strictObject({ reason, to: z.string().trim().min(1).max(40).nullable() });

export const POST = adminRoute<{ slug: string; spotId: string }>("towns:write", async ({ req, admin, params }) =>
  releaseSpot(admin, params.slug, params.spotId, await parseBody(req, Body)),
);

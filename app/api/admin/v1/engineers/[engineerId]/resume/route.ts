import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { optionalReason } from "@/lib/admin-api/schemas";
import { resumeEngineer } from "@/lib/admin/engineers";

const Body = z.strictObject({ reason: optionalReason });

// Lift a pause.
export const POST = adminRoute<{ engineerId: string }>("engineers:status", async ({ req, admin, params }) => {
  const { reason } = await parseBody(req, Body);
  return resumeEngineer(admin, params.engineerId, reason ?? null);
});

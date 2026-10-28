import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { optionalReason } from "@/lib/admin-api/schemas";
import { setWidget } from "@/lib/admin/engineers";

const Body = z.strictObject({ disabled: z.boolean({ error: "Say whether to switch it off." }), reason: optionalReason });

// Switch the engineer's website widget off or back on.
export const POST = adminRoute<{ engineerId: string }>("engineers:status", async ({ req, admin, params }) => {
  const { disabled, reason } = await parseBody(req, Body);
  return setWidget(admin, params.engineerId, disabled, reason ?? null);
});

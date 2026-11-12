import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { requestRecheck } from "@/lib/admin/verifications";

const Body = z.strictObject({
  reason: z.string({ error: "Say why it needs a re-check." }).trim().min(3, "Say why it needs a re-check.").max(500, "Keep the reason under 500 characters."),
});

// Put a live engineer back in the queue for a register re-check, such as
// after a homeowner's safety complaint. 409 if their register check hasn't passed yet.
export const POST = adminRoute<{ engineerId: string }>("verification:decide", async ({ req, admin, params }) =>
  requestRecheck(admin, params.engineerId, await parseBody(req, Body)),
);

import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { suspendEngineer } from "@/lib/admin/verifications";

const Body = z.strictObject({
  reason: z.string({ error: "Say why they're suspended." }).trim().min(3, "Say why they're suspended.").max(500, "Keep the reason under 500 characters."),
  tellCustomers: z.boolean().default(false),
  revision: z.string().regex(/^[0-9a-f]{16}$/, "Reload the case and try again.").optional(),
});

export const POST = adminRoute<{ engineerId: string }>("verification:decide", async ({ req, admin, params }) =>
  suspendEngineer(admin, params.engineerId, await parseBody(req, Body)),
);

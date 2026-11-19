import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { passRegisterCheck } from "@/lib/admin/verifications";

const Body = z.strictObject({
  note: z.string({ error: "Say what the register showed." }).trim().min(2, "Say what the register showed.").max(500, "Keep the note under 500 characters."),
  revision: z.string().regex(/^[0-9a-f]{16}$/, "Reload the case and try again.").optional(),
});

export const POST = adminRoute<{ engineerId: string }>("verification:decide", async ({ req, admin, params }) =>
  passRegisterCheck(admin, params.engineerId, await parseBody(req, Body)),
);

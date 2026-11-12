import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { passRegisterCheck } from "@/lib/admin/verifications";

const Body = z.strictObject({
  /** What the live Gas Safe Register showed: that it matches, or what's different. */
  note: z.string({ error: "Say what the register showed." }).trim().min(2, "Say what the register showed.").max(500, "Keep the note under 500 characters."),
  revision: z.string().regex(/^[0-9a-f]{16}$/, "Reload the case and try again.").optional(),
});

// Register check passed: for a live engineer whose register check (or yearly
// re-check) is due. 409 if it isn't due, another admin holds the case, or it
// changed since it was opened.
export const POST = adminRoute<{ engineerId: string }>("verification:decide", async ({ req, admin, params }) =>
  passRegisterCheck(admin, params.engineerId, await parseBody(req, Body)),
);

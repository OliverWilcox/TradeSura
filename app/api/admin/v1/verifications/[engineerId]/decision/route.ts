import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { decideVerification } from "@/lib/admin/verifications";

/** The application's `revision` from GET /verifications/{id}; if it has changed since, the decision is refused (409). */
const revision = z.string().regex(/^[0-9a-f]{16}$/, "Reload the application and try again.").optional();

const Body = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("approve"), reason: z.string().trim().max(500, "Keep the note under 500 characters.").optional(), revision }),
  z.strictObject({
    decision: z.literal("reject"),
    reason: z.string({ error: "Say why it was rejected." }).trim().min(3, "Say why it was rejected.").max(500, "Keep the reason under 500 characters."),
    /** The checker's own words, kept with the reason (each up to 500 characters). */
    note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
    /** The existing account this application duplicates, when that's why it's rejected. */
    duplicateOf: z.string().trim().min(1).max(40).optional(),
    revision,
  }),
]);

// Approve or reject a waiting application. The engineer is told by push,
// text and email once the answer has gone back. Deciding one that's already
// decided, that another admin is checking, or that changed since it was
// opened, is a 409.
export const POST = adminRoute<{ engineerId: string }>("verification:decide", async ({ req, admin, params }) =>
  decideVerification(admin, params.engineerId, await parseBody(req, Body)),
);

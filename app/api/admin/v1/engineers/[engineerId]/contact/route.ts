import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { revealEngineerContact } from "@/lib/admin/engineers";

const Query = z.strictObject({
  /** One of this engineer's staff, whose details to reveal instead. */
  staffId: z.string().trim().min(1).max(40).optional(),
  /** Just this one; both when left out. */
  field: z.enum(["email", "phone"]).optional(),
});

// The engineer's (or a staff member's) full email and phone number. Recorded every time.
export const POST = adminRoute<{ engineerId: string }>("pii:reveal", async ({ req, admin, params }) =>
  revealEngineerContact(admin, params.engineerId, parseQuery(req, Query)),
);

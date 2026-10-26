import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { revealCustomerContact } from "@/lib/admin/customers";

/** Just this one; both when left out. */
const Query = z.strictObject({ field: z.enum(["email", "phone"]).optional() });

// The customer's full phone number and email. Recorded every time.
export const POST = adminRoute<{ customerId: string }>("pii:reveal", async ({ req, admin, params }) =>
  revealCustomerContact(admin, params.customerId, parseQuery(req, Query)),
);

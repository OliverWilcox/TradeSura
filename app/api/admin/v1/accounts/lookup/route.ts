import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { lookupAccounts, parseIdentifiers } from "@/lib/admin/accounts";

const Body = z.strictObject({
  identifiers: z
    .array(z.string().trim().min(3, "Enter an email address or phone number.").max(254, "That's too long for an email address."), { error: "Enter an email address or phone number." })
    .min(1, "Enter an email address or phone number.")
    .max(20, "Look up 20 at a time at most."),
});

// Every engineer and customer using these emails or phone numbers, before
// deleting them. A POST so the contact details travel in the body, not the
// URL (which ends up in access logs).
export const POST = adminRoute("data:delete", async ({ req }) => {
  const { identifiers } = await parseBody(req, Body);
  return lookupAccounts(parseIdentifiers(identifiers));
});

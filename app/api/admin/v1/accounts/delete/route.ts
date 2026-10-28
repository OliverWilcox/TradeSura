import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { optionalReason } from "@/lib/admin-api/schemas";
import { deleteAccounts } from "@/lib/admin/accounts";

const Ids = z.array(z.string().trim().min(1).max(40)).max(20, "Delete 20 at a time at most.");

const Body = z
  .strictObject({ engineerIds: Ids.default([]), customerIds: Ids.default([]), reason: optionalReason.transform((r) => r || undefined) })
  .refine((b) => b.engineerIds.length + b.customerIds.length > 0, "Choose at least one account to delete.");

// Deletes engineers (as the app's own "Delete my account" does) and customers,
// each on its own: the answer says what happened to every one.
export const POST = adminRoute("data:delete", async ({ req, admin }) => deleteAccounts(admin, await parseBody(req, Body)));

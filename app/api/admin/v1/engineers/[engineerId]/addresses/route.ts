import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { optionalReason } from "@/lib/admin-api/schemas";
import { AddressInput } from "@/lib/addresses";
import { saveEngineerAddresses } from "@/lib/admin/engineers";

const Body = z.strictObject({ trading: AddressInput, correspondence: z.union([z.literal("same"), AddressInput]), reason: optionalReason });

// Change an engineer's trading address (it sets their town and town page) and
// where their post goes: "same" as trading, or an address of its own.
export const PUT = adminRoute<{ engineerId: string }>("engineers:edit", async ({ req, admin, params }) => {
  const { reason, ...input } = await parseBody(req, Body);
  return saveEngineerAddresses(admin, params.engineerId, input, reason ?? null);
});

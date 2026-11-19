import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { markPacksPrinted } from "@/lib/admin/member-packs";

const Body = z.strictObject({
  engineerIds: z.array(z.string().trim().min(1).max(40)).min(1, "Choose at least one pack.").max(500, "Choose up to 500 at a time."),
  batchRef: z.string().trim().regex(/^MP-\d{8}-\d{4}$/, "Use the print file's batch reference."),
});

export const POST = adminRoute("member_packs:export", async ({ req, admin }) => {
  const { engineerIds, batchRef } = await parseBody(req, Body);
  return markPacksPrinted(admin, [...new Set(engineerIds)], batchRef);
});

import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { logClaimCall } from "@/lib/admin/letters";

const Body = z.strictObject({ note: z.string({ error: "Say what happened." }).trim().min(3, "Say what happened.").max(1000, "Keep it under 1,000 characters.") });

export const POST = adminRoute<{ code: string }>("letters:write", async ({ req, admin, params }) => {
  const { note } = await parseBody(req, Body);
  return logClaimCall(admin, params.code, note);
});

import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { logCall } from "@/lib/admin/follow-ups";

const Body = z.strictObject({ note: z.string({ error: "Say what happened." }).trim().min(3, "Say what happened.").max(1000, "Keep it under 1,000 characters.") });

export const POST = adminRoute<{ engineerId: string }>("engineers:notes", async ({ req, admin, params }) => {
  const { note } = await parseBody(req, Body);
  return logCall(admin, params.engineerId, note);
});

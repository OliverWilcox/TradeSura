import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { LEAD_WINDOW, leadWindowMinutes, setLeadWindow } from "@/lib/admin/towns";

const Body = z.strictObject({
  minutes: z.number({ error: "Enter the minutes." }).int("Use whole minutes.").min(0).max(LEAD_WINDOW.maxMinutes, "Up to 24 hours."),
});

export const GET = adminRoute("towns:read", async () => ({ minutes: await leadWindowMinutes(), ...LEAD_WINDOW }));
export const PUT = adminRoute("towns:write", async ({ req, admin }) => setLeadWindow(admin, (await parseBody(req, Body)).minutes));

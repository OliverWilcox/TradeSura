import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { CONTENT_LIMITS, addReason, listReasons } from "@/lib/admin/content";

export const GET = adminRoute("content:read", async () => ({ items: await listReasons() }));

const Body = z.strictObject({
  label: z.string({ error: "Name the reason." }).trim().min(2, "Name the reason.").max(CONTENT_LIMITS.label, `Keep it under ${CONTENT_LIMITS.label} characters.`),
});

export const POST = adminRoute("content:write", async ({ req, admin }) => addReason(admin, (await parseBody(req, Body)).label));

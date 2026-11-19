import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { setReasonOrder } from "@/lib/admin/content";

const Body = z.strictObject({ reasons: z.array(z.string().trim().min(1).max(40)).min(1).max(50) });

export const PUT = adminRoute("content:write", async ({ req, admin }) => ({ items: await setReasonOrder(admin, (await parseBody(req, Body)).reasons) }));

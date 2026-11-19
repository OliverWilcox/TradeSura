import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { reasonDetail, setReasonActive } from "@/lib/admin/content";

export const GET = adminRoute<{ reason: string }>("content:read", async ({ params }) => reasonDetail(params.reason));

const Body = z.strictObject({ active: z.boolean() });

export const PUT = adminRoute<{ reason: string }>("content:write", async ({ req, admin, params }) => ({
  items: await setReasonActive(admin, params.reason, (await parseBody(req, Body)).active),
}));

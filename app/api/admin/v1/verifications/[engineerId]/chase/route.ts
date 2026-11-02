import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { chaseApplicant } from "@/lib/admin/verifications";

const Body = z.strictObject({ what: z.enum(["photo", "details"]), channel: z.enum(["sms", "email"]) });

// Ask a waiting applicant for a missing card photo, or to check their details.
export const POST = adminRoute<{ engineerId: string }>("verification:decide", async ({ req, admin, params }) => chaseApplicant(admin, params.engineerId, await parseBody(req, Body)));

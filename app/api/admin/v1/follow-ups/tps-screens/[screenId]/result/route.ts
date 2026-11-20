import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { answerTpsScreen, TPS_MAX_NUMBERS } from "@/lib/admin/tps";

const Body = z.strictObject({
  listed: z.enum(["registered", "clear"], { error: "Say whether the file lists the numbers on TPS or CTPS, or the numbers clear to call." }),
  numbers: z.array(z.string().trim().max(40)).max(TPS_MAX_NUMBERS),
});

export const POST = adminRoute<{ screenId: string }>("data:export", async ({ req, admin, params }) => answerTpsScreen(admin, params.screenId, await parseBody(req, Body)));

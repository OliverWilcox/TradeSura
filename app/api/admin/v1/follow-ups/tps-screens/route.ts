import { adminRoute } from "@/lib/admin-api/route";
import { startCallListScreen } from "@/lib/admin/follow-ups";

export const POST = adminRoute("data:export", async ({ admin }) => startCallListScreen(admin));

import { adminRoute } from "@/lib/admin-api/route";
import { readCardAgain } from "@/lib/admin/verifications";

export const maxDuration = 300;

export const POST = adminRoute<{ engineerId: string }>("verification:decide", async ({ admin, params }) => readCardAgain(admin, params.engineerId));

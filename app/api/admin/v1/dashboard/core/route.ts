import { adminRoute } from "@/lib/admin-api/route";
import { core } from "@/lib/admin/dashboard";

// The core number: offers per verified engineer, last complete week, this week
// so far and a 12-week trend.
export const GET = adminRoute("dashboard:read", async () => core(new Date()));

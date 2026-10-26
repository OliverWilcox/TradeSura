import { adminRoute } from "@/lib/admin-api/route";
import { parseRange } from "@/lib/admin-api/range";
import { signups } from "@/lib/admin/dashboard";

// Engineer sign-ups by UK day, and how they heard about TradeSura.
export const GET = adminRoute("dashboard:read", async ({ req }) => signups(parseRange(req)));

import { adminRoute } from "@/lib/admin-api/route";
import { sendWinBack } from "@/lib/admin/customers";

// Text a customer whose plan has ended a link to rejoin. Refused for anyone
// who has opted out of texts.
export const POST = adminRoute<{ customerId: string }>("customers:contact", async ({ admin, params }) => sendWinBack(admin, params.customerId));

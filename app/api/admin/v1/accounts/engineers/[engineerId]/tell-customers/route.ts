import { adminRoute } from "@/lib/admin-api/route";
import { tellCustomers } from "@/lib/admin/accounts";

// Before an engineer with customers on a live plan is deleted: tell each of
// those customers, offering a TradeSura engineer near them (the app's own
// installer-leaves notice, by text and email). Their plans carry on unless
// they choose to move.
export const POST = adminRoute<{ engineerId: string }>("data:delete", async ({ admin, params }) => tellCustomers(admin, params.engineerId));

import { adminRoute, notFound } from "@/lib/admin-api/route";
import { getCustomer } from "@/lib/admin/customers";

// One homeowner: their homes, plans, cancellations and ratings. Phone and
// email come masked; POST …/contact reveals them.
export const GET = adminRoute<{ customerId: string }>("customers:read", async ({ params }) => {
  const customer = await getCustomer(params.customerId);
  if (!customer) throw notFound("There's no customer with that ID.");
  return customer;
});

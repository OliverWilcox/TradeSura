import { adminRoute, notFound } from "@/lib/admin-api/route";
import { fetchCard } from "@/lib/admin/verifications";

// The Gas Safe ID card photo, fetched on the server so its storage URL never
// reaches a browser.
export const GET = adminRoute<{ engineerId: string }>("verification:read", async ({ params }) => {
  const card = await fetchCard(params.engineerId);
  if (!card) throw notFound("There's no ID card photo for this engineer.");
  return card;
});

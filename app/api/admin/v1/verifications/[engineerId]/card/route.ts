import { adminRoute, notFound } from "@/lib/admin-api/route";
import { fetchCard } from "@/lib/admin/verifications";

// The Gas Safe ID card photo, fetched on the server so its storage URL never
// reaches a browser.
export const GET = adminRoute<{ engineerId: string }>("verification:read", async ({ req, params }) => {
  const side = new URL(req.url).searchParams.get("side") === "back" ? "back" : "front";
  const card = await fetchCard(params.engineerId, side);
  if (!card) throw notFound(side === "back" ? "There's no photo of the back of this engineer's card." : "There's no ID card photo for this engineer.");
  return card;
});

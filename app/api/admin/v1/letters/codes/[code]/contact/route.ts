import { AdminApiError, adminRoute } from "@/lib/admin-api/route";
import { revealClaimContact } from "@/lib/admin/letters";

export const POST = adminRoute<{ code: string }>("pii:reveal", async ({ admin, params }) => {
  if (!admin.permissions.includes("letters:read")) throw new AdminApiError(403, "FORBIDDEN", "Letters aren't part of your role.");
  return revealClaimContact(admin, params.code);
});

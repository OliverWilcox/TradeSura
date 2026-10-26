import { adminRoute } from "@/lib/admin-api/route";

// Who the admin API thinks is calling, and what they may do. The admin app
// calls this to check its connection and signing secret.
export const GET = adminRoute(null, async ({ admin }) => ({
  id: admin.id,
  name: admin.name,
  role: admin.role,
  permissions: admin.permissions,
}));

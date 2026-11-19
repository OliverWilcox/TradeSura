import { adminRoute } from "@/lib/admin-api/route";
import { townDetail } from "@/lib/admin/towns";

export const GET = adminRoute<{ slug: string }>("towns:read", async ({ params }) => townDetail(params.slug));

import { adminRoute } from "@/lib/admin-api/route";
import { townDetail } from "@/lib/admin/towns";

// One town: its top spots, those released, who's next in line, and the town
// page's order with what each place rests on.
export const GET = adminRoute<{ slug: string }>("towns:read", async ({ params }) => townDetail(params.slug));

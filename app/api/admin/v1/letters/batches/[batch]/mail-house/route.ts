import { adminRoute } from "@/lib/admin-api/route";
import { mailHouseFile } from "@/lib/admin/letters";

// The mail house's file for one batch: business name, owner first name, town,
// reservation date, code and QR link, with the mailing address. Personal data
// from our list, so it needs letters:export (the admin records who took it).
export const GET = adminRoute<{ batch: string }>("letters:export", async ({ params }) => mailHouseFile(params.batch));

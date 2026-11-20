import { adminRoute } from "@/lib/admin-api/route";
import { sendLetterReminders } from "@/lib/admin/letters";

export const POST = adminRoute<{ batch: string }>("letters:write", async ({ admin, params }) => sendLetterReminders(admin, params.batch));

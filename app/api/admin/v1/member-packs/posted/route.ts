import { z } from "zod";
import { AdminApiError, adminRoute, parseBody } from "@/lib/admin-api/route";
import { markPacksPosted } from "@/lib/admin/member-packs";

const Body = z.strictObject({
  engineerIds: z.array(z.string().trim().min(1).max(40)).min(1, "Choose at least one pack.").max(500, "Choose up to 500 at a time."),
  /** The day they went in the post (YYYY-MM-DD); today when left out. */
  postedOn: z.iso.date({ error: "Use a date like 2026-10-25." }).optional(),
});

// Mark several member packs as posted at once. Those that can't go (not
// verified, paused, banned, already posted) are listed with the reason.
export const POST = adminRoute("member_packs:mark_posted", async ({ req, admin }) => {
  const { engineerIds, postedOn } = await parseBody(req, Body);
  if (postedOn && (postedOn < "2000-01-01" || new Date(`${postedOn}T00:00:00Z`).getTime() > Date.now() + 86_400_000)) {
    throw new AdminApiError(400, "VALIDATION", "The posted date can't be in the future.", { postedOn: ["The posted date can't be in the future."] });
  }
  return markPacksPosted(admin, [...new Set(engineerIds)], postedOn);
});

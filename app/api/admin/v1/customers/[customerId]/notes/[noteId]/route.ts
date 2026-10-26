import { adminRoute } from "@/lib/admin-api/route";
import { deleteNote } from "@/lib/admin/notes";

// Remove a note. It's hidden, not erased: who wrote it and when is kept.
export const DELETE = adminRoute<{ customerId: string; noteId: string }>("customers:notes", async ({ admin, params }) => {
  await deleteNote(admin, "customer", params.customerId, params.noteId);
  return { ok: true };
});

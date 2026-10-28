import { adminRoute } from "@/lib/admin-api/route";
import { deleteNote } from "@/lib/admin/notes";

// Remove a note. It's hidden, not erased: who wrote it and when is kept.
export const DELETE = adminRoute<{ engineerId: string; noteId: string }>("engineers:notes", async ({ admin, params }) => {
  await deleteNote(admin, "engineer", params.engineerId, params.noteId);
  return { ok: true };
});

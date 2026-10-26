import { prisma } from "@/lib/db";
import { adminRoute, notFound, parseBody } from "@/lib/admin-api/route";
import { NoteBody } from "@/lib/admin-api/schemas";
import { addNote, listNotes } from "@/lib/admin/notes";

async function mustExist(id: string) {
  if (!(await prisma.engineer.count({ where: { id, deletedAt: null } }))) throw notFound("There's no engineer with that ID.");
}

// Staff notes about this engineer, newest first.
export const GET = adminRoute<{ engineerId: string }>("engineers:read", async ({ params }) => {
  await mustExist(params.engineerId);
  return { items: await listNotes("engineer", params.engineerId) };
});

export const POST = adminRoute<{ engineerId: string }>("engineers:notes", async ({ req, admin, params }) => {
  const { body } = await parseBody(req, NoteBody);
  await mustExist(params.engineerId);
  return addNote(admin, "engineer", params.engineerId, body);
});

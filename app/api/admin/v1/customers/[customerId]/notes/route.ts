import { adminRoute, notFound, parseBody } from "@/lib/admin-api/route";
import { NoteBody } from "@/lib/admin-api/schemas";
import { customerExists } from "@/lib/admin/customers";
import { addNote, listNotes } from "@/lib/admin/notes";

async function mustExist(id: string) {
  if (!(await customerExists(id))) throw notFound("There's no customer with that ID.");
}

// Staff notes about this customer, newest first.
export const GET = adminRoute<{ customerId: string }>("customers:read", async ({ params }) => {
  await mustExist(params.customerId);
  return { items: await listNotes("customer", params.customerId) };
});

export const POST = adminRoute<{ customerId: string }>("customers:notes", async ({ req, admin, params }) => {
  const { body } = await parseBody(req, NoteBody);
  await mustExist(params.customerId);
  return addNote(admin, "customer", params.customerId, body);
});

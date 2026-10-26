import { prisma } from "@/lib/db";
import { adminEvent } from "@/lib/admin-api/audit";
import { AdminApiError, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";

// Staff notes about an engineer or customer. Newest first; deleting a note
// hides it but keeps who wrote it and when. Only the note's author, or a
// super-admin, can delete it.

export type NoteSubject = "engineer" | "customer";

export async function listNotes(subjectType: NoteSubject, subjectId: string) {
  const notes = await prisma.adminNote.findMany({
    where: { subjectType, subjectId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return notes.map((n) => ({ id: n.id, body: n.body, authorId: n.authorId, authorName: n.authorName, createdAt: n.createdAt.toISOString() }));
}

export async function addNote(admin: AdminPrincipal, subjectType: NoteSubject, subjectId: string, body: string) {
  const note = await prisma.$transaction(async (tx) => {
    const created = await tx.adminNote.create({
      data: { subjectType, subjectId, body, authorId: admin.id, authorName: admin.name },
    });
    // The text stays in the note; the event only says one was added.
    await adminEvent(admin, "admin_note_added", { subjectType, subjectId, noteId: created.id }, tx);
    return created;
  });
  return { id: note.id, body: note.body, authorId: note.authorId, authorName: note.authorName, createdAt: note.createdAt.toISOString() };
}

export async function deleteNote(admin: AdminPrincipal, subjectType: NoteSubject, subjectId: string, noteId: string) {
  await prisma.$transaction(async (tx) => {
    const note = await tx.adminNote.findFirst({ where: { id: noteId, subjectType, subjectId, deletedAt: null }, select: { authorId: true } });
    if (!note) throw notFound("There's no such note.");
    if (note.authorId !== admin.id && admin.role !== "super_admin") {
      throw new AdminApiError(403, "FORBIDDEN", "Only the person who wrote a note, or a super-admin, can delete it.");
    }
    const { count } = await tx.adminNote.updateMany({
      where: { id: noteId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!count) throw notFound("There's no such note.");
    await adminEvent(admin, "admin_note_deleted", { subjectType, subjectId, noteId }, tx);
  });
}

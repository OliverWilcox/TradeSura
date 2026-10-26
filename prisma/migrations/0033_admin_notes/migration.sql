-- Admin API (lib/admin/notes.ts): staff notes about an engineer or customer. New table only.
-- CreateTable
CREATE TABLE "AdminNote" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminNote_subjectType_subjectId_createdAt_idx" ON "AdminNote"("subjectType", "subjectId", "createdAt");


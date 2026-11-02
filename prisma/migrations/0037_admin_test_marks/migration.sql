-- Admin API: engineers and customers marked as test data. New table only.
-- CreateTable
CREATE TABLE "AdminTestMark" (
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminTestMark_pkey" PRIMARY KEY ("subjectType","subjectId")
);

-- AlterTable
ALTER TABLE "Engineer" ADD COLUMN     "gasSafeCardBackUrl" TEXT;

-- CreateTable
CREATE TABLE "GasSafeCardRead" (
    "id" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "cardUrl" TEXT NOT NULL,
    "backUrl" TEXT,
    "source" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "isGasSafeCard" BOOLEAN,
    "licenceNo" TEXT,
    "registrationNo" TEXT,
    "name" TEXT,
    "company" TEXT,
    "expiresOn" DATE,
    "categories" TEXT[],
    "notes" TEXT[],
    "model" TEXT,
    "readById" TEXT,
    "readByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GasSafeCardRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LetterBatch" (
    "name" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "postedOn" DATE NOT NULL,
    "letters" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LetterBatch_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "GasSafeCardRead_engineerId_createdAt_idx" ON "GasSafeCardRead"("engineerId", "createdAt");

-- AddForeignKey
ALTER TABLE "GasSafeCardRead" ADD CONSTRAINT "GasSafeCardRead_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "Engineer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


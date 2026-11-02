-- Engineer record (client feedback, 31 Oct): trading addresses in a new table;
-- two nullable columns on Engineer (setup-text consent, card expiry). Additive only.

-- AlterTable
ALTER TABLE "Engineer" ADD COLUMN     "gasSafeCardExpiresOn" DATE,
ADD COLUMN     "setupTextConsentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EngineerTradingAddress" (
    "engineerId" TEXT NOT NULL,
    "lines" TEXT[],
    "town" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngineerTradingAddress_pkey" PRIMARY KEY ("engineerId")
);


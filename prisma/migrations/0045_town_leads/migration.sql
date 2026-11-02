-- 30 Oct update §10: homeowner requests from a town page, Founding Members first.
CREATE TABLE "TownLead" (
    "id" TEXT NOT NULL,
    "townSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "postcode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "emergency" TEXT,
    "foundingUntil" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TownLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TownLead_townSlug_claimedAt_idx" ON "TownLead"("townSlug", "claimedAt");
CREATE INDEX "TownLead_claimedById_idx" ON "TownLead"("claimedById");

ALTER TABLE "TownLead" ADD CONSTRAINT "TownLead_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "Engineer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

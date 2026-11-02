-- 30 Oct update §5: what the installer normally charges (blank until they say).
ALTER TABLE "Engineer" ADD COLUMN "normalServicePence" INTEGER;
ALTER TABLE "Engineer" ADD COLUMN "normalCalloutPence" INTEGER;
ALTER TABLE "Engineer" ADD COLUMN "repairDiscountPercent" INTEGER;

-- 30 Oct update §7.7: "Send me the details" on the customer plan page.
CREATE TABLE "DetailsRequest" (
    "id" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "tierId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetailsRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DetailsRequest_engineerId_createdAt_idx" ON "DetailsRequest"("engineerId", "createdAt");
CREATE INDEX "DetailsRequest_phone_idx" ON "DetailsRequest"("phone");
ALTER TABLE "DetailsRequest" ADD CONSTRAINT "DetailsRequest_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "Engineer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

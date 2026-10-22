-- Retention, Home Passport & Growth spec (Matt Wood, 15 Oct 2026).

-- AlterTable
ALTER TABLE "Appliance" ADD COLUMN     "installedAt" TIMESTAMP(3),
ADD COLUMN     "passportId" TEXT,
ADD COLUMN     "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Engineer" ADD COLUMN     "enquiryPhone" TEXT,
ADD COLUMN     "leftAt" TIMESTAMP(3),
ADD COLUMN     "profilePhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "showCallButton" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showMessageButton" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "town" TEXT,
ADD COLUMN     "townSlug" TEXT,
ADD COLUMN     "widgetDisabledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "billingInterval" TEXT NOT NULL DEFAULT 'month',
ADD COLUMN     "cancelEffectiveAt" TIMESTAMP(3),
ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "passportId" TEXT,
ADD COLUMN     "pausedUntil" TIMESTAMP(3),
ADD COLUMN     "paymentRecoveredAt" TIMESTAMP(3),
ADD COLUMN     "paymentsCleared" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rejoinToken" TEXT,
ADD COLUMN     "rescueCode" TEXT,
ADD COLUMN     "serviceStartsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "passportId" TEXT;

-- CreateTable
CREATE TABLE "CancelRequest" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "offer" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL DEFAULT 'customer',
    "moveDate" TIMESTAMP(3),
    "passportConsent" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CancelRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomePassport" (
    "id" TEXT NOT NULL,
    "addressKey" TEXT NOT NULL,
    "uprn" TEXT,
    "addressLine1" TEXT NOT NULL,
    "town" TEXT,
    "postcode" TEXT NOT NULL,
    "viewToken" TEXT NOT NULL,
    "contactConsentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomePassport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRecord" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "applianceId" TEXT,
    "engineerId" TEXT NOT NULL,
    "planId" TEXT,
    "kind" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nextDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sticker" (
    "code" TEXT NOT NULL,
    "engineerId" TEXT,
    "passportId" TEXT,
    "linkedAt" TIMESTAMP(3),
    "scans" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sticker_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "serviceRecordId" TEXT NOT NULL,
    "requestToken" TEXT NOT NULL,
    "stars" INTEGER,
    "comment" TEXT,
    "customerName" TEXT,
    "ratedAt" TIMESTAMP(3),
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "message" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TownPage" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "heldAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TownPage_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "CancelRequest_engineerId_createdAt_idx" ON "CancelRequest"("engineerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HomePassport_addressKey_key" ON "HomePassport"("addressKey");

-- CreateIndex
CREATE UNIQUE INDEX "HomePassport_viewToken_key" ON "HomePassport"("viewToken");

-- CreateIndex
CREATE INDEX "ServiceRecord_passportId_doneAt_idx" ON "ServiceRecord"("passportId", "doneAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_serviceRecordId_key" ON "Rating"("serviceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_requestToken_key" ON "Rating"("requestToken");

-- CreateIndex
CREATE INDEX "Rating_engineerId_ratedAt_idx" ON "Rating"("engineerId", "ratedAt");

-- CreateIndex
CREATE INDEX "Enquiry_engineerId_createdAt_idx" ON "Enquiry"("engineerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_rejoinToken_key" ON "Plan"("rejoinToken");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_rescueCode_key" ON "Plan"("rescueCode");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "HomePassport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appliance" ADD CONSTRAINT "Appliance_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "HomePassport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "HomePassport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancelRequest" ADD CONSTRAINT "CancelRequest_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRecord" ADD CONSTRAINT "ServiceRecord_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "HomePassport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRecord" ADD CONSTRAINT "ServiceRecord_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRecord" ADD CONSTRAINT "ServiceRecord_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "Engineer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sticker" ADD CONSTRAINT "Sticker_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "Engineer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sticker" ADD CONSTRAINT "Sticker_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "HomePassport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "Engineer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_serviceRecordId_fkey" FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "Engineer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Loyalty perk: hidden (CARE) until James approves the wording.
INSERT INTO "ClauseTemplate" ("id", "code", "title", "bodyText", "kind", "status", "category", "upliftPence", "pricingLabel", "highlight", "sortOrder")
SELECT 'clause_loyalty_repairs', 'LOYALTY_REPAIRS_DISCOUNT', '10% off repairs, rising to 15% after 12 months',
  'A 10% discount applies to our standard labour rates for repair work, rising to 15% once you have been a plan member for 12 months. Parts and labour remain chargeable at the discounted rates.',
  'ADD', 'CARE', 'Awaiting legal sign-off', NULL, 'awaiting legal sign-off', false,
  (SELECT COALESCE(MAX("sortOrder"), 0) + 1 FROM "ClauseTemplate")
WHERE NOT EXISTS (SELECT 1 FROM "ClauseTemplate" WHERE "code" = 'LOYALTY_REPAIRS_DISCOUNT');

INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES
  ('rating_new_member_threshold', '3', CURRENT_TIMESTAMP),
  ('cancel_rate_flag_percent', '6', CURRENT_TIMESTAMP),
  ('sticker_low_stock', '5', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- AlterTable
ALTER TABLE "Engineer" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "businessType" TEXT,
ADD COLUMN     "companyNumber" TEXT,
ADD COLUMN     "postcode" TEXT,
ADD COLUMN     "marketingConsent" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Engineer_phone_key" ON "Engineer"("phone");

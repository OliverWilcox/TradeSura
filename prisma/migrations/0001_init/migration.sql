-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClauseKind" AS ENUM ('CORE', 'ADD');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('ENGINEER', 'CUSTOMER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageClass" AS ENUM ('TRANSACTIONAL', 'MARKETING');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENT', 'CANCELLED');

-- CreateTable
CREATE TABLE "Engineer" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tradingName" TEXT,
    "logoUrl" TEXT,
    "gasSafeNo" TEXT,
    "gasSafeName" TEXT,
    "gasSafeCompany" TEXT,
    "gasSafeCategories" TEXT,
    "gasSafeVerifiedAt" TIMESTAMP(3),
    "gcOrganisationId" TEXT,
    "gcAccessToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Engineer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "smsOptOut" BOOLEAN NOT NULL DEFAULT false,
    "gcCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "town" TEXT,
    "postcode" TEXT NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appliance" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "type" TEXT,
    "lastServicedAt" TIMESTAMP(3),

    CONSTRAINT "Appliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClauseTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "kind" "ClauseKind" NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ClauseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTier" (
    "id" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthlyPence" INTEGER NOT NULL,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PlanTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TierClause" (
    "tierId" TEXT NOT NULL,
    "clauseId" TEXT NOT NULL,

    CONSTRAINT "TierClause_pkey" PRIMARY KEY ("tierId","clauseId")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tierId" TEXT,
    "status" "PlanStatus" NOT NULL DEFAULT 'PENDING',
    "priceMonthlyPence" INTEGER,
    "signupToken" TEXT NOT NULL,
    "portalToken" TEXT NOT NULL,
    "linkOpenedAt" TIMESTAMP(3),
    "gcBillingRequestId" TEXT,
    "gcBillingRequestFlowId" TEXT,
    "gcMandateId" TEXT,
    "gcSubscriptionId" TEXT,
    "coolingOffEndsAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GasSafeRecord" (
    "regNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "categories" TEXT NOT NULL,

    CONSTRAINT "GasSafeRecord_pkey" PRIMARY KEY ("regNo")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "meta" JSONB,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundSms" (
    "id" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "class" "MessageClass" NOT NULL,
    "status" "SmsStatus" NOT NULL DEFAULT 'QUEUED',
    "sendAfter" TIMESTAMP(3) NOT NULL,
    "cancelKey" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboundSms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GcWebhookEvent" (
    "id" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GcWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Engineer_email_key" ON "Engineer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Engineer_slug_key" ON "Engineer"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Engineer_gcOrganisationId_key" ON "Engineer"("gcOrganisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_engineerId_phone_key" ON "Customer"("engineerId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "ClauseTemplate_code_key" ON "ClauseTemplate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_ref_key" ON "Plan"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_signupToken_key" ON "Plan"("signupToken");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_portalToken_key" ON "Plan"("portalToken");

-- CreateIndex
CREATE INDEX "Event_name_ts_idx" ON "Event"("name", "ts");

-- CreateIndex
CREATE INDEX "OutboundSms_status_sendAfter_idx" ON "OutboundSms"("status", "sendAfter");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "Engineer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appliance" ADD CONSTRAINT "Appliance_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTier" ADD CONSTRAINT "PlanTier_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "Engineer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierClause" ADD CONSTRAINT "TierClause_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "PlanTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierClause" ADD CONSTRAINT "TierClause_clauseId_fkey" FOREIGN KEY ("clauseId") REFERENCES "ClauseTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "Engineer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "PlanTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

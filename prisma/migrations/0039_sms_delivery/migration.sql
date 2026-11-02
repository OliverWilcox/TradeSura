-- QA-02: whether each text arrived. Nullable columns only; existing rows
-- keep NULLs (sent before delivery was recorded).
ALTER TABLE "OutboundSms" ADD COLUMN "providerSid" TEXT,
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "failedAt" TIMESTAMP(3),
ADD COLUMN "failureReason" TEXT;

CREATE UNIQUE INDEX "OutboundSms_providerSid_key" ON "OutboundSms"("providerSid");

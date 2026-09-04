-- S3: cross-channel suppression store + per-message consent basis.

ALTER TABLE "OutboundSms" ADD COLUMN "consentBasis" TEXT;

CREATE TABLE "Suppression" (
    "channel" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("channel", "value")
);

-- 4 Oct build notes, section 2 — 6-digit sign-in codes.
CREATE TABLE "SignInCode" (
    "id" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignInCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SignInCode_engineerId_createdAt_idx" ON "SignInCode"("engineerId", "createdAt");

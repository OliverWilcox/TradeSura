-- Matt, 4 Nov: photos and documents on a boiler or a visit, per engineer.
CREATE TABLE "PassportFile" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "applianceId" TEXT,
    "serviceRecordId" TEXT,
    "engineerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "url" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassportFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PassportFile_passportId_createdAt_idx" ON "PassportFile"("passportId", "createdAt");
CREATE INDEX "PassportFile_engineerId_idx" ON "PassportFile"("engineerId");

ALTER TABLE "PassportFile" ADD CONSTRAINT "PassportFile_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "HomePassport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PassportFile" ADD CONSTRAINT "PassportFile_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PassportFile" ADD CONSTRAINT "PassportFile_serviceRecordId_fkey" FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PassportFile" ADD CONSTRAINT "PassportFile_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "Engineer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 30 Oct update 3.6: trading address (sets the town) and the Companies House
-- registered office, alongside the existing correspondence address (packAddress).
ALTER TABLE "Engineer" ADD COLUMN "tradingAddress" TEXT;
ALTER TABLE "Engineer" ADD COLUMN "registeredOffice" TEXT;

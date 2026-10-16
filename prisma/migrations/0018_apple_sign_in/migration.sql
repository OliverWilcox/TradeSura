-- 30 Sept build notes, step 1 item 5 — "Continue with Apple".
ALTER TABLE "Engineer" ADD COLUMN "appleSub" TEXT;

CREATE UNIQUE INDEX "Engineer_appleSub_key" ON "Engineer"("appleSub");

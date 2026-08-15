-- CreateTable
CREATE TABLE "UnroutedEmail" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT,
    "bodyText" TEXT,
    "rawR2Key" TEXT,
    "rawBytes" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnroutedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnroutedEmail_messageId_key" ON "UnroutedEmail"("messageId");

-- CreateIndex
CREATE INDEX "UnroutedEmail_receivedAt_idx" ON "UnroutedEmail"("receivedAt");

-- NO ROW LEVEL SECURITY ON THIS TABLE, DELIBERATELY.
--
-- Every other table in this schema gets ENABLE + FORCE + org_isolation. This
-- one cannot: a row is here precisely BECAUSE the question "which organization
-- claims this address?" was asked and answered no. There is no tenant to scope
-- to, so a policy on organizationId could never be satisfied and the rows would
-- be invisible to the application that has to write them.
--
-- That is the same argument "Session", "LoginAttempt" and "PasswordResetToken"
-- make, and it is defended in tests/structure.test.ts, whose EXACT list of
-- unprotected tables must be amended in the same commit as this migration.
-- If that list is not amended, `npm run check` fails by name.
GRANT SELECT, INSERT, UPDATE, DELETE ON "UnroutedEmail" TO zebra_app;

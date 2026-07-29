-- ============================================================================
-- AUTH: what a session carries, and somewhere to count failed logins.
-- ============================================================================
--
-- Session.token -> Session.tokenHash. The column now holds SHA-256 of the
-- token rather than the token, so a database leak yields nothing usable. A
-- drop-and-add rather than a rename because the shape changed and the table
-- was empty; there is no data to preserve.
--
-- Session gains the resolved context §7 requires: activeOrganizationId, role
-- and companyScopes.
--
-- activeOrganizationId is NOT named organizationId, deliberately. Every column
-- with that name is subject to row-level security. This one is the input to
-- row-level security — it is read to decide which tenant the request is, long
-- before any policy can apply, and a policy on it would make a session
-- impossible to resolve. Giving it a different name means the RLS audit in
-- tests/structure.test.ts stays a simple rule with no exception list.
--
-- LoginAttempt is pre-authentication and therefore carries no tenant: at the
-- moment a row is written, nobody has proved who they are. It stays outside
-- RLS for the same reason User and Session do. zebra_app reaches it through
-- the ALTER DEFAULT PRIVILEGES set up in the rls_and_isolation migration.

-- DropIndex
DROP INDEX "Session_token_key";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "token",
ADD COLUMN     "activeOrganizationId" TEXT NOT NULL,
ADD COLUMN     "companyScopes" TEXT[],
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "role" "Role" NOT NULL,
ADD COLUMN     "tokenHash" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_createdAt_idx" ON "LoginAttempt"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_activeOrganizationId_idx" ON "Session"("activeOrganizationId");


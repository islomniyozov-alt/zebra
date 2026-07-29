-- The resolved copy of Membership.permissionOverrides, so that `can()` has
-- a single input and needs no lookup behind row-level security.

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "permissionOverrides" JSONB;


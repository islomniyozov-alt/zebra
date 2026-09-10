-- The four policies added on 2026-09-10 named the wrong session variable.
--
-- Every other table in this schema reads `app.current_org_id`, set per request
-- by `withOrg`. The four money tables were written with
-- `app.organization_id`, a name nothing sets.
--
-- `current_setting('app.organization_id', true)` returns NULL for a name that
-- was never set, and `"organizationId" = NULL` is NULL rather than true — so
-- the policy denied EVERY row, including the tenant's own. The isolation suite
-- caught it as "cannot see 1 of its own row(s)" on all four tables, which is
-- the failure mode worth having: a policy that is too tight is loud on the
-- first read, where one that is too loose is silent forever.
--
-- Nothing had read these tables yet, so no request ever saw the empty result.

DROP POLICY IF EXISTS org_isolation ON "DriverOpeningBalance";
DROP POLICY IF EXISTS org_isolation ON "RecurringDeduction";
DROP POLICY IF EXISTS org_isolation ON "SettlementCharge";
DROP POLICY IF EXISTS org_isolation ON "DriverEscrowEntry";

CREATE POLICY "org_isolation" ON "DriverOpeningBalance"
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "org_isolation" ON "RecurringDeduction"
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "org_isolation" ON "SettlementCharge"
  USING ("organizationId" = current_setting('app.current_org_id', true));
CREATE POLICY "org_isolation" ON "DriverEscrowEntry"
  USING ("organizationId" = current_setting('app.current_org_id', true));

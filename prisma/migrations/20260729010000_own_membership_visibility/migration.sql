-- ============================================================================
-- Letting a user find their own memberships, before any organization is known.
-- ============================================================================
--
-- FOUND BY: tests/auth.integration.test.ts. Every login returned
-- "no_membership". Membership carries an organizationId and is therefore
-- behind row-level security, but login has to read it to discover WHICH
-- organization to unlock. The one query that bootstraps a session was the one
-- query the wall would not let through.
--
-- REJECTED: a SECURITY DEFINER function to fetch memberships. It would have
-- worked, and it would have put a deliberate RLS bypass on the login path —
-- the single most attacked path in the application. The bypass triggers
-- elsewhere in this schema run on writes the application cannot aim; this one
-- would run on input a stranger controls.
--
-- INSTEAD: a second session variable, and a second policy that reads it.
-- `app.current_user_id` says who is asking; `app.current_org_id` says which
-- tenant they are acting as. Login sets the first, gets back the list of
-- organizations that user belongs to, and only then sets the second.
-- Authorization stays entirely inside row-level security, with no code path
-- that steps around it.
--
-- FOR SELECT, deliberately. A permissive policy without a command restriction
-- supplies its USING clause as the INSERT/UPDATE check too — which would have
-- meant that asserting a user id let you WRITE a membership into any
-- organization you named. Reading your own memberships is the entire grant.

CREATE POLICY "own_membership" ON "Membership"
  FOR SELECT
  USING ("userId" = current_setting('app.current_user_id', true));

-- The scope list belongs to the membership, so it inherits the same rule.
-- The subquery is itself filtered by the policy above, which is what keeps
-- this from becoming a way to read another tenant's scopes.
CREATE POLICY "own_membership" ON "MembershipCompany"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "Membership" m
       WHERE m."id" = "MembershipCompany"."membershipId"
         AND m."userId" = current_setting('app.current_user_id', true)
    )
  );

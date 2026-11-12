-- MIGRATION 71 — THE SHELL'S THREE READS BECOME ONE (GAPS 42 item 3; owner's
-- instruction 2026-11-12; §6.10 v10.93).
--
-- Every page the operator shell renders paid three reads before its own, in
-- sequence, each a round trip to us-east-2: the session row by token hash,
-- the viewer's own name and email, and the density preference inside its own
-- tenant transaction (BEGIN, set_config, the read, COMMIT). Measured on dev at
-- `fef9f8d` as 840 ms median of `shell.timing` on every one of the 37
-- Accounting pages (GAPS 42). This function answers all three in ONE
-- statement, from the session row outward.
--
-- SECURITY DEFINER, BECAUSE THE PREFERENCE IS UNDER ROW-LEVEL SECURITY. The
-- `UserPreference` policy keys on `app.current_org_id`, which only a tenant
-- transaction sets, and setting it outside one on a pooled connection would
-- leak across requests. So the function reads the preference as its owner —
-- and the ONE PREDICATE that keeps that honest is below: the preference row
-- must belong to the session's own user AND the session's own active
-- organization, both taken from the session row the token hash found, never
-- from an argument. A caller holding a token can read that token's own
-- density and nothing else. `search_path` is pinned, as every zebra_% SECURITY
-- DEFINER function's is (tests/structure.test.ts names them).
--
-- STABLE: it reads and never writes. The validity checks — revoked, expired,
-- user inactive — stay in the application (`resolveShellContext`), as they
-- are for `resolveSession`, so the two spellings of "a live session" cannot
-- drift; the agreement test holds the function's row against the three reads
-- it replaces, both sides above zero.

CREATE OR REPLACE FUNCTION zebra_shell_context(token_hash text)
RETURNS TABLE (
  session_id           text,
  user_id              text,
  organization_id      text,
  role                 "Role",
  company_scopes       text[],
  permission_overrides jsonb,
  expires_at           timestamp(3),
  revoked_at           timestamp(3),
  user_active          boolean,
  user_name            text,
  user_email           text,
  density              jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    s."id",
    s."userId",
    s."activeOrganizationId",
    s."role",
    s."companyScopes",
    s."permissionOverrides",
    s."expiresAt",
    s."revokedAt",
    u."isActive",
    u."name",
    u."email",
    (
      SELECT p."value"
        FROM "UserPreference" p
       WHERE p."userId" = s."userId"
         AND p."organizationId" = s."activeOrganizationId"
         AND p."key" = 'density'
       LIMIT 1
    )
  FROM "Session" s
  JOIN "User" u ON u."id" = s."userId"
  WHERE s."tokenHash" = token_hash
$$;

REVOKE ALL ON FUNCTION zebra_shell_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zebra_shell_context(text) TO zebra_app;

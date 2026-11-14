-- Migration 72 — zebra_tenant_read (TMS-DESIGN-SYSTEM.md §6.2.9 v11.03;
-- owner's ruling 2026-11-14, "yes, carefully").
--
-- THE TENANT AND ONE READ IN ONE ROUND TRIP. A tenant transaction pays BEGIN,
-- set_config and COMMIT around its read — three trips of ~200 ms that carry
-- no data. They cannot be folded into the read's own statement: row-level
-- security reads current_setting('app.current_org_id', true), which is
-- STABLE and is evaluated when the planner chooses (One-Time Filters at
-- executor start), so a setting beside the read in one statement is a race.
--
-- So two statements, inside one function call:
--
--   1. PERFORM set_config('app.current_org_id', org_id, true)
--   2. EXECUTE the read — a separate statement, planned after the setting —
--      wrapped as a subquery of json_agg, so a data-modifying WITH (which
--      must be top level) cannot appear in it.
--
-- SECURITY INVOKER, and that is the whole safety property: the function runs
-- as its caller, zebra_app, which has no BYPASSRLS, so every policy applies
-- to the read exactly as it does inside runInOrg. Nothing about row-level
-- security changes. EXECUTE is granted to zebra_app alone.
--
-- CALLED OUTSIDE A TRANSACTION, the call is its own implicit transaction and
-- the LOCAL setting ends when it returns — nothing is left on a pooled
-- connection. Called inside one, the setting would last to that
-- transaction's end, so `tenantReader` (src/lib/tenancy.ts) is the only
-- caller and takes the request client, never a transaction client.
--
-- The read's values arrive in `args` and are referenced by the text as typed
-- casts of $1 -> n; nothing is concatenated but the server-built text.
-- Proof: tests/integration/tenant-read.test.ts, watched failing with
-- row-level security off.
CREATE OR REPLACE FUNCTION zebra_tenant_read(org_id text, sql text, args jsonb)
RETURNS json
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
DECLARE
  result json;
BEGIN
  IF org_id IS NULL OR org_id = '' THEN
    RAISE EXCEPTION 'zebra_tenant_read: no organization';
  END IF;
  PERFORM set_config('app.current_org_id', org_id, true);
  EXECUTE 'SELECT json_agg(q) FROM (' || sql || ') q' INTO result USING args;
  RETURN result;
END
$fn$;

REVOKE ALL ON FUNCTION zebra_tenant_read(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zebra_tenant_read(text, text, jsonb) TO zebra_app;

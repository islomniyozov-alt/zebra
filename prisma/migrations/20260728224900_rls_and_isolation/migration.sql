-- ============================================================================
-- TENANCY: row-level security, the app role, and the constraints Prisma
-- cannot express.
-- ============================================================================
--
-- Everything here is deliberately outside schema.prisma because Prisma has no
-- syntax for it. Read this file before changing anything about tenancy.
--
-- FOUR PARTS:
--   1. Partial unique indexes on AssetAssignment — one open period per asset.
--   2. Triggers that derive organizationId on the eleven child tables.
--   3. The zebra_app role. The application connects as this, never as owner.
--   4. RLS enabled AND forced, with an org_isolation policy, on all 38 tables
--      that carry a tenant.
--
-- WHY "FORCE": a table's owner is exempt from its own policies unless the
-- table is FORCEd. Migrations run as neondb_owner, which on Neon also carries
-- BYPASSRLS, so the owner is exempt either way — FORCE is there so that the
-- day someone connects the app with owner credentials by mistake, the tables
-- themselves still object.
--
-- CONSEQUENCE WORTH KNOWING: because neondb_owner has BYPASSRLS, an isolation
-- test run over DIRECT_DATABASE_URL proves nothing. It must connect as
-- zebra_app or it passes vacuously.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. ASSET ASSIGNMENT — ONE OPEN PERIOD PER ASSET
-- ----------------------------------------------------------------------------
-- `effectiveTo IS NULL` means "this is the authority currently operating the
-- asset". Two open rows for one truck would make "which authority ran truck
-- 105 in Q2" ambiguous, which is the IFTA/IRP question the table exists to
-- answer. Prisma cannot express a partial index, so it lives here.
--
-- truckId/trailerId/driverId are nullable and each row sets exactly one, so
-- the NULLs do not collide: a trailer row is simply absent from the truck
-- index.

CREATE UNIQUE INDEX "asset_open_period_truck"
  ON "AssetAssignment" ("truckId")
  WHERE "effectiveTo" IS NULL AND "truckId" IS NOT NULL;

CREATE UNIQUE INDEX "asset_open_period_trailer"
  ON "AssetAssignment" ("trailerId")
  WHERE "effectiveTo" IS NULL AND "trailerId" IS NOT NULL;

CREATE UNIQUE INDEX "asset_open_period_driver"
  ON "AssetAssignment" ("driverId")
  WHERE "effectiveTo" IS NULL AND "driverId" IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 2. DERIVING organizationId ON CHILD TABLES
-- ----------------------------------------------------------------------------
-- RLS cannot follow a foreign key, so eleven tables carry a copy of the
-- parent's organizationId (schema convention 9). These triggers make the
-- parent the authority: whatever the application passes is overwritten on
-- every INSERT and UPDATE, so the copy cannot drift and cannot be forged.
--
-- SECURITY DEFINER, so the parent lookup runs as the owner and is not itself
-- filtered by RLS. That is what makes the stamp truthful even when the caller
-- has no business touching that parent — and the child's own WITH CHECK then
-- rejects the row. Cross-tenant attachment is refused by the policy, not by
-- the trigger guessing.
--
-- search_path is pinned. A SECURITY DEFINER function with a mutable
-- search_path is a privilege-escalation hole.

CREATE OR REPLACE FUNCTION zebra_org_from_company() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE parent_org text;
BEGIN
  SELECT "organizationId" INTO parent_org FROM "Company" WHERE "id" = NEW."companyId";
  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'zebra: %.companyId=% has no Company', TG_TABLE_NAME, NEW."companyId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW."organizationId" := parent_org;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION zebra_org_from_customer() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE parent_org text;
BEGIN
  SELECT "organizationId" INTO parent_org FROM "Customer" WHERE "id" = NEW."customerId";
  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'zebra: %.customerId=% has no Customer', TG_TABLE_NAME, NEW."customerId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW."organizationId" := parent_org;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION zebra_org_from_driver() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE parent_org text;
BEGIN
  SELECT "organizationId" INTO parent_org FROM "Driver" WHERE "id" = NEW."driverId";
  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'zebra: %.driverId=% has no Driver', TG_TABLE_NAME, NEW."driverId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW."organizationId" := parent_org;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION zebra_org_from_load() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE parent_org text;
BEGIN
  SELECT "organizationId" INTO parent_org FROM "Load" WHERE "id" = NEW."loadId";
  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'zebra: %.loadId=% has no Load', TG_TABLE_NAME, NEW."loadId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW."organizationId" := parent_org;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION zebra_org_from_invoice() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE parent_org text;
BEGIN
  SELECT "organizationId" INTO parent_org FROM "Invoice" WHERE "id" = NEW."invoiceId";
  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'zebra: %.invoiceId=% has no Invoice', TG_TABLE_NAME, NEW."invoiceId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW."organizationId" := parent_org;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION zebra_org_from_settlement() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE parent_org text;
BEGIN
  SELECT "organizationId" INTO parent_org FROM "Settlement" WHERE "id" = NEW."settlementId";
  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'zebra: %.settlementId=% has no Settlement', TG_TABLE_NAME, NEW."settlementId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW."organizationId" := parent_org;
  RETURN NEW;
END $$;

-- Two parents. Both must agree, and disagreement is a bug worth shouting
-- about rather than silently preferring one side.

CREATE OR REPLACE FUNCTION zebra_org_from_membership() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE membership_org text; company_org text;
BEGIN
  SELECT "organizationId" INTO membership_org FROM "Membership" WHERE "id" = NEW."membershipId";
  IF membership_org IS NULL THEN
    RAISE EXCEPTION 'zebra: MembershipCompany.membershipId=% has no Membership', NEW."membershipId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT "organizationId" INTO company_org FROM "Company" WHERE "id" = NEW."companyId";
  IF company_org IS NULL THEN
    RAISE EXCEPTION 'zebra: MembershipCompany.companyId=% has no Company', NEW."companyId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF membership_org <> company_org THEN
    RAISE EXCEPTION 'zebra: membership % (org %) cannot be scoped to company % (org %)',
      NEW."membershipId", membership_org, NEW."companyId", company_org
      USING ERRCODE = 'raise_exception';
  END IF;
  NEW."organizationId" := membership_org;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION zebra_org_from_payment() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE payment_org text; invoice_org text;
BEGIN
  SELECT "organizationId" INTO payment_org FROM "Payment" WHERE "id" = NEW."paymentId";
  IF payment_org IS NULL THEN
    RAISE EXCEPTION 'zebra: PaymentApplication.paymentId=% has no Payment', NEW."paymentId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT "organizationId" INTO invoice_org FROM "Invoice" WHERE "id" = NEW."invoiceId";
  IF invoice_org IS NULL THEN
    RAISE EXCEPTION 'zebra: PaymentApplication.invoiceId=% has no Invoice', NEW."invoiceId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF payment_org <> invoice_org THEN
    RAISE EXCEPTION 'zebra: payment % (org %) cannot be applied to invoice % (org %)',
      NEW."paymentId", payment_org, NEW."invoiceId", invoice_org
      USING ERRCODE = 'raise_exception';
  END IF;
  NEW."organizationId" := payment_org;
  RETURN NEW;
END $$;

CREATE TRIGGER "set_org" BEFORE INSERT OR UPDATE ON "CompanySettings"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_company();
CREATE TRIGGER "set_org" BEFORE INSERT OR UPDATE ON "CustomerContact"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_customer();
CREATE TRIGGER "set_org" BEFORE INSERT OR UPDATE ON "DriverPayRule"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_driver();
CREATE TRIGGER "set_org" BEFORE INSERT OR UPDATE ON "InvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_invoice();
CREATE TRIGGER "set_org" BEFORE INSERT OR UPDATE ON "LoadAccessorial"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_load();
CREATE TRIGGER "set_org" BEFORE INSERT OR UPDATE ON "LoadAssignment"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_load();
CREATE TRIGGER "set_org" BEFORE INSERT OR UPDATE ON "LoadStatusEvent"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_load();
CREATE TRIGGER "set_org" BEFORE INSERT OR UPDATE ON "LoadStop"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_load();
CREATE TRIGGER "set_org" BEFORE INSERT OR UPDATE ON "MembershipCompany"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_membership();
CREATE TRIGGER "set_org" BEFORE INSERT OR UPDATE ON "PaymentApplication"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_payment();
CREATE TRIGGER "set_org" BEFORE INSERT OR UPDATE ON "SettlementLine"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_settlement();


-- ----------------------------------------------------------------------------
-- 3. THE APPLICATION ROLE
-- ----------------------------------------------------------------------------
-- The app connects as zebra_app. It owns nothing, so it cannot bypass RLS by
-- ownership, and it is deliberately not granted BYPASSRLS, CREATEROLE or
-- membership of neon_superuser.
--
-- Created with NOLOGIN and no password. Granting login is a separate, manual
-- act per environment, so a password never enters version control:
--
--   ALTER ROLE zebra_app WITH LOGIN PASSWORD '<generated>';
--
-- DDL is not granted. Migrations run as the owner; the app never alters
-- structure.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zebra_app') THEN
    CREATE ROLE zebra_app NOLOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO zebra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zebra_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO zebra_app;

-- Future migrations create tables as the owner; without this the app would
-- lose access to every table added after today. It does NOT enable RLS on
-- them — the DO block at the foot of this file is what catches that omission,
-- and it runs on every migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zebra_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO zebra_app;

-- Migration bookkeeping is the owner's business. Guarded because Prisma's
-- shadow database replays migrations without creating this table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations'
  ) THEN
    EXECUTE 'REVOKE ALL ON TABLE "_prisma_migrations" FROM zebra_app';
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 4. ROW-LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- One policy shape, applied uniformly:
--
--   USING ("organizationId" = current_setting('app.current_org_id', true))
--
-- current_setting(..., true) returns NULL when the variable was never set, so
-- the comparison is NULL, so no rows. Unset means invisible, not unrestricted
-- — the failure mode is an empty screen, never a leak.
--
-- The policy is FOR ALL and omits WITH CHECK, so Postgres reuses USING as the
-- check on INSERT and UPDATE. Reading another tenant's rows and writing rows
-- into another tenant are the same wall.
--
-- The variable is set per request with SET LOCAL inside an interactive
-- transaction, which is why the HTTP driver is not an option — see
-- src/lib/db.ts.

-- Organization is the tenant itself: its own id is the boundary.
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Organization"
  USING ("id" = current_setting('app.current_org_id', true));

ALTER TABLE "AssetAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssetAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "AssetAssignment"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "AuditLog"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CalendarEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "CalendarEvent"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Claim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Claim" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Claim"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Communication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Communication" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Communication"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Company" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Company"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CompanySettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanySettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "CompanySettings"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ComplianceItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ComplianceItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "ComplianceItem"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Counter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Counter" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Counter"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Customer"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CustomerContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerContact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "CustomerContact"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Document"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Driver" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Driver" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Driver"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "DriverPayRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DriverPayRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "DriverPayRule"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Expense"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "FactoringCompany" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FactoringCompany" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "FactoringCompany"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "FuelTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FuelTransaction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "FuelTransaction"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "IftaMileage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IftaMileage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "IftaMileage"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Integration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Integration" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Integration"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Invoice"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InvoiceLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "InvoiceLine"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Load" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Load" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Load"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "LoadAccessorial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoadAccessorial" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "LoadAccessorial"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "LoadAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoadAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "LoadAssignment"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "LoadStatusEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoadStatusEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "LoadStatusEvent"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "LoadStop" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoadStop" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "LoadStop"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Location" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Location" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Location"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "MaintenanceRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaintenanceRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "MaintenanceRecord"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Membership"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "MembershipCompany" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipCompany" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "MembershipCompany"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Notification"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Payment"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PaymentApplication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentApplication" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "PaymentApplication"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Settlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Settlement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Settlement"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "SettlementLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SettlementLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "SettlementLine"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Trailer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trailer" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Trailer"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Truck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Truck" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Truck"
  USING ("organizationId" = current_setting('app.current_org_id', true));


-- ----------------------------------------------------------------------------
-- USER AND SESSION ARE OUTSIDE THIS WALL, ON PURPOSE
-- ----------------------------------------------------------------------------
-- Neither carries an organizationId and neither can. One person holds
-- memberships in several organizations, and login has to find the user by
-- email before any organization is known — a policy on User would make
-- authentication impossible, and a policy on Session would make it impossible
-- to resolve the session that names the organization in the first place.
--
-- What protects them instead:
--   * Session.token is unique and looked up by token, never enumerated.
--   * A user's reach is Membership, which IS policed. Knowing a User row
--     exists grants nothing without a membership in the current organization.
--   * Step 4 owes the login path a constant-time lookup and rate limiting;
--     User is the one table where a query is not tenant-filtered, so it is
--     the one table where an enumeration bug would be visible.
--
-- The audit below therefore checks tables that carry organizationId. If a
-- future migration adds one and forgets its policy, the migration fails here
-- rather than shipping a table with an open door.

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND (
      c.relname = 'Organization'
      OR EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'organizationId' AND a.attnum > 0 AND NOT a.attisdropped
      )
    )
    AND NOT (
      c.relrowsecurity
      AND c.relforcerowsecurity
      AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'org_isolation')
    );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'zebra: these tenant tables lack ENABLE+FORCE row level security or the org_isolation policy: %', missing;
  END IF;
END $$;

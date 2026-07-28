-- ============================================================================
-- The organizationId triggers fired too often, and deleting an Organization
-- was impossible because of it.
-- ============================================================================
--
-- FOUND BY: the §6 isolation suite, whose teardown could not remove its own
-- fixtures.
--
-- WHAT HAPPENED: the triggers were BEFORE INSERT OR UPDATE, with no column
-- list, so any UPDATE fired them. Deleting an Organization cascades to Truck,
-- and LoadAssignment.truckId is a nullable FK, so Postgres issues an UPDATE
-- setting it to NULL. By then the cascade had already removed the Load, so the
-- trigger looked up a parent that no longer existed and raised:
--
--   zebra: LoadAssignment.loadId=<id> has no Load
--
-- The same shape exists on six other nullable FKs into child tables —
-- LoadStop.locationId, InvoiceLine.loadId, SettlementLine.loadId and so on.
-- Any of them would have failed the same way.
--
-- THE FIX: `UPDATE OF <columns>` fires only when the named columns appear in
-- the statement's SET list. The value only ever needs re-deriving when the
-- parent link changes or when someone writes to the denormalized column
-- itself, which is precisely that list. A cascade nulling an unrelated column
-- now leaves the trigger alone.
--
-- Still airtight: the parent FK columns below are all NOT NULL and cascade on
-- delete, so they are never the target of a SET NULL, and a statement that
-- does set one is a statement that must re-derive.

DROP TRIGGER "set_org" ON "CompanySettings";
CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "companyId", "organizationId" ON "CompanySettings"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_company();

DROP TRIGGER "set_org" ON "CustomerContact";
CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "customerId", "organizationId" ON "CustomerContact"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_customer();

DROP TRIGGER "set_org" ON "DriverPayRule";
CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "driverId", "organizationId" ON "DriverPayRule"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_driver();

DROP TRIGGER "set_org" ON "InvoiceLine";
CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "invoiceId", "organizationId" ON "InvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_invoice();

DROP TRIGGER "set_org" ON "LoadAccessorial";
CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "loadId", "organizationId" ON "LoadAccessorial"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_load();

DROP TRIGGER "set_org" ON "LoadAssignment";
CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "loadId", "organizationId" ON "LoadAssignment"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_load();

DROP TRIGGER "set_org" ON "LoadStatusEvent";
CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "loadId", "organizationId" ON "LoadStatusEvent"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_load();

DROP TRIGGER "set_org" ON "LoadStop";
CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "loadId", "organizationId" ON "LoadStop"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_load();

DROP TRIGGER "set_org" ON "MembershipCompany";
CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "membershipId", "companyId", "organizationId" ON "MembershipCompany"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_membership();

DROP TRIGGER "set_org" ON "PaymentApplication";
CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "paymentId", "invoiceId", "organizationId" ON "PaymentApplication"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_payment();

DROP TRIGGER "set_org" ON "SettlementLine";
CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "settlementId", "organizationId" ON "SettlementLine"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_settlement();

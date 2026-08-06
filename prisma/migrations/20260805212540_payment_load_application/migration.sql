-- CreateTable
CREATE TABLE "PaymentLoadApplication" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLoadApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentLoadApplication_loadId_idx" ON "PaymentLoadApplication"("loadId");

-- CreateIndex
CREATE INDEX "PaymentLoadApplication_organizationId_idx" ON "PaymentLoadApplication"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLoadApplication_paymentId_loadId_key" ON "PaymentLoadApplication"("paymentId", "loadId");

-- AddForeignKey
ALTER TABLE "PaymentLoadApplication" ADD CONSTRAINT "PaymentLoadApplication_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLoadApplication" ADD CONSTRAINT "PaymentLoadApplication_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ----------------------------------------------------------------------------
-- THE TENANT WALL, for the second application path.
--
-- Same treatment as PaymentApplication and for the same reason: this table has
-- no companyId of its own, so `organizationId` is DERIVED by a trigger rather
-- than trusted from the caller, and the trigger refuses a payment and a load
-- that belong to different tenants. A join table is exactly where a
-- cross-tenant write would otherwise be invisible — both endpoints look valid
-- on their own.
--
-- The trigger fires only on the columns that can change the answer (see
-- 20260728233000_org_trigger_only_on_relevant_columns); an amount correction
-- must not re-derive the tenant.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION zebra_org_from_payment_load() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE payment_org text; load_org text;
BEGIN
  SELECT "organizationId" INTO payment_org FROM "Payment" WHERE "id" = NEW."paymentId";
  IF payment_org IS NULL THEN
    RAISE EXCEPTION 'zebra: PaymentLoadApplication.paymentId=% has no Payment', NEW."paymentId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT "organizationId" INTO load_org FROM "Load" WHERE "id" = NEW."loadId";
  IF load_org IS NULL THEN
    RAISE EXCEPTION 'zebra: PaymentLoadApplication.loadId=% has no Load', NEW."loadId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF payment_org <> load_org THEN
    RAISE EXCEPTION 'zebra: payment % (org %) cannot be applied to load % (org %)',
      NEW."paymentId", payment_org, NEW."loadId", load_org
      USING ERRCODE = 'raise_exception';
  END IF;
  NEW."organizationId" := payment_org;
  RETURN NEW;
END $$;

CREATE TRIGGER "set_org"
  BEFORE INSERT OR UPDATE OF "paymentId", "loadId", "organizationId" ON "PaymentLoadApplication"
  FOR EACH ROW EXECUTE FUNCTION zebra_org_from_payment_load();

ALTER TABLE "PaymentLoadApplication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentLoadApplication" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "PaymentLoadApplication"
  USING ("organizationId" = current_setting('app.current_org_id', true));

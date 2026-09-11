-- WHICH GROSS A LOAD SETTLES ON, when the remittance and the rate disagree.
--
-- MONEY-DESIGN §3: Amazon freight settles on the REMITTED figure. Where the
-- remittance matches the booked rate that is automatic; where it is short or
-- over, the line is HELD out of every settlement until a person rules on it.
--
-- The ruling had nowhere to live. The remittance importer writes a
-- `PaymentLoadApplication` for what arrived, and the load keeps what was
-- booked — but "the $90 that arrived IS what this load settles on" is a third
-- fact, made by a human, and inferring it from the other two is exactly the
-- guess the hold exists to prevent. Short can mean a deduction we accept or a
-- mistake we are going to argue about, and those pay the driver differently.

ALTER TABLE "Load"
  ADD COLUMN "settledGrossCents"         INTEGER,
  ADD COLUMN "settledGrossConfirmedAt"   TIMESTAMP(3),
  ADD COLUMN "settledGrossConfirmedById" TEXT;

ALTER TABLE "Load" ADD CONSTRAINT "Load_settledGrossConfirmedById_fkey"
  FOREIGN KEY ("settledGrossConfirmedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- No policy or grant: `Load` already carries both.

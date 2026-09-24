-- DRIVER KIND: A PERSON, OR A REFERRAL PAYEE.
--
-- Owner's ruling, 2026-09-24. Production holds Driver rows that are not people
-- — `7 Star`, `Said truck 3609` — imported from Datatruck beside the real ones.
-- They are referral payees: a commission on another driver's loads. They settle
-- like anyone else and they KEEP THEIR PAY RULES; the ruling is explicit that
-- they are not to be inactivated, because inactivating them stops the money.
--
-- Text against a code list in src/lib/driver-kind.ts, following
-- `Truck.fleetStatus`, so the list and the four exclusions it drives are
-- readable in one place.
--
-- DEFAULT 'PERSON' so every existing row keeps meaning what it meant. The
-- failure direction matters: a payee left as a person raises a warning nobody
-- can clear, while a person wrongly marked a payee silently drops out of the
-- Driver Qualification File — and that is the one an auditor asks about.
ALTER TABLE "Driver" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PERSON';

-- THE STATEMENT MUST NOT CLAIM A COMMISSION WAS IN THE CAB.
--
-- A payee sits in `Load.coDriverId` to earn, so without this the statement
-- prints "Team with 7 Star" under the driver — on the one document that driver
-- reads to check their own pay.
--
-- A SECOND COLUMN rather than a label inside `teamWith`, because both are
-- FROZEN onto the settlement. Deriving the label at render time by reading
-- `Driver.kind` back would restate an already-paid statement the day somebody
-- reclassifies a row, which is the same argument that froze `teamWith`.
ALTER TABLE "Settlement" ADD COLUMN "referralWith" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

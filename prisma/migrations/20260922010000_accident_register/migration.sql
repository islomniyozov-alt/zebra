-- ITEM 14 — THE ACCIDENT REGISTER, 49 CFR 390.15(b).
--
-- One table. The columns are §390.15(b)(2)'s six, plus the one fact §390.5
-- needs and the register itself does not print, plus the link to a claim.
--
-- ── THERE IS NO `deletedAt`, AND THAT IS THE DESIGN ─────────────────────
--
-- Every other soft-deletable table in this schema has one. A register does
-- not: it is a document a regulator reads, and a row that leaves it silently
-- is the shape of falsification whatever the intent. A mistake is VOIDED —
-- struck through, with a reason and a date, still on the register.
--
-- `tests/accidents.test.ts` fails by name if a `deletedAt` appears here.
--
-- ── AND THERE IS NO `isRecordable` ──────────────────────────────────────
--
-- DOT-recordable is §390.5's three-part test over `fatalities`, `injuries`
-- and `towedAway`. A stored flag would be somebody's opinion on the day they
-- typed it; the opinion that matters is the auditor's, applied to the three
-- numbers in front of them. If the flag and the numbers disagreed, the flag
-- would be the lie and the numbers would be the evidence.
--
-- HAZMAT IS RECORDED AND IS NOT PART OF THE TEST. §390.15(b)(2)(vi) requires
-- the register to say whether hazardous materials — other than fuel spilled
-- from the fuel tanks of the vehicles involved — were released. §390.5 does
-- not count a release as making the occurrence an accident. A spill with no
-- injury, no fatality and no tow-away is recorded in full and is not
-- recordable, and src/lib/accidents.ts is the one place that says so.
CREATE TABLE "Accident" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    -- THE COMPANY IS THE REGISTER. §390.15 binds the motor carrier, so a group
    -- running four authorities keeps four registers and an auditor asks for
    -- the one belonging to the MC number they are auditing. Never inferred
    -- from the driver or the truck, either of which may have transferred.
    "companyId" TEXT NOT NULL,

    "occurredAt" TIMESTAMP(3) NOT NULL,
    -- §390.15(b)(2)(ii): the city or nearest town, and the state.
    "city" TEXT,
    "state" TEXT,

    -- Nullable, and both for the same reason: a bobtail accident in the yard
    -- has a driver and no load, an accident to a parked trailer may have
    -- neither. A register row with nobody named is a gap an auditor can see;
    -- a required column would be filled with a guess.
    "driverId" TEXT,
    "truckId" TEXT,

    -- §390.15(b)(2)(iv). COUNTS INJURIES MEETING §390.5 — a person who
    -- immediately received medical treatment AWAY FROM THE SCENE — not
    -- everybody who was shaken up. The form says so too.
    "injuries" INTEGER NOT NULL DEFAULT 0,
    -- §390.15(b)(2)(v).
    "fatalities" INTEGER NOT NULL DEFAULT 0,
    -- §390.15(b)(2)(vi).
    "hazmatReleased" BOOLEAN NOT NULL DEFAULT false,
    -- §390.5(iii). Not printed on the register; needed to derive recordability.
    "towedAway" BOOLEAN NOT NULL DEFAULT false,

    -- LINKED WHEN ONE EXISTS, INDEPENDENT OF IT. Not every accident produces
    -- a claim and not every claim comes from an accident — a cargo claim has
    -- no accident at all. Nullable on purpose, and the register does not
    -- require one to be complete.
    "claimId" TEXT,

    "notes" TEXT,

    -- STRUCK THROUGH, NOT REMOVED. A reason is required by `voidAccident`;
    -- the pair cannot disagree because the CHECK below forbids it.
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Accident_pkey" PRIMARY KEY ("id")
);

-- A reason without a void, or a void without a reason, are both rows nobody
-- can explain to an auditor. The database refuses the pair rather than a
-- reader having to decide which half to believe — same shape as
-- `Driver_off_duty_until_needs_off_duty`.
ALTER TABLE "Accident"
  ADD CONSTRAINT "Accident_void_needs_reason"
  CHECK (("voidedAt" IS NULL) = ("voidReason" IS NULL));

ALTER TABLE "Accident" ADD CONSTRAINT "Accident_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Accident" ADD CONSTRAINT "Accident_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Accident" ADD CONSTRAINT "Accident_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Accident" ADD CONSTRAINT "Accident_truckId_fkey"
  FOREIGN KEY ("truckId") REFERENCES "Truck"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Accident" ADD CONSTRAINT "Accident_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "Claim"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The register is read by company, newest first. That is the only way it is
-- ever read, so it is the only index it gets.
CREATE INDEX "Accident_companyId_occurredAt_idx"
  ON "Accident"("companyId", "occurredAt" DESC);
CREATE INDEX "Accident_driverId_idx" ON "Accident"("driverId");
CREATE INDEX "Accident_claimId_idx" ON "Accident"("claimId");
CREATE INDEX "Accident_organizationId_idx" ON "Accident"("organizationId");

-- ── TENANT ISOLATION, LIKE EVERY OTHER TABLE THAT CARRIES ONE ───────────
--
-- FORCE, so the table's owner is not exempt. The policy alone proves nothing
-- about a table with no rows in it, which is why `tests/integration/
-- fixtures.ts` seeds one in this same commit and `tests/isolation-coverage.
-- test.ts` fails by name if it does not.
--
-- RLS SEPARATES TENANTS AND HAS NOTHING TO SAY ABOUT AUTHORITIES. Two
-- companies in one organisation share this policy completely; keeping RAM's
-- accidents off Dolphins' register is `companyId` in the query, and the guard
-- for it is an integration test rather than a policy.
ALTER TABLE "Accident" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Accident" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "Accident"
  USING ("organizationId" = current_setting('app.current_org_id', true));

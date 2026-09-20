-- THE ONLY THING ITEM 11 STORES.
--
-- Heading to, dispatch status, last activity and on-time delivery are all
-- derived from rows that already exist. Being off duty is not: a driver on
-- holiday leaves no trace in the freight, so somebody has to say so.
ALTER TABLE "Driver" ADD COLUMN "isOffDuty" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Driver" ADD COLUMN "offDutyUntil" TIMESTAMP(3);

-- THE TWO HALVES CANNOT DISAGREE. A return date on a driver who is not off
-- duty is the one contradiction this pair can express, so the database refuses
-- it rather than a reader having to decide which half to believe.
ALTER TABLE "Driver"
  ADD CONSTRAINT "Driver_off_duty_until_needs_off_duty"
  CHECK ("offDutyUntil" IS NULL OR "isOffDuty");

-- THE CREW, FROZEN ONTO THE STATEMENT.
--
-- "Team with JULIA HALL" prints under the driver whenever any line in the
-- period is a team line. It is stored rather than derived because a statement
-- is a document somebody was paid on: reading `Load.coDriverId` back at render
-- time would let a reassignment next year restate an issued cheque, which is
-- the same argument that freezes the city and the load number on every line
-- beside it.
--
-- Defaulted to empty, which is what every existing statement is: team driving
-- starts with this change and no closed history has a co-driver.
ALTER TABLE "Settlement"
  ADD COLUMN "teamWith" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ROSTER AND FREIGHT WERE ONE COLUMN. THEY WERE NEVER ONE FACT.
--
-- `Driver.status` carried six values and answered two unrelated questions.
-- Three of them — AVAILABLE, DISPATCHED, ON_ROUTE — describe what the freight
-- is doing, and item 11 now derives that on every read from the loads
-- themselves. A fourth, OFF_DUTY, describes something nobody can derive, which
-- is why item 11 gave it a column of its own.
--
-- Nothing in the application ever wrote DISPATCHED or ON_ROUTE. They were set
-- by hand on the edit form and then went stale the moment the load moved,
-- which is the whole reason a dispatcher could see "Dispatched" beside a
-- driver who delivered last Tuesday.
--
-- ── WHAT MOVES, AND WHAT IT BECOMES ──────────────────────────────────────
--
-- OFF_DUTY becomes the flag, INDEFINITELY. A return date is a fact nobody
-- recorded when the row was written, and inventing one would put drivers back
-- on the board on a date this migration made up. Indefinite is what the data
-- actually says, and clearing it is one tick on the driver's page.
UPDATE "Driver" SET "isOffDuty" = true WHERE "status" = 'OFF_DUTY';

-- DISPATCHED, ON_ROUTE and OFF_DUTY all become AVAILABLE, which from here
-- means "on the roster and working" rather than "free right now" — the
-- interface labels it Active. The freight answers the other question.
UPDATE "Driver"
   SET "status" = 'AVAILABLE'
 WHERE "status" IN ('DISPATCHED', 'ON_ROUTE', 'OFF_DUTY');

-- ── THE THREE VALUES STAY IN THE TYPE, AND THAT IS DELIBERATE ────────────
--
-- Postgres cannot drop an enum value; removing them means recreating the type
-- and rewriting the column, which is a rewrite of a table every settlement
-- points at to delete three strings no row holds any more.
--
-- So they are left unreachable instead, and the refusal lives where it can say
-- why: `src/lib/driver-roster.ts` lists the three the form offers, `fleet.ts`
-- refuses anything else by name, and `tests/driver-roster.test.ts` watches
-- that refusal fire. VACATION stays a roster value — a person on holiday is a
-- roster fact, and it is the one the badge exists to show.
--
-- VERIFY AFTER APPLYING (expect zero rows):
--   SELECT "status", count(*) FROM "Driver"
--    WHERE "status" IN ('DISPATCHED','ON_ROUTE','OFF_DUTY') GROUP BY 1;

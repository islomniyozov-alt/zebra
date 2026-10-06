-- MIGRATION 68 — THE RATE FIELD IS THE LINE HAUL: THE BACKFILL
--
-- §7.6 (v10.36), owner's ruling of 2026-10-06 from load 1177. Until this
-- migration's code the create form prefilled the rate field from the rate
-- confirmation's TOTAL and stored it as `linehaulCents`, so fuel and the
-- accessorial lines became line haul and PERCENT_LINEHAUL paid on them.
--
-- WHAT THIS TOUCHES, AND NOTHING ELSE: a hand-created load (externalId IS
-- NULL — every imported load carries one) whose NEWEST attached rate
-- confirmation stores parsed money with a line haul, whose parts AGREE with its
-- total (`totalAgrees` = true, decided by parse.ts when it read the document),
-- and whose stored line haul IS that total — the symptom, exactly. For each:
--   linehaulCents      <- the extraction's line haul
--   fuelSurchargeCents <- the extraction's fuel surcharge
--   one LoadAccessorial per accessorial line (billable, status PENDING, the
--                         printed label kept as the note, the type from the
--                         label's own words or OTHER — the same mapping as
--                         src/lib/rate-split.ts, written out here because a
--                         migration cannot import it)
--   accessorialsCents  <- the sum of those lines
--   totalRevenueCents  unchanged, and ASSERTED equal to the three summed.
--
-- A load whose rate con printed NO line haul is not touched and not guessed: it
-- is listed by `scripts/rate-split-gaps.mjs` into GAPS.md. Loads with no rate
-- con at all were typed by a person and are theirs.
--
-- STATEMENTS ARE UNTOUCHED AND SAID TO BE. A statement's pay lines are frozen
-- snapshots, and the workbench header's gross is the loads' billed total, which
-- this does not change — so every statement's net is captured before and
-- compared after, and a difference anywhere rolls the whole thing back.
--
-- MEASURED ON DEV BEFORE THIS WAS WRITTEN (scratchpad m68-probe.cjs, read-only):
--
--   hand-created loads: 16 — 15 with no rate-con money attached, 1 with
--   of that 1: has_linehaul 1 · has_total 1 · total_agrees 1 ·
--              stored_linehaul_equals_total 1 · stored_linehaul_equals_linehaul 0
--   the defect set: 1177 — stored 295750/295750, rc linehaul 245000, fuel 38750,
--              1 accessorial ("Detention (2 hrs)" 12000), agrees, 0 pay lines
--   rate cons with no line haul: none
--
-- So on dev this rewrites one load and inserts one accessorial row; the billed
-- total 295750 is the same number before and after.
--
-- NO BEGIN/COMMIT OF ITS OWN, like every migration before it: Prisma applies
-- the file in one transaction, so a RAISE below rolls back everything above it.

-- ── 0. WHAT EVERY STATEMENT NETS, BEFORE ──────────────────────────────────
CREATE TEMP TABLE m68_net_before AS
  SELECT "id", "netCents" FROM "Settlement";

-- ── 1. THE DEFECT SET, RESOLVED ONCE ──────────────────────────────────────
CREATE TEMP TABLE m68_split AS
  WITH rc AS (
    SELECT d."loadId",
           d."extractedJson"->'money' AS money,
           ROW_NUMBER() OVER (PARTITION BY d."loadId" ORDER BY d."uploadedAt" DESC) AS rn
      FROM "Document" d
     WHERE d."type" = 'RATE_CONFIRMATION'
       AND d."loadId" IS NOT NULL
       AND d."deletedAt" IS NULL
       AND d."extractedJson" ? 'money'
  )
  SELECT l."id" AS load_id,
         l."organizationId",
         l."totalRevenueCents" AS total_before,
         (rc.money->>'linehaulCents')::int      AS linehaul,
         COALESCE((rc.money->>'fuelSurchargeCents')::int, 0) AS fuel,
         rc.money->'accessorials'               AS lines
    FROM "Load" l
    JOIN rc ON rc."loadId" = l."id" AND rc.rn = 1
   WHERE l."externalId" IS NULL
     AND l."deletedAt" IS NULL
     AND (rc.money->>'linehaulCents') IS NOT NULL
     AND (rc.money->>'linehaulCents')::int >= 0
     AND (rc.money->>'totalAgrees') = 'true'
     AND l."linehaulCents" = (rc.money->>'totalCents')::int
     AND l."linehaulCents" <> (rc.money->>'linehaulCents')::int;

-- ── 2. THE ACCESSORIAL LINES, ONE ROW EACH ────────────────────────────────
-- `updatedAt` is Prisma's @updatedAt — set by the client, no database default —
-- so a row written in SQL names it.
INSERT INTO "LoadAccessorial" ("id", "loadId", "organizationId", "type", "amountCents", "isBillable", "status", "notes", "updatedAt")
SELECT
  'm68' || substr(md5(s.load_id || ':' || line.ordinality::text), 1, 22),
  s.load_id,
  s."organizationId",
  CASE
    WHEN lower(line.value->>'label') ~ 'detention'                      THEN 'DETENTION'
    WHEN lower(line.value->>'label') ~ 'layover'                        THEN 'LAYOVER'
    WHEN lower(line.value->>'label') ~ 'tonu|truck ordered not used'    THEN 'TONU'
    WHEN lower(line.value->>'label') ~ 'lumper'                         THEN 'LUMPER'
    WHEN lower(line.value->>'label') ~ 'extra stop|additional stop|stop[- ]off' THEN 'EXTRA_STOP'
    WHEN lower(line.value->>'label') ~ 'driver assist|driver unload|driver load' THEN 'DRIVER_ASSIST'
    WHEN lower(line.value->>'label') ~ 'redeliver'                      THEN 'REDELIVERY'
    WHEN lower(line.value->>'label') ~ 'storage'                        THEN 'STORAGE'
    WHEN lower(line.value->>'label') ~ 'fuel advance'                   THEN 'FUEL_ADVANCE_FEE'
    ELSE 'OTHER'
  END::"AccessorialType",
  (line.value->>'cents')::int,
  TRUE,
  'PENDING',
  line.value->>'label',
  now()
FROM m68_split s
CROSS JOIN LATERAL jsonb_array_elements(s.lines) WITH ORDINALITY AS line(value, ordinality)
WHERE (line.value->>'cents')::int > 0;

-- ── 3. THE FOUR COLUMNS ───────────────────────────────────────────────────
UPDATE "Load" l SET
  "linehaulCents"      = s.linehaul,
  "fuelSurchargeCents" = s.fuel,
  "accessorialsCents"  = COALESCE((SELECT SUM(a."amountCents") FROM "LoadAccessorial" a
                                    WHERE a."loadId" = l."id" AND a."isBillable"), 0)
FROM m68_split s
WHERE s.load_id = l."id";

-- ── 4. THE BILLED TOTAL IS THE SAME NUMBER, AND SO IS EVERY NET ───────────
DO $$
DECLARE
  broken_total integer;
  broken_net integer;
BEGIN
  SELECT COUNT(*) INTO broken_total
    FROM "Load" l JOIN m68_split s ON s.load_id = l."id"
   WHERE l."totalRevenueCents" <> s.total_before
      OR l."totalRevenueCents" <> l."linehaulCents" + l."fuelSurchargeCents" + l."accessorialsCents";
  IF broken_total > 0 THEN
    RAISE EXCEPTION 'migration 68: % load(s) would not keep their billed total — rolled back', broken_total;
  END IF;

  SELECT COUNT(*) INTO broken_net
    FROM "Settlement" s JOIN m68_net_before b ON b."id" = s."id"
   WHERE s."netCents" <> b."netCents";
  IF broken_net > 0 THEN
    RAISE EXCEPTION 'migration 68: % statement(s) changed net — rolled back', broken_net;
  END IF;
END $$;

DROP TABLE m68_split;
DROP TABLE m68_net_before;

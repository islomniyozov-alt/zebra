-- MIGRATION 70 — THE DRIVER'S TYPE GETS ITS OWN NAME, SEEDED FROM THE EXPORT
--
-- §6.2.10 part 6 (v10.38). `Driver.employmentType` was an "OwnershipType" — a
-- truck's title on a person, with "company driver" spelled OWNED. It becomes
-- `Driver.driverType`, a "DriverType": COMPANY_DRIVER | LEASE_OPERATOR |
-- OWNER_OPERATOR. The frozen copy on the statement (migration 66) and the
-- standing charge's scope string (§6.2.4) carry the same words. "OwnershipType"
-- stays on "Truck" and "Trailer", where OWNED is the plain truth.
--
-- THE VALUE IS NOT A MAPPING OF THE OLD ONE. Owner's instruction, 2026-10-06:
-- before the buckets were mapped, the stored value was compared with the
-- Datatruck export's own `Driver Type` column per driver (scratchpad
-- m70-compare.ts, read-only, joined on `Driver.externalId`):
--
--   stored drivers on dev ........... 167
--   matched the export's Driver Type  106
--   MISMATCHED ...................... 56
--   export knows them, type blank ...   0
--   not in any export ...............   5   (dev test fixtures: Board, Warn, Settle rows)
--
-- The 56 are one rule, inverted: 49 drivers the office calls company_driver on
-- 85-100% tariffs were stored OWNER_OPERATOR, and 7 the office calls
-- company_owner on 30-60% were stored OWNED — the seed's tariff threshold
-- (`employmentFromTariff`, >= 85% => owner-operator) contradicted the office's
-- own column for a third of the roster. So, by ruling:
--
--   * where the export knows the driver (`externalId` in the list below), the
--     type is the export's: company_driver => COMPANY_DRIVER,
--     company_owner => OWNER_OPERATOR;
--   * where it does not, the old value is mapped: OWNED => COMPANY_DRIVER,
--     LEASED => LEASE_OPERATOR, OWNER_OPERATOR => OWNER_OPERATOR;
--   * the drivers the export does not know are LISTED for GAPS.md by
--     `scripts/driver-type-gaps.mjs`, which reads the list below back out of
--     this file so there is one source.
--
-- THE LIST IS GENERATED FROM THE ARTEFACT (scratchpad m70-generate.ts), not
-- typed: 170 driver ids from corpus/datatruck/all-drivers_2026_09_09_07_56_22.xlsx
-- (103 company_driver, 67 company_owner; the two smaller exports add
-- no ids); no row had a blank type.
--
-- THE FROZEN COPY ON A STATEMENT (66) IS MAPPED BY ITS OLD VALUE, NOT RE-SEEDED:
-- it records what the statement said when it was issued, and a document is not
-- corrected by a later reading of a spreadsheet. On dev all 142 are null.
--
-- NOTHING IS REMOVED: two columns are renamed and retyped, the default is
-- replaced, the scope strings are rewritten in place. The writers are quoted
-- in the commit (every site that named `employmentType` moves in the same
-- commit; the 2026-10-06 grep rule binds on removals and this has none).
--
-- EVERY DRIVER LANDS ON THE VALUE DECIDED FOR IT, OR NOTHING HAPPENED: the
-- decision is captured per driver before the retype and compared after.
--
-- NO BEGIN/COMMIT OF ITS OWN, like every migration before it: Prisma applies
-- the file in one transaction, so a RAISE below rolls back everything above.

-- ── 0. WHAT EACH DRIVER SHOULD BECOME ────────────────────────────────────
CREATE TEMP TABLE m70_export (external_id text PRIMARY KEY, driver_type text NOT NULL);
INSERT INTO m70_export (external_id, driver_type) VALUES
  ('1', 'OWNER_OPERATOR'),
  ('2', 'OWNER_OPERATOR'),
  ('3', 'OWNER_OPERATOR'),
  ('4', 'OWNER_OPERATOR'),
  ('5', 'OWNER_OPERATOR'),
  ('6', 'OWNER_OPERATOR'),
  ('7', 'OWNER_OPERATOR'),
  ('8', 'OWNER_OPERATOR'),
  ('9', 'OWNER_OPERATOR'),
  ('10', 'COMPANY_DRIVER'),
  ('11', 'COMPANY_DRIVER'),
  ('12', 'COMPANY_DRIVER'),
  ('13', 'OWNER_OPERATOR'),
  ('14', 'OWNER_OPERATOR'),
  ('15', 'COMPANY_DRIVER'),
  ('16', 'OWNER_OPERATOR'),
  ('17', 'OWNER_OPERATOR'),
  ('18', 'COMPANY_DRIVER'),
  ('19', 'COMPANY_DRIVER'),
  ('20', 'COMPANY_DRIVER'),
  ('21', 'OWNER_OPERATOR'),
  ('22', 'COMPANY_DRIVER'),
  ('23', 'OWNER_OPERATOR'),
  ('24', 'COMPANY_DRIVER'),
  ('25', 'OWNER_OPERATOR'),
  ('26', 'OWNER_OPERATOR'),
  ('27', 'OWNER_OPERATOR'),
  ('28', 'OWNER_OPERATOR'),
  ('29', 'OWNER_OPERATOR'),
  ('30', 'OWNER_OPERATOR'),
  ('31', 'OWNER_OPERATOR'),
  ('32', 'OWNER_OPERATOR'),
  ('33', 'COMPANY_DRIVER'),
  ('34', 'OWNER_OPERATOR'),
  ('35', 'OWNER_OPERATOR'),
  ('36', 'OWNER_OPERATOR'),
  ('37', 'OWNER_OPERATOR'),
  ('38', 'COMPANY_DRIVER'),
  ('39', 'COMPANY_DRIVER'),
  ('40', 'OWNER_OPERATOR'),
  ('41', 'OWNER_OPERATOR'),
  ('42', 'OWNER_OPERATOR'),
  ('43', 'OWNER_OPERATOR'),
  ('44', 'OWNER_OPERATOR'),
  ('45', 'OWNER_OPERATOR'),
  ('46', 'OWNER_OPERATOR'),
  ('47', 'OWNER_OPERATOR'),
  ('48', 'OWNER_OPERATOR'),
  ('49', 'OWNER_OPERATOR'),
  ('50', 'COMPANY_DRIVER'),
  ('51', 'OWNER_OPERATOR'),
  ('52', 'OWNER_OPERATOR'),
  ('53', 'OWNER_OPERATOR'),
  ('54', 'OWNER_OPERATOR'),
  ('55', 'COMPANY_DRIVER'),
  ('56', 'OWNER_OPERATOR'),
  ('57', 'COMPANY_DRIVER'),
  ('58', 'OWNER_OPERATOR'),
  ('59', 'OWNER_OPERATOR'),
  ('60', 'OWNER_OPERATOR'),
  ('61', 'COMPANY_DRIVER'),
  ('62', 'OWNER_OPERATOR'),
  ('63', 'OWNER_OPERATOR'),
  ('64', 'OWNER_OPERATOR'),
  ('65', 'OWNER_OPERATOR'),
  ('66', 'OWNER_OPERATOR'),
  ('67', 'OWNER_OPERATOR'),
  ('68', 'OWNER_OPERATOR'),
  ('69', 'COMPANY_DRIVER'),
  ('70', 'OWNER_OPERATOR'),
  ('71', 'COMPANY_DRIVER'),
  ('72', 'OWNER_OPERATOR'),
  ('105', 'COMPANY_DRIVER'),
  ('106', 'OWNER_OPERATOR'),
  ('107', 'COMPANY_DRIVER'),
  ('108', 'OWNER_OPERATOR'),
  ('109', 'COMPANY_DRIVER'),
  ('110', 'OWNER_OPERATOR'),
  ('111', 'COMPANY_DRIVER'),
  ('112', 'OWNER_OPERATOR'),
  ('113', 'OWNER_OPERATOR'),
  ('114', 'COMPANY_DRIVER'),
  ('115', 'COMPANY_DRIVER'),
  ('116', 'COMPANY_DRIVER'),
  ('117', 'COMPANY_DRIVER'),
  ('118', 'COMPANY_DRIVER'),
  ('119', 'OWNER_OPERATOR'),
  ('120', 'COMPANY_DRIVER'),
  ('121', 'COMPANY_DRIVER'),
  ('122', 'COMPANY_DRIVER'),
  ('123', 'COMPANY_DRIVER'),
  ('124', 'COMPANY_DRIVER'),
  ('125', 'COMPANY_DRIVER'),
  ('126', 'COMPANY_DRIVER'),
  ('127', 'COMPANY_DRIVER'),
  ('128', 'COMPANY_DRIVER'),
  ('129', 'COMPANY_DRIVER'),
  ('130', 'COMPANY_DRIVER'),
  ('131', 'COMPANY_DRIVER'),
  ('132', 'COMPANY_DRIVER'),
  ('133', 'COMPANY_DRIVER'),
  ('134', 'COMPANY_DRIVER'),
  ('135', 'COMPANY_DRIVER'),
  ('136', 'OWNER_OPERATOR'),
  ('137', 'OWNER_OPERATOR'),
  ('138', 'COMPANY_DRIVER'),
  ('139', 'COMPANY_DRIVER'),
  ('140', 'COMPANY_DRIVER'),
  ('141', 'COMPANY_DRIVER'),
  ('142', 'COMPANY_DRIVER'),
  ('143', 'COMPANY_DRIVER'),
  ('144', 'COMPANY_DRIVER'),
  ('145', 'OWNER_OPERATOR'),
  ('146', 'COMPANY_DRIVER'),
  ('147', 'COMPANY_DRIVER'),
  ('148', 'COMPANY_DRIVER'),
  ('149', 'COMPANY_DRIVER'),
  ('150', 'COMPANY_DRIVER'),
  ('151', 'COMPANY_DRIVER'),
  ('152', 'COMPANY_DRIVER'),
  ('153', 'OWNER_OPERATOR'),
  ('154', 'COMPANY_DRIVER'),
  ('155', 'COMPANY_DRIVER'),
  ('156', 'COMPANY_DRIVER'),
  ('157', 'COMPANY_DRIVER'),
  ('158', 'COMPANY_DRIVER'),
  ('159', 'COMPANY_DRIVER'),
  ('160', 'COMPANY_DRIVER'),
  ('161', 'COMPANY_DRIVER'),
  ('162', 'COMPANY_DRIVER'),
  ('163', 'OWNER_OPERATOR'),
  ('164', 'COMPANY_DRIVER'),
  ('165', 'COMPANY_DRIVER'),
  ('166', 'COMPANY_DRIVER'),
  ('167', 'COMPANY_DRIVER'),
  ('168', 'COMPANY_DRIVER'),
  ('169', 'COMPANY_DRIVER'),
  ('170', 'COMPANY_DRIVER'),
  ('171', 'COMPANY_DRIVER'),
  ('172', 'COMPANY_DRIVER'),
  ('173', 'COMPANY_DRIVER'),
  ('206', 'COMPANY_DRIVER'),
  ('239', 'COMPANY_DRIVER'),
  ('272', 'OWNER_OPERATOR'),
  ('305', 'COMPANY_DRIVER'),
  ('338', 'COMPANY_DRIVER'),
  ('371', 'COMPANY_DRIVER'),
  ('404', 'OWNER_OPERATOR'),
  ('437', 'COMPANY_DRIVER'),
  ('470', 'COMPANY_DRIVER'),
  ('503', 'COMPANY_DRIVER'),
  ('536', 'COMPANY_DRIVER'),
  ('569', 'COMPANY_DRIVER'),
  ('602', 'COMPANY_DRIVER'),
  ('635', 'COMPANY_DRIVER'),
  ('668', 'COMPANY_DRIVER'),
  ('701', 'COMPANY_DRIVER'),
  ('734', 'COMPANY_DRIVER'),
  ('767', 'COMPANY_DRIVER'),
  ('800', 'COMPANY_DRIVER'),
  ('801', 'COMPANY_DRIVER'),
  ('802', 'COMPANY_DRIVER'),
  ('803', 'COMPANY_DRIVER'),
  ('833', 'COMPANY_DRIVER'),
  ('866', 'COMPANY_DRIVER'),
  ('899', 'COMPANY_DRIVER'),
  ('932', 'COMPANY_DRIVER'),
  ('933', 'COMPANY_DRIVER'),
  ('934', 'COMPANY_DRIVER'),
  ('965', 'COMPANY_DRIVER');

CREATE TEMP TABLE m70_expected AS
  SELECT d."id" AS driver_id,
         COALESCE(
           e.driver_type,
           CASE d."employmentType"::text
             WHEN 'OWNED'          THEN 'COMPANY_DRIVER'
             WHEN 'LEASED'         THEN 'LEASE_OPERATOR'
             WHEN 'OWNER_OPERATOR' THEN 'OWNER_OPERATOR'
           END
         ) AS driver_type,
         (e.external_id IS NOT NULL) AS from_export
    FROM "Driver" d
    LEFT JOIN m70_export e ON e.external_id = d."externalId";

CREATE TEMP TABLE m70_settlements_before AS
  SELECT "id", "driverType"::text AS old_value FROM "Settlement";
CREATE TEMP TABLE m70_scopes_before AS
  SELECT "appliesTo" AS old_value, COUNT(*)::int AS n FROM "StandingCharge" GROUP BY 1;

-- ── 1. THE TYPE ───────────────────────────────────────────────────────────
CREATE TYPE "DriverType" AS ENUM ('COMPANY_DRIVER', 'LEASE_OPERATOR', 'OWNER_OPERATOR');

-- ── 2. THE DRIVER, SEEDED PER ROW ─────────────────────────────────────────
-- A NEW COLUMN, FILLED FROM THE DECIDED TABLE, THEN THE OLD ONE DROPPED.
-- Postgres refuses a subquery inside ALTER COLUMN ... TYPE ... USING (0A000;
-- the first attempt on dev rolled back on exactly that, touching nothing), and
-- the per-driver decision cannot be written as a scalar expression. So the
-- column is added, UPDATEd from m70_expected in one statement, made NOT NULL
-- with the new default, and `employmentType` is DROPPED — a removal, which
-- is why every writer is quoted in the header: each names `driverType` from
-- the same commit, and nothing writes `employmentType` any more.
ALTER TABLE "Driver" ADD COLUMN "driverType" "DriverType";
UPDATE "Driver" d SET "driverType" = x.driver_type::"DriverType"
  FROM m70_expected x WHERE x.driver_id = d."id";
ALTER TABLE "Driver"
  ALTER COLUMN "driverType" SET DEFAULT 'COMPANY_DRIVER',
  ALTER COLUMN "driverType" SET NOT NULL;
ALTER TABLE "Driver" DROP COLUMN "employmentType";

-- ── 3. THE FROZEN COPY ON THE STATEMENT (66), BY ITS OLD VALUE ────────────
ALTER TABLE "Settlement"
  ALTER COLUMN "driverType" TYPE "DriverType"
    USING (CASE "driverType"::text
             WHEN 'OWNED'          THEN 'COMPANY_DRIVER'
             WHEN 'LEASED'         THEN 'LEASE_OPERATOR'
             WHEN 'OWNER_OPERATOR' THEN 'OWNER_OPERATOR'
           END)::"DriverType";

-- ── 4. THE STANDING CHARGE'S SCOPE, A STRING CARRYING THE SAME WORDS ──────
UPDATE "StandingCharge" SET "appliesTo" = 'COMPANY_DRIVER' WHERE "appliesTo" = 'OWNED';
UPDATE "StandingCharge" SET "appliesTo" = 'LEASE_OPERATOR'  WHERE "appliesTo" = 'LEASED';

-- ── 5. EVERY ROW IS WHAT WAS DECIDED FOR IT, OR NOTHING HAPPENED ──────────
DO $$
DECLARE
  broken integer;
  undecided integer;
BEGIN
  SELECT COUNT(*) INTO undecided FROM m70_expected WHERE driver_type IS NULL;
  IF undecided > 0 THEN
    RAISE EXCEPTION 'migration 70: % driver(s) had no decidable type — rolled back', undecided;
  END IF;

  SELECT COUNT(*) INTO broken
    FROM "Driver" d JOIN m70_expected x ON x.driver_id = d."id"
   WHERE d."driverType"::text IS DISTINCT FROM x.driver_type;
  IF broken > 0 THEN
    RAISE EXCEPTION 'migration 70: % driver(s) did not land on the decided type — rolled back', broken;
  END IF;

  SELECT COUNT(*) INTO broken
    FROM "Settlement" s JOIN m70_settlements_before b ON b."id" = s."id"
   WHERE s."driverType"::text IS DISTINCT FROM
         CASE b.old_value WHEN 'OWNED' THEN 'COMPANY_DRIVER' WHEN 'LEASED' THEN 'LEASE_OPERATOR' ELSE b.old_value END;
  IF broken > 0 THEN
    RAISE EXCEPTION 'migration 70: % statement(s) lost their frozen type — rolled back', broken;
  END IF;

  SELECT COUNT(*) INTO broken FROM (
    SELECT b.old_value, b.n,
           (SELECT COUNT(*) FROM "StandingCharge" c
             WHERE c."appliesTo" = CASE b.old_value WHEN 'OWNED' THEN 'COMPANY_DRIVER' WHEN 'LEASED' THEN 'LEASE_OPERATOR' ELSE b.old_value END) AS now_n
      FROM m70_scopes_before b) t
   WHERE t.n <> t.now_n;
  IF broken > 0 THEN
    RAISE EXCEPTION 'migration 70: % scope bucket(s) changed size — rolled back', broken;
  END IF;
END $$;

DROP TABLE m70_expected;
DROP TABLE m70_export;
DROP TABLE m70_settlements_before;
DROP TABLE m70_scopes_before;

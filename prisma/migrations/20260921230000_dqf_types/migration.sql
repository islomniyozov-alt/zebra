-- ITEM 13 — THE VOCABULARY 49 CFR 391.51 NEEDS AND ZEBRA DID NOT HAVE.
--
-- Five enum values and nothing else. No table, no column: the Driver
-- Qualification File is a CHECKLIST over records that already exist, and the
-- only thing missing was words for three of the eight items.
--
-- ── TWO COMPLIANCE TYPES, FOR THE ITEMS THAT EXPIRE ─────────────────────
--
-- ANNUAL_REVIEW is §391.25(b) — the carrier's recorded review of the MVR,
-- which is a SEPARATE obligation from obtaining it under §391.25(a). A carrier
-- that pulls the record and never reviews it has one of the two, and an audit
-- finds exactly that. MVR itself already exists in the enum.
--
-- CLEARINGHOUSE_QUERY is §382.701 — the FMCSA Drug & Alcohol Clearinghouse
-- query, at hire and annually. Nothing in the enum covered it; DRUG_TEST is a
-- test result, which is a different thing that happens to share a subject.
--
-- ── THREE DOCUMENT TYPES, FOR THE ITEMS THAT DO NOT ─────────────────────
--
-- An employment application does not expire. `ComplianceItem.expiresAt` is NOT
-- NULL, so filing one there would mean inventing a date that will eventually
-- raise or suppress an alarm about nothing. These three are documents, which
-- is what they are in the physical file too.
--
-- The item 13 brief authorised new ComplianceType values and said nothing
-- about DocumentType. Flagged in PHASE-5-BRIEF §7 as flag 13 rather than
-- quietly widened: without these three, five of the eight requirements have
-- nowhere to point and the definition cannot be written down at all.
--
-- ── ADD VALUE IS SAFE HERE, AND WOULD NOT BE IF ANYTHING USED IT ────────
--
-- Postgres 12+ permits ALTER TYPE ... ADD VALUE inside a transaction block,
-- which is what Prisma wraps a migration in — but the new value cannot be USED
-- until that transaction commits. This migration only declares them; the first
-- row carrying one is written by a person on a later day.
ALTER TYPE "ComplianceType" ADD VALUE IF NOT EXISTS 'ANNUAL_REVIEW';
ALTER TYPE "ComplianceType" ADD VALUE IF NOT EXISTS 'CLEARINGHOUSE_QUERY';

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'EMPLOYMENT_APPLICATION';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'EMPLOYMENT_VERIFICATION';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'ROAD_TEST_CERTIFICATE';

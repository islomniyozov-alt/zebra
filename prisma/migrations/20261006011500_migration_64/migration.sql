-- MIGRATION 64 — THE TWO DEFAULTS COME BACK, AND THE SCHEMA NOW DECLARES THEM
--
-- Migration 63 dropped the empty-array defaults on `Settlement.teamWith` and
-- `Settlement.referralWith`. The ruling to accept that rested on a premise written
-- into 63's own comment: "the application has always written both columns
-- explicitly." It had not — `settlements.ts` and every test fixture omit them —
-- and Prisma sends NOTHING for an omitted scalar list, so the database default was
-- the thing making those writes complete. The first integration run against 63
-- failed 23 cases across 11 files, every one of them a "Null constraint
-- violation" on `settlement.create`.
--
-- SO THE DATABASE WAS RIGHT AND THE SCHEMA DID NOT SAY SO — the same shape as the
-- two indexes 63 kept. This restores the defaults AND declares them with
-- `@default([])` in schema.prisma, so the drift cannot re-form and `migrate dev`
-- will never propose dropping them again.
--
-- 63 is already applied on production, so this follows it there as soon as it
-- can: between the two, any settlement created outside `refreshDraft` fails.
ALTER TABLE "Settlement" ALTER COLUMN "teamWith" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "referralWith" SET DEFAULT ARRAY[]::TEXT[];

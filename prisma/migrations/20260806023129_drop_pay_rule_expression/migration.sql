-- Drop the column nothing wrote.
--
-- `DriverPayRule.expression` was there for PayRuleType.CUSTOM: a small
-- sandboxed language for pay, evaluated by the engine. Step 6 refused CUSTOM
-- in words and flagged the column as dead weight; this removes it.
--
-- SAFE TO DROP because no code path in this repository has ever written it:
-- `git log -S expression -- src/` returns only the two commits that mention it
-- in prose, and grep finds no assignment anywhere. The column has been NULL on
-- every row since the schema was written.
--
-- THAT IS AN ARGUMENT ABOUT THE CODE, NOT ABOUT THE DATA. Before applying this
-- to production, run the count first and read the answer:
--
--   SELECT count(*) FROM "DriverPayRule" WHERE expression IS NOT NULL;
--
-- Zero, then apply. Anything else is a row somebody wrote by hand, and it
-- needs reading before it is destroyed.
--
-- CUSTOM stays in the enum. Dropping an enum member rewrites every row that
-- ever held it, and the refusal lives in driver-pay.ts where it can say why.

/*
  Warnings:

  - You are about to drop the column `expression` on the `DriverPayRule` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "DriverPayRule" DROP COLUMN "expression";

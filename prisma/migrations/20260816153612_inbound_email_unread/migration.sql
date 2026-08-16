-- AlterEnum
ALTER TYPE "InboundEmailState" ADD VALUE 'UNREAD';

-- NO GRANT NEEDED: this adds a value to an existing type, not a table.
-- "InboundEmail" already carries its own grants from 20260813150000.
--
-- ADD VALUE IS NOT TRANSACTIONAL-SAFE IF THE VALUE IS ALSO USED in the same
-- transaction. This migration only adds it; the first row written with it
-- comes later, from application code, in its own transaction. Postgres 12+
-- permits the add inside a transaction on that condition.

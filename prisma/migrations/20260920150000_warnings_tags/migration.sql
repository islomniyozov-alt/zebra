-- TAGS (item 9). Free text, org-scoped by the row's own organization,
-- filterable, imported from Datatruck's `Tags` column where present.
--
-- NO WARNINGS TABLE HERE, AND THAT IS THE POINT OF THE ITEM. Datatruck stores
-- a computed `Warnings` column on all three exports; Zebra derives warnings
-- from the facts it already has. A stored warning is a copy of a fact, and a
-- copy goes stale the moment the fact moves — a medical card that expired last
-- night sends no event, and a load whose driver was unassigned at 4pm does not
-- know it became urgent.
--
-- A STRING ARRAY RATHER THAN A TAG TABLE. A join table would buy a canonical
-- vocabulary and cost a join on every filtered list; the ruling asks for free
-- text that can be filtered, which this is. GIN because `tags @> ARRAY['x']`
-- over 14,464 loads is a scan without it.

ALTER TABLE "Driver" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Truck"  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Load"   ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "Driver_tags_idx" ON "Driver" USING GIN ("tags");
CREATE INDEX "Truck_tags_idx"  ON "Truck"  USING GIN ("tags");
CREATE INDEX "Load_tags_idx"   ON "Load"   USING GIN ("tags");

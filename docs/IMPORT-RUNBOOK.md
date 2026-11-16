# Import runbook — Datatruck loads, 2026-09-20 → today

## The brief

The owner's brief, 2026-11-16, transcribed before the runbook is written:

```
Task 1, written down now, commit it as docs/IMPORT-RUNBOOK.md first. Scope:
the Datatruck LOADS import only (scripts/seed-datatruck-loads.ts and whatever
it depends on), for the weeks from Sep 20 2026 to today that are not yet in
Zebra. Not remittance, not the in-app importers. Produce: (1) exactly what
Islom exports from Datatruck — screen, filters, date range Sep 20 2026 →
today, file type, where to save it under corpus/; (2) the one PowerShell line
to preview against production and the one to write, org
cmsbsc82y0000nsvsa6yffuyh named; (3) what the preview must print before write
is allowed; (4) what a re-run does if a week is imported twice — must be
nothing, read from the script, not assumed; (5) if the script can't take a
date-bounded export without code, say what's missing. Read each script, don't
run anything against a database. Unit tests only.
```

Everything below was read from `scripts/seed-datatruck-loads.ts`,
`scripts/datatruck-tenancy.ts` and `src/lib/datatruck/loads.ts` at `ffffaf8`,
and measured from the corpus files named — nothing was run against a
database. Where a line says "read", it cites the code; where it says
"measured", it names the file.

## STOP FIRST — two things the preview cannot show you

Read these before exporting anything. Neither is visible in the preview's
output, and the first one can double-pay a driver.

**1. Amazon freight already in Zebra from Relay files can be imported a
second time.** Since 2026-09-26 the Relay trips importer (in-app) books
completed Amazon trips as loads with `referenceNumber` = Amazon's **Trip ID**
and no `externalId` (`src/lib/trips-writer.ts:673`). This script finds such a
load only by an exact match of Datatruck's `Load ID` against that
`referenceNumber` (`seed-datatruck-loads.ts:624-644`, "THE BRIDGE"). Anything
that does not match exactly is CREATED as a new `DT-…` load beside the Relay
one — same freight, two loads, both seated, both settleable.

Measured from `corpus/datatruck/Trips - 2026-09-24T090710.426.csv`: 34 of 152
trips are multi-leg `T-…` trips, and on 82 of 200 rows the Trip ID differs
from the Load ID. Datatruck's `Load ID` is sometimes the `T-…` trip id (it
matches) and sometimes a bare load id (`11487PTPP` in
`corpus/datatruck-loads-2026-11-16.png`) — which, for a leg of a multi-leg
trip, does not. The corpus holds no Datatruck export and Relay file for the
same week, so how many rows collide cannot be measured from here.

The preview prints the bridge matches and one total of "loads created". It
does not split "created" by customer, and it does not look for a Relay load
with the same truck and delivery day. **So if any Relay trips file has been
imported for a week from 2026-09-20 on, `--write` is not allowed until that
is answered** — either by an export that leaves Amazon out (the screen in
the corpus screenshot shows no customer filter, so that may mean deleting
the Amazon rows from the file, which is itself a hand edit of an import's
input), or by a preview change that refuses a created Amazon
row in a week Zebra already holds Relay freight for. That is a code change and
is the owner's call; it is not in this runbook.

**2. A load the bridge enriched is synced, and can be re-priced, on the next
run.** The first run only adds missing fields to a bridged load, and sets its
`externalId` to the Shipment ID (`:1229`). From then on it is not "booked in
Zebra" any more: the bridge looks only at `externalId: null` (`:629`), so on
the next run the same row goes down the sync path (`:806-1006`), and its rate
is restated to Datatruck's figure unless a settlement line or payment
application already exists (`rateFreezeFor`, `loads.ts:1419`). See (4).

## (1) What to export from Datatruck

Measured from the two exports of 2026-09-24 for the same week, taken 14
minutes apart: `loads-and-trips_2026_09_24_16_35_06.xlsx` has 21 columns and
`…_16_49_51.xlsx` has 34. The export writes the columns that are switched on,
so the column step is not optional.

1. **Screen:** Load management → **Load + Trip**.
2. **Company picker** (top bar, left of search): **All**. The script maps
   five MC names to authorities (`AUTHORITY_BY_MC`, `loads.ts:643`); anything
   else is held by name, so a narrower picker only loses rows quietly.
3. **Tab:** **All Loads** — not Delivered, not Unpaid. Cancelled, in-transit
   and assigned rows are part of the sync.
4. **Filters:** **Delivery Time** = **Sep 20, 2026 → today**. Pickup Time
   empty, Load status empty. Delivery, not pickup, because the books cutover
   and the pay week are both decided on the delivery date
   (`BOOKS_CUTOVER`, `loads.ts:311`), and because a load picked up on the 19th
   and delivered on the 20th belongs to this range. A row the 13–19 export
   already brought in is matched on its Shipment ID and not created twice.
5. **Columns:** switch on every one of these. The names are the ones
   `planLoads` reads (`loads.ts:679-877`):

   `Shipment ID` · `Created date` · `Load ID` · `Customer` · `Driver/Carrier` ·
   `Co-Driver` · `Truck` · `MC Number` · `Pickup location` · `PU date` ·
   `Pickup company` · `Delivery location` · `Delivery state` ·
   `Delivery Appointment Time` · `DEL date` · `Delivery company` ·
   `Load status` · `Tag` · `Stops count` · `Load pay` · `Total other pay` ·
   `Total pay` · `Mile` · `Empty mile` · `Total miles` · `Equipment types`

   The 16:49 file carries all of them; match its columns. Without
   `Created date` and `PU date` every row is HELD ("neither Created date nor
   PU date will read", `:801-810`), which is loud. Without `Co-Driver`, `Tag`,
   `Mile` or `Empty mile` the rows import with those fields empty and NOTHING
   SAYS SO — that is the reason to check the list rather than trust the
   preview.

6. **Export** → the `.xlsx` Datatruck offers. Its name is
   `loads-and-trips_YYYY_MM_DD_HH_MM_SS.xlsx`; keep it.
7. **Save to** `C:\Users\Daler\Downloads\zebra\corpus\datatruck\` (the live
   tree; `corpus/` is gitignored and stays on this machine).
8. Write down the row count Datatruck shows for the filtered tab. The
   preview's first line has to equal it.

## (2) The two lines

From `C:\Users\Daler\Downloads\zebra`, in PowerShell. Replace `<FILE>` with
the saved file's name. Both run under the status wrapper; the verdict is the
`--check` line, never the console.

Preview against production — reads, writes nothing:

```powershell
node scripts/run-status.mjs dt-loads-preview -- npx tsx -r dotenv/config scripts/seed-datatruck-loads.ts corpus\datatruck\<FILE>.xlsx --production | Tee-Object -FilePath corpus\datatruck\<FILE>.preview.txt   # org cmsbsc82y0000nsvsa6yffuyh
```

Write to production — only after (3) is met on a preview of the same file:

```powershell
node scripts/run-status.mjs dt-loads-write -- npx tsx -r dotenv/config scripts/seed-datatruck-loads.ts corpus\datatruck\<FILE>.xlsx --production --write | Tee-Object -FilePath corpus\datatruck\<FILE>.write.txt   # org cmsbsc82y0000nsvsa6yffuyh
```

Then `node scripts/run-status.mjs --check dt-loads-write`.

**The organization is named in a comment, because the script takes no
organization argument.** It is pinned in the script as
`PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'` (`:152`), and
`--production` makes `assertTenancy` refuse unless the `zebra` slug resolves
to exactly that id (`datatruck-tenancy.ts:72-86`). Passing the id as an
argument makes the script refuse to start (a positional that is not `.xlsx`,
`chooseExport`, `loads.ts:1406`); passing it as `--org=…` would be silently
ignored. Neither is a check, so neither is in the line.

`--production` reads `PROD_DIRECT_DATABASE_URL` from `.env` (`:155`); it is
set there. The connection is the database owner and bypasses row-level
security — the tenancy refusal is the only guard (`datatruck-tenancy.ts:6-16`).

## (3) What the preview must print before `--write` is allowed

All of these, on a preview of the same file, run immediately before the
write. Anything else is a stop and a question, not a judgement call.

1. **The STOP FIRST section above is answered** — no Relay trips file
   imported for any week in range, or an answer to it from the owner.
2. `export  corpus\datatruck\<FILE>.xlsx (… bytes, N data rows)` — the file
   just saved, and **N equal to the row count noted in step 1.8**.
3. `TARGET: PRODUCTION`, `id   cmsbsc82y0000nsvsa6yffuyh` and
   `✓ matches the expected production organization`. The companies listed
   include all five authorities `AUTHORITY_BY_MC` maps to.
4. `RECONCILIATION` ends `— RECONCILED TO THE CENT`, or the difference equals
   the sum of the `HELD` rows plus the `TOTAL OTHER PAY HELD AS A DUPLICATE
CANCELLATION FEE` rows — added up by hand from the lists, not assumed.
5. `HELD — n rows`: every reason read. **Zero** "neither Created date nor PU
   date will read" (that is a missing column — re-export) and zero
   "authority … is not one this system operates under" unless the MC is
   known to be outside the group.
6. `DRIVER NAMES THAT RESOLVE TO NOTHING` and `… TO TWO ROWS` — **zero
   names**. Every row in range that is delivered, invoiced or paid lands
   live (`POD_RECEIVED`, `readStatus`, `loads.ts:192-205`); a live load with
   nobody in a seat is in no driver's settlement and the week still balances.
   Fix the roster first. Truck tables may be non-zero; each name read.
7. `CUSTOMER ALIASES`: both lines say `matched`. If either says
   `NO SUCH CUSTOMER` the script stops itself (`:560-568`).
8. `CUSTOMERS — … to create`: every name on the list is genuinely new — not
   a spelling of a customer in the "already on this database" list above it.
   Exact-name matching splits a broker in two otherwise (`:599-605`).
9. `CONTESTED — 0`. **Not "understood" — zero.** "REFUSED, none enriches
   it" means none of the rows enriches the live load; every one of them is
   then CREATED as a new `DT-…` load beside it (`toCreate` drops only the
   enriched references, `:668-672`). A contested reference is a live Zebra
   load plus two or more imported copies of its freight.
10. `WHAT THIS WOULD DO`: `loads created` + `already present` + `live loads
enriched` + `rows held` adds up to N — contested rows are inside
    `loads created`, not a bucket of their own — and
    `0  pay rules, settlements, invoices or payments`.
11. Ends `NOTHING WAS WRITTEN`, and `--check dt-loads-preview` prints OK.

After the write: `scripts/settlement-week-preflight.ts` for each week before
it is drafted — it asks the four questions that make a week wrong without
looking wrong.

## (4) A week imported twice

**Nothing is created twice. Money on an unfrozen load can still move.** Read
from the script, in order.

The key is the Shipment ID. `Load` has `@@unique([organizationId,
externalId])` (`schema.prisma:1614`), and every batch asks which of its
Shipment IDs are present before creating (`:763-793`). So **a second import
never creates a second load for a row the first import created.** That part
is nothing.

What it does to the rows that are present is the recurring sync, by design
(`:52-56`, "RE-RUNNING IS NOT A NO-OP ANY MORE"). On a load the first run
created, a second run of the **identical** file against an **unchanged**
database writes nothing — every rule below compares and finds no difference.
It writes when either side has moved:

- **Seats and truck** (`:813-864`): filled if NULL and the name now resolves
  to exactly one row. Never replaced.
- **Status** (`syncDecisionFor`, `loads.ts:968`): advanced forward only;
  backward is refused and listed. Closing to `CLOSED_IN_DATATRUCK` is always
  allowed. A closed load reopens only for a row delivered on or after
  2026-09-13. Each operational move writes an event dated by the export.
- **Rate** (`:902-1005`): restated to the export's figure whenever the two
  differ, unless the load is closed or has a settlement line or a payment
  application (`rateFreezeFor`). An **invoiced** load is not frozen. Each
  restatement deletes the `Datatruck "Total other pay".` accessorial row,
  writes a new one, and records a BILLING event naming old and new.

Three ways the identical file still writes on a second run:

1. **A remittance landed between the two runs.** The duplicate-cancellation
   rule reads Amazon's `TONU` rows at run time (`:233-262`). A row booked
   with its other pay on the first run is planned with other pay 0 on the
   second, and its accessorial is restated to 0 unless frozen.
2. **Someone added a billable accessorial in Zebra.** `accessorialsCents`
   then differs from the export, so the rate is restated to the export's
   figure — but only the Datatruck-noted row is deleted, so the Zebra row
   survives and the column no longer equals the sum of the rows
   (`:920-985`). Unless frozen.
3. **A bridged load** (STOP FIRST, 2). The first run enriches it; the second
   run syncs it, and re-prices it to Datatruck's figure unless frozen.

So "a week twice is nothing" holds for creation and does not hold for money
on unfrozen loads. Making it hold is a code change: freeze the rate on any
load the bridge enriched, and on any load past `UNINVOICED`. That is the
owner's call.

## (5) A date-bounded export

**No code is missing for the date bound.** `planLoads` reads every row of the
file it is given and applies no date window of its own (`loads.ts:656-881`);
the date bound is entirely the export's filter. It has done this before:
`loads-and-trips_2026_09_24_16_49_51.xlsx` is one week — 185 rows, PU and DEL
dates 2026-09-13 → 2026-09-19 (measured), with the full column set. Whether
it is the file production's 13–19 week was imported from is not recorded in
the repository; the script's comments cite "the 2026-09-13..19 export on
production" without a file name.

What a bounded export does need is in (1) step 5, the columns, and in STOP
FIRST, the Relay overlap. The overlap is the missing piece, and it is the
reason this runbook does not end with a green light.

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

And the ruling on the first version of this runbook, the same day:

```
(1) the preview refuses any export row whose Load ID or Trip ID matches a
load already in Zebra by either Shipment ID, Relay Trip ID or reference, and
prints them by name under REFUSED — never created; (2) on a matched load that
is invoiced, settled or paid, the import never changes the rate; it prints
the difference under RATE HELD. One predicate for "already in Zebra", unit
tests with fixtures from the 09-24 files, each guard watched failing.
Runbook updated to match.
```

And on the case the second version left open:

```
Ruling on 4a: the import never changes money on a load that Zebra touched
after creation — any user edit in the audit log or any Zebra-added line —
same RATE HELD path.
```

Everything below was read from `scripts/seed-datatruck-loads.ts`,
`scripts/datatruck-tenancy.ts` and `src/lib/datatruck/loads.ts` as of the
commit that built that ruling, and measured from the corpus files named —
nothing was run against a database. Code is cited by function or by the
heading the script prints, not by line number, so the citations survive the
next edit.

## What changed with the ruling, and why

The first version of this runbook ended with two stops. Both are closed in
code now; this is the record of what they were.

**Amazon freight already in Zebra was imported a second time.** Since
2026-09-26 the Relay trips importer books completed Amazon trips with
`referenceNumber` = the **Trip ID** and each leg's **Load ID** on its arrival
stop (`trips-writer.ts`, `trips-import.ts`). The loads import used to find
such a load only by an exact match of Datatruck's `Load ID` against the
load's `referenceNumber` — "the bridge" — and CREATED everything else.
Measured from `corpus/datatruck/Trips - 2026-09-24T090710.426.csv`: 34 of
152 trips are multi-leg, and on 82 of 200 rows the Trip ID differs from the
Load ID. A Datatruck row carrying one leg's Load ID therefore became a second
load for the same freight, both seated, both settleable.

**A load the bridge matched could be re-priced on the next run.** The bridge
wrote the Shipment ID into the matched load's `externalId`, after which every
re-run synced it as if this import had created it — and restated its rate to
Datatruck's figure unless a settlement line or payment application existed.
An invoiced load was not frozen.

**Now:** `alreadyInZebra` (in `src/lib/datatruck/loads.ts`) is the one
predicate. For each export row:

| What it finds                                                                                       | What happens                                                        |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `Load ID` or `Trip ID` equals another load's `referenceNumber`, or any stop's `referenceNumber`     | **REFUSED** — printed by name, never created, nothing written to it |
| Only its own load, by Shipment ID = `externalId` (its own `Load ID` on its own load does not count) | synced forward, as before                                           |
| Nothing                                                                                             | created                                                             |

A row that has its own load AND matches another load is refused: that is a
duplicate which already exists, and it is named rather than synced further.
Keys compare exactly after case and whitespace (`nameKey`), never nearest.
The bridge's enrichment is gone with it — a refused row writes nothing.

`rateDecisionFor` decides the money on every synced load, in the preview and
in the write: restated only when the load is not invoiced, settled, paid or
touched in Zebra. Otherwise the difference is printed under **RATE HELD**.
Invoiced is an `InvoiceLine` or billing at `INVOICED`, `FILED_WITH_FACTOR`,
`DISPUTED` or `WRITTEN_OFF`; paid is a payment application or `PAID` /
`PARTIALLY_PAID`; settled is a `SettlementLine` or a `SettlementLoadLine`.
Touched is any audit row on the load other than its CREATE — only a person's
write leaves one, because this script runs with no audit scope and writes
none — or any accessorial row other than the import's own
`Datatruck "Total other pay".` row. Closed history is held without being
listed.

## (1) What to export from Datatruck

Measured from the two exports of 2026-09-24 for the same week, taken 14
minutes apart: `loads-and-trips_2026_09_24_16_35_06.xlsx` has 21 columns and
`…_16_49_51.xlsx` has 34. The export writes the columns that are switched on,
so the column step is not optional.

1. **Screen:** Load management → **Load + Trip**.
2. **Company picker** (top bar, left of search): **All**. The script maps
   five MC names to authorities (`AUTHORITY_BY_MC`); anything else is held
   by name, so a narrower picker only loses rows quietly.
3. **Tab:** **All Loads** — not Delivered, not Unpaid. Cancelled, in-transit
   and assigned rows are part of the sync.
4. **Filters:** **Delivery Time** = **Sep 20, 2026 → today**. Pickup Time
   empty, Load status empty. Delivery, not pickup, because the books cutover
   and the pay week are both decided on the delivery date (`BOOKS_CUTOVER`),
   and because a load picked up on the 19th and delivered on the 20th
   belongs to this range. A row an earlier export already brought in is
   matched on its Shipment ID and not created twice.
5. **Columns:** switch on every one of these. The names are the ones
   `planLoads` reads:

   `Shipment ID` · `Created date` · `Load ID` · `Customer` · `Driver/Carrier` ·
   `Co-Driver` · `Truck` · `MC Number` · `Pickup location` · `PU date` ·
   `Pickup company` · `Delivery location` · `Delivery state` ·
   `Delivery Appointment Time` · `DEL date` · `Delivery company` ·
   `Load status` · `Tag` · `Stops count` · `Load pay` · `Total other pay` ·
   `Total pay` · `Mile` · `Empty mile` · `Total miles` · `Equipment types`

   The 16:49 file carries all of them; match its columns. `Trip ID` is read
   too when Datatruck offers it — switch it on if the Columns list has it;
   neither 09-24 file carried it. Without `Created date` and `PU date` every
   row is HELD ("neither Created date nor PU date will read"), which is
   loud. Without `Co-Driver`, `Tag`, `Mile` or `Empty mile` the rows import
   with those fields empty and NOTHING SAYS SO — that is the reason to check
   the list rather than trust the preview.

6. **Export** → the `.xlsx` Datatruck offers. Its name is
   `loads-and-trips_YYYY_MM_DD_HH_MM_SS.xlsx`; keep it.
7. **Save to** `C:\Users\Daler\Downloads\zebra\corpus\datatruck\` (the live
   tree; `corpus/` is gitignored and stays on this machine).
8. Write down the row count Datatruck shows for the filtered tab. The
   preview's first line has to equal it.

## (2) The two lines

From `C:\Users\Daler\Downloads\zebra`, in PowerShell, once the ruling's
commit is on `main` there. Replace `<FILE>` with the saved file's name. Both
run under the status wrapper; the verdict is the `--check` line, never the
console.

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
`PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'`, and
`--production` makes `assertTenancy` refuse unless the `zebra` slug resolves
to exactly that id ("REFUSING TO WRITE"). Passing the id as an argument makes
the script refuse to start (a positional that is not `.xlsx`,
`chooseExport`); passing it as `--org=…` would be silently ignored. Neither is
a check, so neither is in the line.

`--production` reads `PROD_DIRECT_DATABASE_URL` from `.env`; it is set there.
The connection is the database owner and bypasses row-level security — the
tenancy refusal is the only guard (`datatruck-tenancy.ts`).

## (3) What the preview must print before `--write` is allowed

All of these, on a preview of the same file, run immediately before the
write. Anything else is a stop and a question, not a judgement call.

1. `export  corpus\datatruck\<FILE>.xlsx (… bytes, N data rows)` — the file
   just saved, and **N equal to the row count noted in step 1.8**.
2. `TARGET: PRODUCTION`, `id   cmsbsc82y0000nsvsa6yffuyh` and
   `✓ matches the expected production organization`. The companies listed
   include all five authorities `AUTHORITY_BY_MC` maps to.
3. `RECONCILIATION` ends `— RECONCILED TO THE CENT`, or the difference equals
   the sum of the `HELD` rows plus the
   `TOTAL OTHER PAY HELD AS A DUPLICATE CANCELLATION FEE` rows — added up by
   hand from the lists, not assumed. (The reconciliation is of the file
   against what `planLoads` plans; REFUSED rows are still inside it.)
4. `HELD — n rows`: every reason read. **Zero** "neither Created date nor PU
   date will read" (that is a missing column — re-export) and zero
   "authority … is not one this system operates under" unless the MC is
   known to be outside the group.
5. The `REFUSED — n row(s) …; never created` list: every line read. Each
   names the row, the column that matched, the
   key, the Zebra load number and whether it matched the load's reference or
   a stop's. Expect Amazon rows here for any week a Relay trips file
   covered — that is the guard working. A refused row that is NOT the same
   freight as the load it names (a broker's PU number that happens to equal
   a Load ID, say) is a question for the owner before the write, because
   that row will not be imported.
6. `DRIVER NAMES THAT RESOLVE TO NOTHING` and `… TO TWO ROWS` — **zero
   names**. Every row in range that is delivered, invoiced or paid lands
   live (`POD_RECEIVED`, `readStatus`); a live load with nobody in a seat is
   in no driver's settlement and the week still balances. Fix the roster
   first. Truck tables may be non-zero; each name read. (These tables count
   only rows the predicate lets through.)
7. `CUSTOMER ALIASES`: both lines say `matched`. If either says
   `NO SUCH CUSTOMER` the script stops itself.
8. `CUSTOMERS — … to create`: every name on the list is genuinely new — not
   a spelling of a customer in the "already on this database" list above it.
   Exact-name matching splits a broker in two otherwise.
9. The `RATE HELD — n matched load(s) …` list: every line read. Each starts
   with why — `invoiced`, `settled`,
   `paid` or `touched` — and shows the export figure and Zebra figure side by
   side. Nothing on it is
   written; the list is for somebody to decide whether Zebra or Datatruck is
   right.
10. `WHAT THIS WOULD DO`: the four counts `loads created`, `already present`,
    `rows refused` and `rows held` add up to N, and the line
    `0  pay rules, settlements, invoices or payments` is there. For a range no
    earlier Datatruck import covered, `already present` and
    `rates restated on matched loads` are both expected to be **0**; anything
    else means an earlier export reached into the range, and each restatement
    is a rate change on a live load — ask before writing.
11. Ends `NOTHING WAS WRITTEN`, and `--check dt-loads-preview` prints OK.

After the write: `scripts/settlement-week-preflight.ts` for each week before
it is drafted — it asks the four questions that make a week wrong without
looking wrong.

## (4) A week imported twice

**Nothing is created twice, and no load that is invoiced, settled, paid or
touched in Zebra is re-priced. Money moves only on a load nobody in Zebra has
written to since the import made it — by design, because Datatruck owns that
rate.** Read from the script.

The key is the Shipment ID. `Load` has `@@unique([organizationId,
externalId])`, every batch asks which of its Shipment IDs are present before
creating, and `alreadyInZebra` sends a row with its own load down the sync
path rather than the create path. So **a second import never creates a
second load for a row the first import created**, and a row whose freight is
under another load is refused both times.

What the sync does to a row's own load (`syncDecisionFor`, `crewFillFor`,
`rateDecisionFor`): on an **identical** file against an **unchanged**
database it writes nothing — every rule compares and finds no difference. It
writes when either side has moved:

- **Seats and truck:** filled if NULL and the name now resolves to exactly
  one row. Never replaced.
- **Status:** advanced forward only; backward is refused and listed. Closing
  to `CLOSED_IN_DATATRUCK` is always allowed. A closed load reopens only for a
  row delivered on or after 2026-09-13. Each operational move writes an event
  dated by the export.
- **Rate:** restated to the export's figure when the two differ AND the load
  is not invoiced, settled, paid, touched or closed. Otherwise printed under
  RATE HELD, unwritten. A restatement deletes the `Datatruck "Total other pay".`
  accessorial row, writes a new one, and records a BILLING event naming old
  and new.

The two cases the earlier versions of this section named as "an identical
file still writes" are both held now, under RATE HELD as `touched`:

1. **A remittance landed between the two runs.** The remittance importer's
   `TONU` row is an accessorial the import did not write, so the load is
   touched and its other pay is not restated to 0. The difference prints.
2. **Someone added a billable accessorial in Zebra.** Touched, for the same
   reason; the column is left equal to the sum of its rows.

So on a second run of the identical file, the only money that can move is on
a load whose Datatruck figure changed between the exports and that nobody in
Zebra has written to.

**One case predates the rulings.** A Relay load the old bridge already
matched carries a `DT-…` `externalId` from that run. To the predicate it is
that row's own load, so it is synced. It is frozen if invoiced, settled, paid
or touched — and a Relay load uploaded in the app is normally touched,
because the upload seats the driver after landing the load, inside the
uploader's attributed scope. "Normally" is a reading of `trips-writer.ts`,
not a count: which production loads carry such an `externalId`, and whether
any of them has no audit row beyond its CREATE, is a read-only question for
production (an `externalId` beginning `DT-` on a load whose `loadNumber` does
not). It was not asked from here.

## (5) A date-bounded export

**No code is missing for the date bound.** `planLoads` reads every row of the
file it is given and applies no date window of its own; the date bound is
entirely the export's filter. `loads-and-trips_2026_09_24_16_49_51.xlsx` is
one week — 185 rows, PU and DEL dates 2026-09-13 → 2026-09-19 (measured),
with the full column set. Whether it is the file production's 13–19 week was
imported from is not recorded in the repository; the script's comments cite
"the 2026-09-13..19 export on production" without a file name.

What a bounded export does need is (1) step 5, the columns. The Relay
overlap that held the first version of this runbook back is now the REFUSED
list in (3) item 5.

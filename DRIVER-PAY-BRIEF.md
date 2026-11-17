# Driver Pay in Datatruck's shape — brief (step 0)

_Owner's brief, 2026-11-17. Written by the second session on `work/second`;
nothing below is built. This is the map and the list of rulings Islom has to
make before step 1 starts._

**The artefacts:** four screenshots of Datatruck's Driver Pay, the screens
Uktam uses every day:

| file                                                   | screen                                      |
| ------------------------------------------------------ | ------------------------------------------- |
| `corpus/datatruck-driver-pay-2026-11-17-batches.png`   | Payroll → Driver Pay → Batches list         |
| `corpus/datatruck-driver-pay-2026-11-17-create.png`    | Create batch (RAM Haulage, 11/08–11/14)     |
| `corpus/datatruck-driver-pay-2026-11-17-batch.png`     | Batch SB-000468, RAM Haulage, 25 statements |
| `corpus/datatruck-driver-pay-2026-11-17-statement.png` | Statement ST-005935, inside SB-000468       |

**What does not move: the engine's money rules.** `batchInputForOrg`,
`computeBatch` and `computeDriverSettlement`, the pay rules, `grossFor`, the
deductions engine and the column meanings of §6.2.2 v10.x ("the batch engine's
meaning is the meaning") all stay exactly as they are. This brief is about
shape and workflow only. Every figure a new screen shows is a column a
statement already stores, or a sum of those columns.

**The finding that frames the rest:** most of this has already been built.
§6.2.10 ("Payroll takes Datatruck's shape", 2026-10-05) and §6.2.2 (the
settlement workbench, 2026-09-29, against ST-005562) were written from the same
system. Today Zebra has:

- batches per authority (`SettlementBatch.companyId`, one per company per week);
- the trip grid with the tick as an exclusion;
- the derived batch status DRAFT → PARTIAL → FINAL → PAID;
- the SB-/ST- numbering;
- the statement workbench with fuel, tolls, charges and send-to-driver.

What is left is mostly vocabulary, layout and a handful of missing verbs. The
four screens below say which part is which.

---

## 1. The Batches list — `/payroll/batches`

| Datatruck                                                       | Zebra today                                                                                                                                              | Gap                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Batch ID (SB-000469)                                            | `batchNumber` via `batchNumberOf`, the same SB-000000 series                                                                                             | none                                           |
| Post status: Partial posted / Posted                            | `status`: Draft / Partial / Final / Paid (`batchStatus.*`)                                                                                               | **words** (§5)                                 |
| Created by                                                      | no column. Batch creation IS audited (`audit.ts` audits every model but four), so an `AuditLog` CREATE row names the user                                | **R4**                                         |
| Created date                                                    | `created`, hidden by default                                                                                                                             | shown by default?                              |
| Check date                                                      | `checkDate`, derived by `checkDateFor(period)`                                                                                                           | editable in Datatruck (pencil), **R9**         |
| Period                                                          | `period`                                                                                                                                                 | none                                           |
| Settlements                                                     | `statements`                                                                                                                                             | none                                           |
| Amount                                                          | `amount` (net)                                                                                                                                           | none                                           |
| Pay company                                                     | `payCompany`                                                                                                                                             | Islom's word is "Authority"; the label only    |
| Notes                                                           | `notes`, hidden by default                                                                                                                               | none                                           |
| —                                                               | `gross`, `deductions` (§6.2.9, shown)                                                                                                                    | Datatruck has neither. Hide by default? **R5** |
| Create new batch                                                | → `/payroll/batches/new`                                                                                                                                 | none                                           |
| Delete (unposted only)                                          | **nothing.** `SettlementBatch.deletedAt` exists; no verb writes it                                                                                       | **R6**                                         |
| Change status                                                   | `BulkStatus` + `changeStatusAction` on the list                                                                                                          | collides with "status is derived", **R7**      |
| Export, Columns                                                 | §7.1.5 export, §7.1.4 chooser                                                                                                                            | none                                           |
| Tabs: Batches · Driver Statements · Balances · One-time charges | the page has two tabs (batches, balances). Driver statements (`/payroll/statements`) and charges (`/payroll/charges`) are their own routes under Payroll | one tab strip over three routes, **R10**       |

The `PARTIAL` badge already wears `--z-warning`. Datatruck's is teal and its
Posted badge is purple. Zebra keeps its own tokens (§3.3); only the words
change.

## 2. Create batch — `/payroll/batches/new`

| Datatruck                                                                                                                                                         | Zebra today                                                                                                                    | Gap                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| MC number (one authority)                                                                                                                                         | authority chip. Optional: none = the whole organization (§6.2.10 part 1)                                                       | required? **R2**                           |
| Date from / Date to (11/08/2026–11/14/2026, Sunday to Saturday)                                                                                                   | from/to SHOW the week. `openBatch` refuses anything that is not a settlement week (`not_a_week`)                               | **R1**                                     |
| Time: Delivery time                                                                                                                                               | basis selector, "Delivery time" its only option (§6.2.10 part 1)                                                               | none                                       |
| Grid: ID · Payee · Driver type · Load id · Status · Sub status · Load pay · Pickup date · Delivery date · Pickup location · Delivery location · Pay · Driver note | nine: ID · payee · driver type · load ref · status · load pay · pickup · delivery · locations                                  | **driver pay per trip** is missing, **R3** |
| "Available trips (148)" group                                                                                                                                     | available group, plus the unavailable buckets by reason ("16 in transit · 5 outside the week…")                                | Zebra says more; keep                      |
| Select all available trips · Add 148 trips                                                                                                                        | checkboxes default ticked, and the tick is an EXCLUSION (§6.2.10 part 2); Create opens the batch with one statement per driver | none: same act                             |

Islom's brief asks for "every delivered trip in that window not yet in a
batch". That is `previewBatch`'s available set with no change. The precedence
of "not available" (in transit · outside the week · already on a statement · no
driver · no rule) stays `previewFrom`'s.

## 3. Batch detail — `/settlements/batches/[id]`

What the route serves today (§6.2.10 part 2b), top to bottom:

1. The header: batch number, status, statement date and check date.
2. Refresh / Finalise / Mark paid.
3. Blockers by name.
4. **The trip grid with ticks.**
5. A six-column statements table (driver · statement · loads · earnings ·
   deductions · net).
6. Held lines and negative nets.

Datatruck leads with the statements and has no trip grid on this screen.

| Datatruck                                                                                                                                                                                  | Zebra today                                                                                                                                                                                                                        | Gap                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Tabs: All / Unposted / Posted / Paid                                                                                                                                                       | none                                                                                                                                                                                                                               | a filter over the statements, by the §5 words                           |
| Table: ID · Driver type · Assigned truck · Payee · Accounting · Status · Trips · Payment tariff · Total pay · Total gross · Net pay                                                        | six columns. Every figure is stored on `Settlement`: `driverType` (frozen, migration 66), `unitNumber`, `payToName`, `status`, the load-line count, `payTariffLabel` ("90% from gross"), `grossCents`, `earningsCents`, `netCents` | ten columns, over §7.1's nine, **R11**; "Total pay" means what, **R12** |
| Send (selected)                                                                                                                                                                            | `sendStatementToDriver`, one statement at a time from the statement page                                                                                                                                                           | bulk send, **R13**                                                      |
| Post (selected)                                                                                                                                                                            | `statementBulkAction('post')` exists on `/payroll/statements`; `finaliseBatch` posts every draft                                                                                                                                   | wire the bulk bar here; no new verb                                     |
| Add driver                                                                                                                                                                                 | **no equivalent.** A batch is "everything settleable in the week minus exclusions", so a driver appears when they have freight                                                                                                     | **R14**                                                                 |
| Add trip                                                                                                                                                                                   | un-ticking or re-ticking on the grid (`includeTrips`); per statement, `addTripsToSettlement` through `addableTrips`                                                                                                                | where the grid lives, **R11**                                           |
| Add deduction                                                                                                                                                                              | one-time charge (`SettlementCharge`, `/payroll/charges` → AddCharge) per driver and week; per statement, ChargeGrid                                                                                                                | a panel on the batch for the selected statements; no new verb           |
| Right rail, General: created by · pay by · date · week number                                                                                                                              | authority and statement date stored; created by → R4; **week number nowhere**                                                                                                                                                      | **R8**                                                                  |
| Right rail, Totals: trip counts · settlements · unposted/posted · period · check date · total gross · total pay · earnings · other pays · reimbursements · deductions · advances · net pay | every figure is a sum over the batch's non-void statements' stored columns (`grossCents`, `earningsCents`, `otherPayCents`, `reimbursementsCents`, `deductionsCents`, `advancesCents`, `netCents`)                                 | read only; no money computed                                            |
| Editable until Posted; Posted locks it                                                                                                                                                     | per statement: an APPROVED statement is a document (number minted, approver named) and a refresh rebuilds only DRAFTs (part 3)                                                                                                     | same rule                                                               |
| Delete only while Unposted                                                                                                                                                                 | nothing (see §1)                                                                                                                                                                                                                   | **R6**                                                                  |

**The batch's held lines and blockers stay.** They come from
`batchInputForOrg` and are the engine's own warnings. Datatruck has nothing like
them, and dropping them to match would hide a refusal about somebody's wages.
Where they go on the new layout is part of R11.

## 4. Statement detail — `/settlements/[id]`

§6.2.2 already gives this page Datatruck's action row and a header box built
against ST-005562. What differs is the box: Zebra has one dense block of
label:value pairs, and Datatruck now has four cards.

| Datatruck card / tab                                                                                                  | Zebra source                                                                                                                                                    | Gap                                              |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Settlement Summary**: driver · settlement ‹ › · date ‹ › · driver type                                              | driver; number (minted at post); ‹ › from `statementNeighbours` (in the head CTE); period; frozen `driverType`                                                  | layout only                                      |
| **Earnings Summary**: earnings · other pays / reimbursements · deductions / advances · net pay                        | `earningsCents`, `otherPayCents` / `reimbursementsCents`, `deductionsCents` / `advancesCents`, `netCents`                                                       | layout only                                      |
| **Fuel & Balances**: balances · fuel · toll · payment tariff                                                          | balances: `DriverOpeningBalance` + `DriverEscrowEntry` (the Balances review link); fuel and toll: `fuelAndTollsFor` (in the head CTE); tariff: `payTariffLabel` | layout only                                      |
| **Trip Summary**: total pay · total gross · trip count · total miles / RPM                                            | `grossCents`, load-line count, `milesHundredths`. **RPM is not shown anywhere today**                                                                           | RPM's numerator, **R15**                         |
| Tabs: Trips · Fuel · Toll · Balances · Recurrent Charges · One-Time Charge · Scheduled Payments · Attachments & Notes | Zebra stacks them: the trips grid (`SettlementLoadLine`), three ChargeGrids, fuel/toll rows, the notes and documents sections                                   | tabs or stacked, **R16**                         |
| Post                                                                                                                  | `approveSettlementAction`                                                                                                                                       | none                                             |
| Deduction tariff / Add deduction                                                                                      | "Add charges" (`addLineAction`, ChargeGrid)                                                                                                                     | the label only                                   |
| Send to driver                                                                                                        | `sendToDriverAction` → `sendStatementToDriver` (statement PDF, existing)                                                                                        | none                                             |
| Download                                                                                                              | Export PDF, drafts watermarked (§6.2.2)                                                                                                                         | none                                             |
| Trips tab: Add trips · Recalculate trips · Delete (selected trips)                                                    | `addTripsAction`, `recalculateAction`; removing a trip from a batch draft is an exclusion (`excludeTrips`)                                                      | Delete wired to the exclusion, not a second verb |

Islom's brief says to show only the tabs "with data in Zebra". Read as
"concepts Zebra stores", every Datatruck tab has a source: fuel, toll, balances,
recurring (`RecurringDeduction` + `StandingCharge`), one-time
(`SettlementCharge`), scheduled (the standing charges in force that week) and
attachments (`Document` on the settlement). Read as "rows on this statement",
the tab strip changes from statement to statement. That is part of R16.

## 5. The status mapping — one function, tested

Islom's words go on every payroll screen, keyed by the stored value. They come
from one pure function in `src/lib/` (step 1), with a test that walks every
enum value. That way a fifth status cannot render blank, the failure the
`STATUS` map in `payroll/batches/page.tsx` was written against.

| stored                          | statement word | batch word     |
| ------------------------------- | -------------- | -------------- |
| `SettlementStatus.DRAFT`        | Unposted       | —              |
| `SettlementStatus.APPROVED`     | Posted         | —              |
| `SettlementStatus.PAID`         | Paid           | —              |
| `SettlementStatus.VOID`         | **R17**        | —              |
| `SettlementBatchStatus.DRAFT`   | —              | Unposted       |
| `SettlementBatchStatus.PARTIAL` | —              | Partial posted |
| `SettlementBatchStatus.FINAL`   | —              | Posted         |
| `SettlementBatchStatus.PAID`    | —              | Paid           |

The batch column is what Islom's statement mapping implies, given that
`deriveBatchStatus` already counts statements: none posted → Unposted, some →
Partial posted, all → Posted, all paid → Paid. **No enum is renamed.** The words
are labels, the stored values stay, and `deriveBatchStatus` does not change.
Only the four `batchStatus.*` labels and their RU/FA translations move. The
verbs move with them: "Finalise" becomes "Post", and "Approve" becomes "Post"
wherever it is still spelled that way.

## 6. Rulings needed before step 1

Each ruling has a recommendation, but the decision is Islom's. The ones marked
★ contradict an earlier written ruling, and the brief does not resolve them by
itself.

- **R1 ★: Date from / to, or the week?** §6.2.10 part 1: "THE WEEK IS NOT
  REVERSED", because numbering, standing charges, `recentWeeks` and "one batch
  per period" all hang on the week. Datatruck's screenshot picks 11/08–11/14,
  which is exactly one Sunday-to-Saturday week. _Recommend: keep the week. The
  two date fields stay and snap to it, as today._
- **R2 ★: Is the authority required?** Today it is optional and none means the
  whole organization (the 2026-09-11 ruling, kept in part 1). Datatruck always
  names one. _Recommend: required on the Create screen. The org-wide batch stays
  readable, but no new one is opened._
- **R3: Driver pay per trip on Create.** Showing it means pricing each trip
  before the batch exists. The engine's reader can do that (`batchInputForOrg` →
  `computeBatch`, the rule in force, `grossFor`), but the price must come from
  the engine and never from a second formula in the preview. That makes ten
  columns, so one goes behind the chooser. _Recommend: show it, priced by the
  engine. Hide Status, since every available trip is Delivered._
- **R4: "Created by": the audit row, or a column?** The `AuditLog` CREATE row
  already names the user, so a CTE in `readPayrollBatchesPage` can read it with
  no migration. A batch opened by a script prints "—". A
  `SettlementBatch.createdByUserId` column (a migration, nullable, written by
  `openBatch`) is sturdier, but it would be empty for every batch that exists
  today. _Recommend: the audit row._
- **R5: Batches list columns.** Datatruck has no gross or deductions column.
  `list-columns.ts` says not to hide them, "those three are why §6.2.9 touched
  this grid". _Recommend: Created by and Created date shown; gross and
  deductions hidden by default. That reverses one sentence there, by your
  ruling._
- **R6: Delete a batch.** What is deleted? _Recommend: only a batch whose every
  statement is Unposted or Void. Its draft statements and exclusions are
  removed, the batch is soft-deleted (`deletedAt`), and its trips become
  available again. A batch with any Posted statement refuses by name. On a
  statement, voiding stays the only way to strike it._
- **R7 ★: Change status on the list.** §6.2.10 part 3: the batch's status is
  "DERIVED from its statements, never set by hand". _Recommend: Change status
  offers Posted (`finaliseBatch`: post every remaining draft) and Paid
  (`markBatchPaid`). Both act on statements, the derived status follows, and
  there is no path back to Unposted except voiding._
- **R8: Week number.** It is shown on Datatruck's right rail and stored nowhere
  in Zebra. From the one sample (period 11/01–11/07/2026 → week 44), Datatruck's
  week 1 is the week starting on the year's first Sunday (2026-01-04). Neither
  ISO numbering nor US numbering gives 44 here. _Recommend: derive it that way
  from `periodStart`, and check it against a second batch before step 1._
- **R9: Check date editable?** Today it is `checkDateFor(period)` and the form
  does not read it ("NO checkDate READ"). Datatruck has a pencil on it.
  _Recommend: editable while the batch is Unposted, written by its own verb,
  and locked once anything is Posted._
- **R10: Payroll's tab strip.** Batches · Driver statements · Balances ·
  One-time charges over the three routes as they are. _Scheduled payments_
  exists in Zebra (standing charges for the week); does it get a tab?
  _Recommend: the four you named, with Scheduled payments staying inside
  Charges._
- **R11: The batch screen's order.** Datatruck: statements table, then rail.
  Zebra: trip grid first. _Recommend: the statements table with the
  All/Unposted/Posted/Paid filter and the rail. The trip grid moves behind
  "Add trip" (a panel opened over the same grid and the same Save). Blockers and
  held lines stay above the table. For the ten columns, Accounting is dropped
  (Zebra has no equivalent) and Truck goes behind the chooser._
- **R12: What "Total pay" means.** On every Datatruck row, Total pay equals
  Total gross. ST-005935 shows $6,940.68 for both, with earnings $6,264.11 and
  net $4,009.31. Zebra's `grossCents` is that freight figure and
  `earningsCents` is the driver's cut. _Recommend: show Total gross and
  Earnings, not the same number twice._
- **R13: Bulk Send.** Posted statements only, or drafts too (watermarked)? One
  email per driver through `sendStatementToDriver`, refusals by name.
  _Recommend: posted only._
- **R14: Add driver.** Zebra has no act for it. Possible meanings: (a) a
  statement for a driver with no trips that week (deductions only), or (b)
  re-include a driver whose trips were all unticked. _Recommend: (b) only, as
  "include all of this driver's trips". (a) is a new kind of statement and
  waits for its own ruling._
- **R15: RPM.** Datatruck's $3.38 = total pay $6,940.68 ÷ 2,055.77 miles, so
  gross per mile. _Recommend: gross ÷ miles, in cents, shown and never
  stored._
- **R16: Statement page: four cards and tabs, or the §6.2.2 box and stacked
  grids?** §6.2.2 chose one dense header so the net is above the fold. That
  goal holds with four cards. Tabs hide the deduction grids behind a click.
  _Recommend: four cards; tabs for Trips · Fuel · Toll · Balances · Recurring ·
  One-time · Attachments & notes, with the count in each tab, and a tab with no
  rows still shown with its zero, as Datatruck does._
- **R17: Void's word.** Datatruck shows none. _Recommend: "Void", kept as it is
  today._

## 7. Steps after the rulings (proposed, not started)

Each step names its ritual class by the AGENTS.md test: the diff, not the
intent.

1. **The words.** The status-word function (§5) in `src/lib/` with its test,
   the labels in three locales, and "Post" for "Finalise/Approve". _Full ritual_
   (one file under `src/lib/` that is not `i18n*`).
2. **The Batches list.** Created by (R4), the column defaults (R5), Delete (R6),
   Change status (R7) and the tab strip (R10). _Full ritual_ (the reader and
   new verbs).
3. **Create batch.** Authority required (R2) and driver pay per trip through
   the engine (R3). _Full ritual._
4. **Batch detail.** The statements table, filter, rail and week number (R8,
   R11, R12); the bulk bar's Post / Send / Add deduction (R13); check date
   (R9); Add driver (R14). _Full ritual._
5. **Statement detail.** Four cards, RPM and tabs (R15, R16). _Visual-only if
   it touches nothing under `src/lib/` beyond i18n._ The readers already
   return every figure, but RPM would be computed in the page, so check the
   diff.

Steps 1–4 each carry their §6.2.10 amendment ahead of the code, in its own
commit. All of them stop at dev for the ship: each is a behaviour chain and a
visual chain at once, so production waits for "ship" (AGENTS.md).

## 8. Not built, by name

Datatruck tabs and controls with no Zebra concept behind them: the
Transactions Report and Salary Report tabs (Zebra has both as
`/accounting/reports` cuts, §6.2.10 parts 4–5, so they stay there); the
**Accounting** column; Dispatcher Pay and Truck Owner Pay (other pay runs, not
Driver Pay); "Review mileage source"; and the Driver Type filter as a separate
control (the column funnel covers it).

# The queue

What Zebra is building, in order, after Phase 5's own steps. The list came out
of the **gap audit** of 2026-09-20 — a walk of Datatruck's screens against the
corpus exports, the screenshots and the history import's columns, looking for
capabilities Datatruck has that Zebra does not.

**This file exists because the queue used to live only in a chat log.** On
2026-09-21 an item was handed over as "item 12 as briefed" and there was no
brief anywhere in the repository to read — the same failure AGENTS.md records
about Phase 3's brief, which had to be excavated from a session transcript at
Step 7 to run its own acceptance criteria against. A rule that lives only in a
chat log cannot be cited in review, and an item that lives only in a chat log
cannot be picked up by whoever works next.

Items 1–8 predate this file and are closed; their record is the commit log and
the phase briefs. Numbering is the owner's and is not renumbered.

## Done

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                | Landed                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 9   | **Warnings + Tags** — seven derived warnings across drivers, trucks and loads; `String[]` tags with GIN indexes and a tag filter. Nothing stored that can be derived.                                                                                                                                                                                                               | `src/lib/warnings.ts` |
| 10  | **Pay to + payment type + default authority** — `payTo` frozen onto settlements, payment type as TEXT against a four-value code list (Quickpay, Factored, ACH, Direct), a customer's booking default, and one default authority.                                                                                                                                                    | migrations 51–53      |
| 11  | **Dispatch fields** — Heading to, dispatch status, last activity, on-time delivery, all derived on read. The only thing stored is the off-duty flag, and a CHECK stops its return date disagreeing with it. Five surfaces wired 2026-09-21.                                                                                                                                         | migration 54          |
| 16  | **DRIVERS = Datatruck's shape** — the list with five tabs and ten columns on the grid machinery (`24a686a`); the record as eleven tabs, each reading what exists and saying so in words where nothing does (`b2da42b`); team drivers — a two-seat cap where the pairing is written, the second seat offered on the load, "Team with" on both records (`c6264f8`). §6.4, 2026-10-07. | no migration          |

Item 11 was followed by four rulings on 2026-09-21 that are part of it: the
driver form offers roster values only, the drivers list shows one status, the
board picker and `assertAssignable` both exclude off-duty drivers, and the
board's Available KPI is computed from trucks with no active load rather than
from `Truck.status`. Migration 55.

**12 — Fleet small fields.** Landed 2026-09-21, migration 56. Five columns
on `Truck` (`fleetStatus`, `fuelType`, `ownerName`, `axles`,
`grossWeightLbs`), `Driver.assignedTrailerId` with a partial unique index so
one trailer reaches one driver, and aging derived from the audit log rather
than stored. Two fields the brief named were NOT added and the reasons are
flags 10 and 11 in `PHASE-5-BRIEF.md` §7: `plateExpiresAt` duplicates the
REGISTRATION compliance item that already warns, and `insurancePolicyNumber`
duplicates `ComplianceItem.identifier`.

**Nothing was imported, and that is the finding.** The Datatruck trucks
export (`trucks_2026_09_09_09_52_34.xlsx`, 113 rows) carries a `Fleet Status`
column whose values are `available` / `inactive` / `in_transit` — dispatch
availability, not shop condition — and it contradicts the same file
`Status` column on 28 of 113 rows, so mapping it would invent a meaning
the artefact does not carry (flag 12). `Owner name` exists and is filled on
1 of 113 rows, with the literal string `NAN`. `axles`, `fuelType`,
`grossWeightLbs` and a policy number are absent from the export entirely;
they appear only on a customer-pasted fleet board inside
`Copy of Onboarding checklist - short.xlsx`, 43 rows, where the weight is
the same `17,000` on every row. The `Trailer` column exists in the truck,
driver and loads exports and is empty in all three (0 of 113, 0 of 54, 0 of
14,451). The one column that does carry data — `Registration expiry date`,
88 of 113 — is already imported as a REGISTRATION compliance item.

**13 — DQF completeness.** Landed 2026-09-21, migration 57. One
definition of 49 CFR 391.51 in `src/lib/dqf.ts` — eight requirements, each
marked at-hire or annual and mapped to the `ComplianceType` or `DocumentType`
that evidences it. Item 9's `REQUIRED_DRIVER_DOCUMENTS` now derives from it, so
there is one list rather than two. A computed checklist per driver
(present / due / expired / missing, each with the date it turned due) on the
driver page, a `dqf_incomplete` warning, and a roster view at `/safety/dqf`.
Terminated drivers are silent: 391.51(c) keeps the file, it does not keep it
current. Five enum values added and nothing else stored; the three DocumentType
values are flag 13 in `PHASE-5-BRIEF.md` §7.

**14 — Accident register.** Landed 2026-09-22, migration 58. One `Accident`
table per company holding 49 CFR 390.15(b)(2)'s six columns plus the tow-away
fact 390.5 needs, with the register at `/safety/accidents` — one authority at a
time, printable, void controls and the form hidden from print.

**DOT-recordable is derived and has no column.** 390.5's three-part test over
fatalities, injuries and tow-away. A hazmat release is RECORDED by
390.15(b)(2)(vi) and is not part of the test — the mistake a careful reader
makes, so `isDotRecordable` takes no hazmat argument at all.

**An entry is voided, never deleted.** There is no `deletedAt` on the table and
no delete in the service layer; a reason is required, a second void is refused,
and a CHECK forbids half a void. Retention is three years from the occurrence,
derived, and nothing removes anything when it passes.

**15 — Drug & alcohol random pool.** Landed 2026-09-22, migration 59. Four
tables for 49 CFR 382.305, the programme at `/safety/random`, and its own
`randomTesting` permission resource.

**The rate is a row with a Federal Register citation, and a year nobody
entered is a refusal.** The Administrator adjusts the minimum annual rate by
notice; a constant would be correct until the morning it silently was not.

**The draw ranks, it does not shuffle.** Each member is scored
`SHA-256(seed:key)` and the lowest are selected, so the result does not depend
on the order the recorded snapshot is read in — an auditor recomputing it gets
the same names whatever order they read the rows. Seed, method and the pool as
it stood are all stored, a CHECK refuses a draw missing any of them, and
`verifyDraw` re-runs it reading nothing live.

**Rate met counts tests CONDUCTED, not names drawn**, and the pool excludes
anybody who has left or has no CDL on file.

With it, the queue from the 2026-09-20 gap audit is empty. Items 13–15 were
the compliance block; what remains is the deferred list below.

## Next

| #   | Item                                                                                                                                                                                                                | Shape                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 17  | **GAPS code gap 10** — editors for pay-to, kind and tags on the driver record's Accounting and Main tabs.                                                                                                           | doc-first; full ritual                      |
| 18  | **TRUCKS = Datatruck's shape** — list tabs, record tabs, the same method as drivers. The brief comes from the next screenshots Islom sends; until then, start from the Trucks list columns the sweep already reads. | brief awaited; doc-first; same method as 16 |
| 19  | **Nightly sweep output** — any new GAPS row goes to the top of this queue.                                                                                                                                          | standing                                    |

### 17–19 — the queue after item 16

_Owner's words, received 2026-10-07 after item 16's third part reported, and
transcribed here before item 17 was designed:_

```
1. GAPS code gap 10: editors for pay-to, kind and tags on the driver
   record's Accounting/Main tabs.
2. TRUCKS = Datatruck's shape (list tabs, record tabs, same method as
   drivers) — brief from the next screenshots Islom sends; until
   then, start from the Trucks list columns the sweep already reads.
3. Nightly sweep output: any new GAPS row goes to the top of this
   queue.
```

### 16 — DRIVERS = Datatruck's shape (done 2026-10-07)

_Owner's brief, received 2026-10-07 and transcribed here the same day, before
part 1 was designed — because on 2026-10-06 the item was handed over as "the
queued brief" and the brief was in neither this repository nor the session,
which is the failure this file exists to stop. Kept after the work landed,
because `tests/driver-record.test.ts` counts the record's tabs against it._

```
DRIVERS = Datatruck's shape. Doc-first, then build:
1. List tabs: Active · Unassigned · All · Terminated · Vacation board.
   Columns: assign status (Ready to go / Not ready, from the DQF +
   truck check), employee status, first/last name, driver type,
   last activity, authority, phone, email, driver status (available /
   in transit / off duty), truck. Filter, bulk actions, import file,
   export, save view, column chooser — the existing grid machinery.
2. Driver detail tabs: Main · Documents · Mobile app login ·
   Recruiting · Accounting (pay rule, pay-to, deductions, opening
   balance) · Safety (CDL, med card, DQF, random testing, inspections)
   · Assets (truck/trailer history) · Statistics · Log history (audit)
   · Tasks · Others. Each tab reads what exists today; a tab with
   nothing behind it says so in words — no empty panels.
3. Team drivers: a truck carries up to two drivers; both seats on the
   load, both on the statement, shown on both records as "team with".
Ten lines per part, full ritual.
```

Each part is designed in `TMS-DESIGN-SYSTEM.md` in its own commit before its
code, and where the brief meets the design system or the schema, those two win
and the contradiction is flagged (AGENTS.md).

## Deferred

Named in the audit, ruled out of the queue for now. Listed so that "we never
thought about it" is not confused with "we decided not to yet".

- **Trip entity.** A Relay trip is legs, and legs currently flatten into the
  stop chain. A first-class trip is a second way to order the same freight.
- **HOS / ELD.** Hours of service and the ELD feed. Large, and it is a
  compliance surface with its own certification questions.
- **CSA scores.** The FMCSA BASIC percentiles. An outside feed rather than
  anything Zebra can derive.
- **Tenstreet pipeline.** Driver recruiting, from application to hire.
- **Carrier package.** The packet a broker asks for before the first load —
  authority, insurance certificate, W-9, references.

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

| #   | Item                                                                                                                                                                                                                                        | Landed                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 9   | **Warnings + Tags** — seven derived warnings across drivers, trucks and loads; `String[]` tags with GIN indexes and a tag filter. Nothing stored that can be derived.                                                                       | `src/lib/warnings.ts` |
| 10  | **Pay to + payment type + default authority** — `payTo` frozen onto settlements, payment type as TEXT against a four-value code list (Quickpay, Factored, ACH, Direct), a customer's booking default, and one default authority.            | migrations 51–53      |
| 11  | **Dispatch fields** — Heading to, dispatch status, last activity, on-time delivery, all derived on read. The only thing stored is the off-duty flag, and a CHECK stops its return date disagreeing with it. Five surfaces wired 2026-09-21. | migration 54          |

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

## Next

| #   | Item                           | Shape                                                                                            |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| 14  | **Accident register**          | §390.15(b). The register DOT asks for at an audit, with the three-year retention rule behind it. |
| 15  | **Drug & alcohol random pool** | §382.305. Pool membership, selection rounds and the rate the year has to hit.                    |

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

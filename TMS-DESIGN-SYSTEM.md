# TMS-DESIGN-SYSTEM.md

**Project:** Zebra — Transportation Management System
**Status:** v10.53 — §6.7 added 2026-10-08 (queue item 21, the owner's brief from Islom's screenshots, before the code): the loads list takes Datatruck's shape — four date views by name (`picksUpToday`, `deliversThisWeek`, and `pickup`/`delivery` over `from`–`to`) read on the FIRST pickup and the FINAL delivery in each stop's own zone, broker and driver typeaheads with the driver matching either seat, linked broker, driver and truck cells for roles that may open them, a copy button beside the load number, a DEL date column, and Upcoming and Unpaid as counted views; every filter is ANDed because two `OR`s merged by spread overwrote each other, and every chip count now honours the active view; export, row expand and the chooser are the second chain, and the brief's "Mark POD received" is answered as Attach POD because Phase 2 §2 makes POD received automatic and never manual; v10.52 — §6.1.1 amended 2026-10-07 (production walk, queue item 20 (8), before the code): the compliance panel's 30/60/90 figures are counts over `complianceQueue`'s OWN rows at a fixed 90-day horizon — actionable subjects, superseded dropped, expired in all three, cumulative — and not raw SQL over every `ComplianceItem`; the Needs-you row and the panel read 54 against 96 on one production screen because the panel counted sold trucks' lapsed registrations and renewed records the queue drops; the SQL columns go, the 2026-10-01 ruling against re-expressing the horizon in SQL is honoured by removing the SQL, and the one remaining difference is the horizon, said in the panel's note; v10.51 — §6.2.10 part 1 amended 2026-10-07 (production walk, queue item 20 (7), before the code): "0 available" never stands alone — the picker's header line names the buckets that took the rest, with their counts, so the answer to "why zero" sits on the same line as the zero; measured on dev for 9/20–26, 16 of 23 candidates were never delivered in Zebra; v10.50 — §6.6 added 2026-10-07 (production walk, queue item 20 (6), before the code): the accident register's driver picker is the ACTIVE drivers of the authority — the Active tab's population and people, through the one predicate the drivers' data-health base also reads; v10.49 — §7.12 added 2026-10-07 (production walk, queue item 20 (5), before the code): the load detail on direct-settled freight — the accessorial summary carries two named figures (billed, and the approved "Other" lines not billed), the payment type derives from `settlesDirectly` and is refused otherwise, the tracker's fourth word is "On statement" on that freight, and a load whose flag disagrees with its customer is a data row; v10.48 — §6.4 part 2's Safety tab amended 2026-10-07 (production walk, queue item 20 (4), before the code): the DQF's "Copy of the CDL" is satisfied by a live CDL compliance record as well as by the document, read by its date when it is the record alone; and a missing hire date is a ninth row, "Hire date recorded", rather than the reason a file reads 8 of 8 missing; v10.47 — §6.5 part 0 amended 2026-10-07 (production walk, queue item 20 (3), before the code): an EMPTY scope is every company for the data-health counts as it is for every list — the owner's scope is `[]`, the counts read it as "no company", and both footers said 0 while the grid showed the gaps; the count and the filter now share the scope rule, and the agreement test runs scoped and unscoped on a blank-odometer truck row; v10.46 — §7.1's row-link rule amended 2026-10-07 (production walk, queue item 20 (2), before the code): the stretch is PER CELL, because Chromium does not let a positioned table row contain the anchor's `::after` — measured on dev, a 97 px anchor on a 1,056 px row — so every cell is its own containing block, the first cell's anchor is the row's one named link, and the other cells carry hidden overlay anchors to the same href; v10.45 — §6.2.10 part 2b added 2026-10-07 (production walk, queue item 20 (1), before the code): the batch route IS the batch screen — the part 1 grid for the batch's own week and scope with ticks read from the persisted exclusions, Save writes the delta through the two exclusion verbs, the item 3 facts stay below, the Statement column links to the statement in every status, Open a batch lands on the batch; v10.44 — §6.5 part 0b added 2026-10-07 (queue item 18 part 0b, before the code): the DATA-HEALTH row for Drivers by the owner's five — no CDL on file, no medical card, no phone, no pay rule in force, no truck — over the Active tab's people only, the same module, the same generic row, the same agreement test, and then a hold for the Trucks brief; v10.43 — §6.5 added 2026-10-07 with part 0 (queue item 18, before the screen and before the code): a DATA-HEALTH row under the Trucks grid — five counts, one definition each, every figure a link to the filtered list, zero shown, one query, the same five figures as a Data row in GAPS, written per subject so Drivers follows without a second design; v10.42 — §6.4 part 2 amended 2026-10-07 (queue item 17, GAPS code gap 10, before the code): pay-to, kind and tags get editors — pay-to as its own small form on Accounting under `driver.pay:update`, read at generation and frozen onto the statement so an edit never restates a paid one; kind and tags as fields on Main's form under `driver:update`, which is the ruling the queue item implies for who may turn a person into a payee; tags split on commas by the one rule the import already uses; v10.41 — §6.4 part 3 added 2026-10-07: team drivers — a truck carries up to two drivers through the pairing that already exists, capped where it is written; the load's second seat is pre-filled from the truck's crew and saved by the dispatcher, never filled by the engine; both records say "Team with"; v10.40 — §6.4 part 2 added 2026-10-07: the driver RECORD becomes eleven tabs over one page, each reading what exists today behind it — the form, documents, pay, safety, assets, statistics, the §7.10 timeline for a person — and a tab with nothing behind it says so in one sentence rather than rendering an empty panel; a tab a role may not see is not rendered at all; v10.39 — §6.4 added 2026-10-07 (queue item 16, part 1): the drivers LIST takes Datatruck's shape on the existing grid machinery — five tabs over one grid (Active · Unassigned · All · Terminated · Vacation board), ten named columns inside §7.1's cap with email and CDL behind the chooser, an ASSIGN STATUS derived on read from the DQF and the assigned truck's compliance and never stored, roster bulk actions through the one edit function, saved views per grid; the brief's "employee status" column is answered by the tab and the one-status ruling of 2026-09-21 rather than by a second badge, and its export and import are flagged against §7.1.7 and the loads-import precedent rather than quietly built; v10.38 — the driver's type gets its own name, before migration 70: `Driver.driverType` is a `DriverType` — `COMPANY_DRIVER ǀ LEASE_OPERATOR ǀ OWNER_OPERATOR`, a person's words — and `OwnershipType` goes back to being a truck's title; the VALUE IS SEEDED FROM THE DATATRUCK EXPORT'S OWN `Driver Type` COLUMN per driver, because comparing the stored value against it first found 56 of 167 dev drivers inverted by the seed's tariff threshold (owner's instruction, 2026-10-06), with the old value used only where the export is silent and those drivers listed; the frozen copy on the statement (66) and the standing charge's scope (§6.2.4) carry the same words, every driver's landing value is decided before the retype and asserted after, and `/payroll/statements` gets the funnel §6.2.10 part 6 held back until the enum could be typed by name; v10.37 — §6.2.2's held row move lands as migration 69, before its code: EVERY workbench trip is a `SettlementLoadLine`, like the batch's — `generateSettlement` writes a load line per trip (freight from the load's billed total, pay from the rule, the rule frozen beside it, places and sheet dates on the row) and no `LOAD_PAY` line at all, `SettlementLine` is for what is put on by hand, the drift checker's snapshot arm reads the load lines' snapshots, the statement page's separate "Load pay" list goes because the trips grid now shows every statement's trips, and `SettlementLoadLine` gains nullable `puActual`/`delActual` so the workbench's plan-or-record flags survive the move while the batch's rows say nothing they do not know; 69 moves the rows already placed with the net asserted unchanged; v10.36 — two owner's rulings of 2026-10-06, before their code. §7.6: THE RATE FIELD IS THE LINE HAUL — prefilled from `money.linehaul` and never from the total, with the fuel surcharge and the accessorial lines going to their own columns off the server's copy of the extraction when its parts agree with its total; the basis is then the pay rule's job (`PERCENT_LINEHAUL` on line haul, `PERCENT_GROSS` on the total, chosen per driver by the accountant), which is what load 1177 — $887.25 read today against $735.00 under the rule — turned on; migration 68 backfills every hand-created load whose rate con carries an agreeing split and LISTS the rest. §6.2.2: FREIGHT IS NEVER CALLED PAY — per line it is _Load gross_ (Datatruck's own header), the summary says _Earnings_ before deductions and _Net pay_ after, _Total pay_ is removed as a label everywhere, and _Total gross_ renders the freight sum; the question v10.34 flagged is answered; v10.35 — §6.2.2's header rule NARROWED the same hour, before its code: measuring the move of the generate path's `LOAD_PAY` rows into `SettlementLoadLine` found twelve test sites and six readers that address those rows directly — the drift checker, the settleable exclusion, the trips section of the statement page, three importers' tests — so the move is its own step (68) and 67 is what the ruling asked for: the workbench writes the batch engine's header over BOTH tables wherever its trips happen to sit, a hand-added trip is priced or refused and gets no `LOAD_PAY` twin, and the backfill rewrites headers only, net asserted unchanged; v10.34 — §6.2.2 gains THE HEADER'S COLUMNS, BOTH ENGINES on 2026-10-06, before migration 67: the batch engine's meaning of the statement's money columns is the meaning — `grossCents` the freight, `earningsCents` the driver's cut, `otherPayCents` the add-backs, `deductionsCents` negative — and the workbench engine conforms: its trips live in `SettlementLoadLine` like the batch's, `refreshTotals` becomes the one header writer over BOTH line tables (which is what closes GAPS.md gap 2), and a trip added by hand is PRICED by the rule in force or refused, because `Recalculate` re-adds and does not re-price and the comment that said otherwise had been paying 100% of the freight to anyone who believed it; 67 moves the existing workbench rows and rewrites their headers with the net asserted unchanged; v10.33 — §6.2.10 part 6's held migration lands 2026-10-06, after 64 and 65 reached production: `Settlement.driverType` is NULLABLE and written by both engines at generation, read first and the live driver row only for a statement issued before it — nothing invented for a document already handed over; v10.32 — §6.2.10 part 6 specified 2026-10-06, before its code: the driver's type is the office's word from `drivers.employment.*`, keyed by the enum value so every site says the same thing without a second mapping; it goes beside the name on the record (it was only a select inside the form) and into `/payroll/statements` as a default-hidden, sortable, NOT funnel-able column — the funnel matches the stored value, and a funnel that wants `OWNED` typed for a company driver is the failure this part names; the statement shows the driver's CURRENT type and that is flagged rather than decided — the frozen copy is `Settlement.driverType`, migration 66, which the deploy order's step 5 holds behind the production dispatch 64 and 65 are waiting on; v10.31 — §6.2.10 part 5 specified 2026-10-06, before its code: the salary report is one row per driver per settlement week per authority, COUNTED BY THE STATEMENT'S STATUS (APPROVED or PAID) and not the batch's — because part 3 made PARTIAL real and a batch-keyed rule hides the approved statements on a half-posted week, and because the old join through the batch left out every statement the workbench engine issued; the two engines fill the statement's money columns under different names and signs, so the reader reconciles them in ONE CASE and the agreement test holds gross + other pay + deductions = net on every row, both engines present; the §6.2.9 sparkline moves to the same rule, because "what this driver has been paid" cannot have two answers on two screens; v10.30 — §6.2's two tables amended 2026-10-06 to name the fourth cut on Reports (Transactions), because `tests/accounting-surface.test.ts` asserts a page's tab count against §6.2's table rather than against the code, and §6.2.10 part 4 had added the cut three screens down without touching the table it is counted from — the guard fired on the first `npm run check` after the code, which is what it is for; v10.29 — §6.2.10 part 4 specified 2026-10-06, before its code: the transactions report is a fourth cut on /accounting/reports whose rows are the UNION of the three line tables rather than a fourth copy, with the office's four words (trip pay · advance · deduction · adjustment) mapped from the schema's types in a table so the mapping is not improvised twice, deductions kept negative because a ledger is read down to a net, the deduction category taken from §6.2.7's own CASE so two screens cannot categorise one line two ways, and an agreement test that every driver's rows sum to their statements' net; v10.28 — §6.2.10 part 3 specified 2026-10-06, before its code: a batch's status is DERIVED from its statements and never set by hand (none approved DRAFT · some PARTIAL · all FINAL · all paid PAID), recomputed in the same transaction as every change that can move it; a refresh rebuilds only the statements still in DRAFT, because an approved statement is a document with a number and a name on it — today's refresh deleted every statement on the batch, a latent defect PARTIAL makes impossible; `finaliseBatch` becomes "approve every statement still in draft". v10.27 — §6.2.10 added 2026-10-05: payroll takes Datatruck's shape from Islom's walkthrough, and the owner's rulings on the three places it met the existing design — `SettlementBatch.companyId` is NULLABLE with null meaning the whole organization, so the 2026-09-11 one-run ruling stays the default and a named company scopes its own standing charges and `recentWeeks`; THE WEEK IS NOT REVERSED, a batch is still a settlement week by construction and the from/to fields merely SHOW it; and the tick is an EXCLUSION SET rather than a picked set, persisted per batch with who and when, so a refresh can only ever ADD freight and never un-excludes — because a picked set cannot tell "not chosen" from "arrived after they chose", and its failure mode is a trip silently dropping out of somebody's pay. v10.26 — §6.1.2 added 2026-10-05: every worker that is not production says which database it is looking at, in the topbar that already exists rather than a band of its own (standing rule 1), decided by `NEON_BRANCH` because it names THE DATA — not `NODE_ENV`, which is `production` in dev's built worker too, and not the hostname, which breaks the day zebratms.com lands; anything that is not the production label is marked and the ribbon NAMES the branch it found, while production renders nothing at all, because an element that could print the wrong label on production is worse than no ribbon. v10.25 — §7.1.7 amended 2026-10-04, hours after it was written, because the same probe found a THIRD grid over the cap: `/payroll/batches`, taken from eight columns to eleven by §6.2.9 earlier the same day, with a chooser already on the page — which is what proves a chooser alone is not the fix, since a user with no stored preference gets every column back. THE CAP NOW LIVES IN `readGridColumns`, the one function every grid calls, rather than in each page; a page names which columns go first and the function bounds the count. v10.24 — §7.1.7 added 2026-10-04 (found by the UAT live check): the two OPERATIONAL lists run past §7.1's cap and therefore 500 — `/trucks` for every organization and `/loads` for any carrier with more than one authority — so both adopt §7.1.4's chooser, which already exists; the cap is a SLICE in code rather than a convention because a stored preference outlives every deploy, and the warnings column is never default-hidden because an absent warnings column reads as "nothing wrong"; v10.23 — §6.2.9 added 2026-10-04 (accounting polish part 3): /payroll/batches gains a pipeline strip of draft / final / paid money AS OF TODAY with each figure linking to that status, the batch list gains per-batch gross / net / deductions out of the statement that already groups them — and the doc says the three are NOT an equation because reimbursements and other pay are added back — /payroll/statements gains a per-driver net-pay sparkline over the last thirteen settlement weeks REGARDLESS of the picker, which is the only deliberate exception in the product to the chips-and-period rule and is written down as one; v10.22 — §6.2.8 amended 2026-10-04 (owner ruling, resolving flag 49): the strip carries TWO KINDS OF FIGURE with two labels and never mixes them — a BALANCE (open, overdue, factored, unapplied) is as of today with no date bound and links to a list with no period filter via `?period=all`, and a FLOW (invoiced in window, received in window) carries the picker; a balance was windowed before, which hid the five-month-old unpaid invoice on the screen whose job is to show what is owed; `?period=all` is a URL state and not a fifth preset, and the chip counts stay windowed because they describe the list; v10.21 — §6.2.8 added 2026-10-04 (accounting polish part 2): Invoices and Payments gain a four-figure summary strip where every figure is a LINK to the list it summarises and ties to the cent to it, FACTORED is never inside OPEN and overdue is a stated subset, every chip and tab count becomes a COUNT(\*) rather than a length over a capped list reader, the rolling picker and authority chips replace the from/to range here as on Reports, and the strip answers FOR THE WINDOW — which hides old open paper and says so, pointing at the unwindowed aging bar on Reports (flag 49); v10.20 — §7.5.1 and §7.11 added 2026-10-04 (the login bug): every refusal names itself IN WORDS on the form, the closed failure set includes the row everybody forgets — the request was fine and the system was not — one silent retry before words, NOTHING FALLIBLE after the credential is accepted, and src/app/error.tsx is one worded page with a try-again link that carries its own three sentences because a client boundary cannot ask the server for words; v10.19 — §6.2.7 added 2026-10-03 (accounting polish part 1): /accounting/reports gains four charted sections on §6.1.1's contract, the rolling picker and authority chips become ONE shared pair of components rather than a copy, the from/to range and the weekly/monthly toggle are REMOVED because v10.17 makes grain a property of the preset, factored paper is its own series and never inside collected, the four deduction categories are assembled with SOURCE BEATING LABEL since the schema stores no category, and every figure ties to the cent to the screen it summarises — with the list caps named as the limit of that claim; v10.18 — dashboard part 3 fills the Fleet, Cash and Compliance panels 2026-10-02: top drivers credits BOTH crew seats, receivables aging is invoiced-unpaid-non-factored only, Cash is money-roles-only, and the 30/60/90 compliance counts are a DIFFERENT question from the Needs-you warn-days row rather than a second expression of it; v10.17 — owner ruling 2026-10-02: CALENDAR WINDOWS ARE OUT, the picker becomes Last 7 days / Last 4 weeks / Last 13 weeks / Last 52 weeks, each ending with the current settlement week with the partial week drawn as far as today AND MARKED, grain is a property of the preset rather than the span, default Last 13 weeks; v10.16 — owner review of the charts on dev 2026-10-02: the period picker drives EVERY chart and the two-window permission is REVOKED, default period becomes This quarter, every chart carries a worded legend, every bar its value and label with gridlines and a visible CSS tooltip, every KPI a sparkline, and an empty period keeps its axis and legend; bars and sparklines become HTML/CSS while rings stay SVG; v10.15 — §6.1.1 gains the chart contract 2026-10-02: server-rendered inline SVG with no library and nothing that could animate, hover detail as a <title>, the palette an ACCENT RAMP rather than the status hues §3.3 fixes to meanings, and the same figures as a visually hidden table under every chart; v10.14 — §6.1.1 added 2026-10-01 (dashboard redesign part 1): chips and period govern the whole page, "after driver pay" is an em dash for any period Zebra was not settling, closed history counts in totals and appears in no queue, Needs-you becomes a right rail. _The brief for this said "Design system v10.2"; the file was already at v10.13, so this is v10.14 and the discrepancy is flagged rather than resolved — see `PHASE-5-BRIEF.md` §7 flag 42._ v10.13 — §7.10 added 2026-10-01: a record's history is ONE activity timeline, six kinds of entry that do not dress alike, a document's upload read from the `Document` row rather than its audit row, and adding a note is its own control; v10.12 — §6.2.1’s batches row reworded 2026-10-01: the bar is `checkbox selection · Finalise · Mark paid`, not a control called Change status; v10.11 — migration 61 lands 2026-10-01: §6.2.4 standing charges built and the Charges tab table goes to four, §6.2.3's deduct side built with the fuel mode frozen per statement, and the scope offered is the schema's three ownership types rather than the two §6.2.4 first named; v10.10 — §6.2.6 the statements grid 2026-10-01: Deductions is every net-reducing line, status and batch filters, bulk Post and Mark paid; v10.9 — §6.2.5 applying a payment 2026-09-30, and §7.5’s six-field cap applied against a brief asking for a modal; v10.8 — §6.2: Invoices gains a Factored tab, a status filter and bulk Mark sent 2026-09-30; v10.7 — §6.2.4 standing charges specified and held for migration 61, 2026-09-30; v10.6 — §6.2.2: the Trip column is the broker’s reference and Add trips is unconditional 2026-09-30; v10.5 — §6.2.2: every statement exports, a draft’s PDF is watermarked 2026-09-30 (owner’s ruling, reversing the same day’s refusal); v10.4 — §8’s heading rule decides by an allowlist of issued series 2026-09-30; v10.3 — §8 forbids an internal id in a heading and §6.2.2 gives the statement its title rule 2026-09-30 (owner’s ruling); v10.2 — §6.2.2’s trips grid corrected to nine columns behind a chooser 2026-09-29 (it named eleven and §7.1 throws above nine); §6.2.2 (the settlement workbench) and §6.2.3 (fuel and tolls) added 2026-09-29, with eleven more rows in §6.2.1, against `ST-005562.pdf` and six workbench screenshots; §2's stripe gloss removed from page headers 2026-09-29; §6.2 split into Accounting and Payroll 2026-09-28 (the artefact’s shape, owner’s ruling); §6.2.1 added and §7.1.2/§7.1.3's footer scope corrected from the artefact 2026-09-28; §7.1.3–§7.1.6 added 2026-09-28 (the grid contract: columns chooser, export, tabs over one grid); §6.2, §7.1, §7.4 amended 2026-09-28 (the Accounting section; sort, totals row, date range, company filter on financial lists); §5.1 amended 2026-08-01 (density moves the cell padding); §8 amended 2026-07-31 (midnight-local bare dates); §6.3 amended 2026-07-29 (company switcher → company filter)
**Scope:** the operator application (desktop/tablet), the driver portal (phone), and the wall-display dispatch board.

This file is the source of truth. If a component in the codebase disagrees with this document, the component is wrong. Amend the document deliberately, in a commit of its own, before changing the code.

---

## 0. Standing rules

Numbered so they can be cited in review. These are carried forward from `DESIGN-SYSTEM.md` v2 where marked, plus the rules specific to this application.

1. **Density is a feature.** Never add whitespace that reduces the number of rows visible on a 1080p screen. A dispatcher's job is comparison; comparison requires adjacency.
2. **Status colors are semantically fixed.** A hue that means "delivered" never appears as decoration anywhere. _(carried from v2)_
3. **Every appointment time renders in the stop's local timezone**, with the zone abbreviation shown. Never the browser's timezone. This is the single most expensive bug class in dispatch software.
4. **Money is right-aligned, tabular, two decimals, never abbreviated in tables.** Abbreviation (`$2.5k`) is permitted only in KPI cards.
5. **Never color-only.** Every status shows its word. Color is reinforcement, not the signal.
6. **Logical CSS properties only** — `margin-inline-start`, never `margin-left`. The driver portal ships in Farsi, which is right-to-left.
7. **Every surface declares its own background.** No inheriting from `body`. _(carried from v2)_
8. **Inventory standalone CSS before restyling anything.** _(carried from v2)_
9. **Grep before deleting a token.** _(carried from v2)_
10. **No inner scroll container in the app shell** except designated table bodies and the notification drawer. _(carried from v2 §11 — this bug cost a session on the marketing site)_
11. **Destructive actions are never accent-colored.** Danger or ghost only.
12. **Nothing from the marketing design system enters the app shell** without being re-specified at application density. The two systems share brand color and nothing else.

---

## 1. What this system is not

The AR Safety Support design system sells a service. It is airy, large-typed, scroll-snapped, and generous with whitespace — correct for a person deciding whether to buy.

Zebra is used by someone who already bought, at 6am, on their fourth coffee, comparing nineteen loads against seven trucks. Whitespace they have to scroll past is whitespace working against them.

**Do not carry over:** the type scale, the vertical rhythm, scroll-snap, full-viewport sections, the hero pattern, autoplay, animated reveals, or any component sized for marketing.

**Do carry over:** `#171a20` as ink, `#3e6ae1` as accent, 4px corner radius, and weight 500 as the heaviest weight for headings.

---

## 2. Signature: the status stripe

Every row, card, and detail header carries a **3px vertical bar on its leading edge**, colored by status.

This is the one memorable element, and it is load-bearing rather than decorative: it lets a dispatcher read the state of a forty-row board peripherally, without reading a single word. It is also the only place the project's name shows up in the interface, which is the right amount.

Rules:

- The stripe reflects **operational** status on load surfaces, **billing** status on invoice and AR surfaces, and **compliance urgency** on fleet and driver surfaces. One meaning per screen.
- The stripe is never the only indicator (rule 5). **The status word sits in the row, and that is where its meaning is stated** — not in a gloss beside the page title.

  \_Amended 2026-09-29. This said "stated in the screen's header", and the
  Accounting build did exactly that: `stripe: the driver's line`,
  `stripe: billing status`, `stripe: in force today`, in grey, next to every
  page title. Read on the deployed screens it is a note from one developer to
  another about a rendering decision — the owner's word for it was "leaked" —
  and it is furniture the reader has to skip past to reach the grid, which is
  rule 1's whole objection.

  IT WAS ALSO REDUNDANT WHERE IT MATTERED. Every one of those grids carries the
  status as a WORD in its own column, because rule 5 has always required it. The
  header gloss named a fact the row already states, which is the definition of
  something to delete.\_

- The stripe does not animate. Ever.
- Cancelled rows get the muted stripe _and_ 60% text opacity. Nothing else in the system reduces text opacity.

---

## 3. Color

Tokens live in `:root`. Never hard-code a hex outside this block.

### 3.1 Neutrals

```css
--z-ink: #171a20; /* primary text, table values */
--z-ink-2: #5c6370; /* labels, secondary text, column headers */
--z-ink-3: #8a919e; /* placeholder, disabled, timestamps */
--z-surface: #ffffff; /* cards, table body, modals */
--z-surface-2: #f7f8f9; /* page background, table header */
--z-surface-3: #eef0f2; /* row hover, pressed states */
--z-border: #e2e5e9; /* hairlines, table rules, input borders */
--z-border-strong: #c9ced6; /* input focus rest state, dividers that matter */
```

### 3.2 Accent — action only

```css
--z-accent: #3e6ae1;
--z-accent-hover: #3457c4;
--z-accent-soft: #eaefff; /* selected row, active nav item */
```

Accent means "you can do something here." It never encodes state. A blue badge does not exist in this system.

### 3.3 Status — semantically fixed

Each status has a text/border hue and a soft fill. Never mix pairs.

```css
--z-neutral: #64748b;
--z-neutral-soft: #f1f5f9; /* available, draft, uninvoiced */
--z-progress: #0e7490;
--z-progress-soft: #ecfeff; /* dispatched, in transit, sent */
--z-success: #15803d;
--z-success-soft: #f0fdf4; /* delivered, POD received, paid */
--z-warning: #b45309;
--z-warning-soft: #fffbeb; /* POD missing, due soon, partially paid */
--z-danger: #b91c1c;
--z-danger-soft: #fef2f2; /* overdue, disputed, out of service */
--z-muted: #94a3b8;
--z-muted-soft: #f8fafc; /* cancelled, inactive, void */
```

### 3.4 Status mapping

Bind these once, in one module. No screen decides its own mapping.

| Load — operational                                     | Token                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| Available, Booked                                      | neutral                                                       |
| Dispatched, At Pickup, Loaded, In Transit, At Delivery | progress                                                      |
| Delivered                                              | warning _(delivered but no POD is an action item, not a win)_ |
| POD Received                                           | success                                                       |

| Load — billing               | Token    |
| ---------------------------- | -------- |
| Uninvoiced, Ready to Invoice | neutral  |
| Invoiced, Sent               | progress |
| Partially Paid               | warning  |
| Paid                         | success  |
| Overdue, Disputed            | danger   |
| Written Off, Void            | muted    |

| Fleet / compliance              | Token   |
| ------------------------------- | ------- |
| Expires in > 30 days            | neutral |
| Expires in 8–30 days            | warning |
| Expires in ≤ 7 days, or expired | danger  |
| Out of Service                  | danger  |
| Sold, Inactive                  | muted   |

**Delivered mapping to warning is deliberate.** In this business a delivered load is unfinished work until the POD lands, and a green badge tells a dispatcher to stop looking at it.

### 3.5 Wall-display dark set

The dispatch board runs on a wall screen across a room. It is the only dark surface in the system.

```css
--z-wall-bg: #0d1014;
--z-wall-surface: #171a20;
--z-wall-border: #2a2f38;
--z-wall-ink: #e8eaed;
--z-wall-ink-2: #9aa2ae;
```

Status hues lighten for dark ground: raise lightness ~18%, drop saturation ~8%. Define as a separate token set; do not filter at runtime.

---

## 4. Typography

**Family: IBM Plex.** One superfamily, three roles.

```css
--z-font-ui: 'IBM Plex Sans', system-ui, sans-serif;
--z-font-dense: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif;
--z-font-mono: 'IBM Plex Mono', ui-monospace, monospace;
```

Plex was drawn for an engineering context and it shows — slightly squared terminals, a mechanical rhythm, no warmth it hasn't earned. It holds up at 12px where friendlier faces go mushy, and the condensed cut buys column width on the wall board without shrinking type. Self-hosted; no CDN.

**Mono is for identifiers and money only:** load numbers, invoice numbers, VINs, MC/DOT numbers, reference numbers, and every currency figure. These are things people read character by character, compare across rows, and read aloud over the phone. Mono makes transposition errors visible.

### 4.1 Scale

Dense by design. The base is 13px, not 16px.

```css
--z-text-xs: 11px / 16px; /* badges, table meta, timestamps */
--z-text-sm: 12px / 18px; /* table body, dense secondary text */
--z-text-base: 13px / 20px; /* default UI text, inputs, buttons */
--z-text-md: 15px / 22px; /* section headings, modal titles */
--z-text-lg: 18px / 26px; /* page titles */
--z-text-xl: 24px / 32px; /* KPI values */
--z-text-2xl: 30px / 36px; /* dashboard headline KPI, wall board */
```

### 4.2 Weight

400 body · 500 headings, labels, buttons · 600 KPI values and table column headers only. **No 700 anywhere.**

### 4.3 Numerals

```css
font-variant-numeric: tabular-nums;
```

Applied globally to every table cell, every KPI value, every currency and mileage field. Non-negotiable — proportional figures make columns of numbers unreadable.

Tracking: `-0.01em` on `--z-text-xl` and above. Zero elsewhere.

---

## 5. Space and density

4px base unit. `--z-1` through `--z-8` = 4, 8, 12, 16, 20, 24, 32, 40.

| Element            | Value                                    |
| ------------------ | ---------------------------------------- |
| Sidebar            | 224px, collapsed 56px                    |
| Topbar             | 48px                                     |
| Page gutter        | 20px desktop · 16px tablet · 12px phone  |
| Card padding       | 16px                                     |
| Table cell padding | 8px 12px                                 |
| Control height     | 32px default · 28px compact · 36px large |
| Input height       | 32px                                     |

### 5.1 Row density

A user preference persisted per user, defaulting to Standard.

| Mode        | Row height | Body size | Cell padding |
| ----------- | ---------- | --------- | ------------ |
| Compact     | 32px       | 12px      | 4px 12px     |
| Standard    | 36px       | 12px      | 8px 12px     |
| Comfortable | 44px       | 13px      | 12px 12px    |

**Row height is a MINIMUM, and the vertical cell padding is what moves.**

_Amended 2026-08-01. The reason, measured on the deployed worker: with §5's
fixed 8px vertical cell padding, a Loads row carrying a status badge renders at
39px — taller than Standard's 36px and Compact's 32px both. Changing only
`--z-row-height` therefore changed nothing at all. Compact and Standard both
measured 39px and the preference was a control that appeared to work and did
not. Moving the padding with the mode is what there is to give: Compact now
measures 32px, Standard 39px._

_Standard keeps §5's 8px exactly, so the table above does not contradict the
one above it — it says which of §5's numbers is fixed and which is the
Standard case of a scale. The literal 36px Standard row remains unreachable
while a badge sits in the row; the number stays as the target it always was,
and the honest claim a check can make is that Compact rows are shorter than
Standard ones._

### 5.2 Radius

4px on buttons, inputs, badges, and menus. 6px on cards and modals. **0 on table cells.** Nothing larger — generous radii read consumer, and this is equipment.

---

## 6. Layout

### 6.1 App shell

```
┌────────────┬──────────────────────────────────────────────┐
│            │  ⌘K search      company switcher   🔔   user │ 48
│  ZEBRA     ├──────────────────────────────────────────────┤
│            │  Page title                    [ Add load ]  │
│  OPERATIONS│  ─────────────────────────────────────────── │
│   Dashboard│  filter bar · saved views · density · export │
│   Dispatch │  ─────────────────────────────────────────── │
│   Loads    │                                              │
│   Calendar │   content — the only scrolling region        │
│            │                                              │
│  FLEET     │                                              │
│   Trucks   │                                              │
│   ...      │                                              │
└────────────┴──────────────────────────────────────────────┘
   224px
```

#### 6.1.2 Which database am I looking at — _added 2026-10-05_

Every worker that is not production says so, on every screen, in the topbar that
is already there.

- **`NEON_BRANCH` decides, never the hostname.** It is the discriminator
  `statement-send.ts` already uses, for the reason written there: it names THE
  DATA. `NODE_ENV` is `production` in every built worker including dev's, a
  hostname check breaks the day a custom domain lands, and the question the
  ribbon answers is "whose rows are these".
- **Anything that is not `production` is marked.** CI forks per-run branches
  named `ci-<run id>`; a preview worker would be something else again. The
  ribbon names the branch it found rather than asserting it is "dev", because a
  marker that says the wrong thing is worse than none.
- **It states the branch, not the word "development".** "DEV · dev" is noise;
  `DATA: dev` answers the question in the words of the thing it read.
- **In the topbar, not above it** (standing rule 1). A band of its own costs a
  row of freight on every screen in the application, forever, and the topbar has
  a reserved empty region sitting in the middle of it.
- **`--z-warning-soft`, and that is a deliberate reading of §3.3.** The hue
  vocabulary is fixed to meanings and warning means "attention"; a worker that is
  not production IS attention — it is the difference between typing real freight
  into a sandbox and sandbox data into the carrier's books. It carries its word
  as text, never colour alone (standing rule 5).
- **Production renders nothing at all.** Not an empty element, not a ribbon that
  says "production": the absence is the signal, and an element that could render
  the wrong label on production is a worse failure than having no ribbon.

_The ruling for this was made in conversation and never written down, which is
why implementing it started by transcribing it (AGENTS.md: a rule that lives only
in a chat log cannot be cited in review). The specifics above are this
transcription's, not the original ruling's, and are open to correction._

#### 6.1.1 The dashboard — _added 2026-10-01_

_Owner's brief, dashboard redesign part 1. The screen somebody opens at 6am._

**Company chips and a period picker at the top, and they govern everything
below them.** Not per panel. A dashboard where the KPI strip answers for the
quarter and the chart for the week is one where two true numbers sit side by
side answering different questions, which is worse than one wrong number
because nothing looks broken.

**The KPI strip is plain numbers** (§14 forbids the gradient hero card). Gross,
after driver pay, loads, miles, cents per mile.

**"After driver pay" is NEVER "profit" or "net"**, and it is an EM DASH for any
period Zebra was not yet settling. Dev, Jul–Sep 2026: gross $2,755,782.16
against $184,774.65 of recorded pay, because 13,517 of those loads were paid in
Datatruck before this system existed. Their pay is UNKNOWN, not zero —
`by-company.ts` already says a zero there "would read as 'this freight cost
nothing to drive', which is the most expensive wrong number this page could
print", and a margin KPI is exactly where somebody would read it. The screen
says where the data starts rather than leaving a reader to wonder about the
dashes.

**Closed history counts in every TOTAL and appears in no QUEUE.** The carrier
earned that money, so it is in the gross (item 7's rule). Nobody can action a
load another system closed and paid two years ago, so it is out of Needs-you —
enforced by `NOT_CLOSED_HISTORY` on every counting row, including the dispatch
row that was safe only by coincidence until 2026-10-01.

**Needs-you is a RIGHT RAIL, not the first thing on the page.** It was the
whole dashboard; it becomes a column beside the money. Rows that count zero are
dropped — a queue of noughts is a queue nobody reads — and a row the session
cannot read is never COUNTED, not counted and hidden.

**~~The thirteen-week series is always thirteen weeks, whatever the period
picker says.~~ REVOKED 2026-10-02, owner's review of the charts on dev.** This
said two windows on one screen were honest "because the heading names each". On
the screen they were not: the bars showed a quarter while the donuts beside them
showed the month, so one dashboard stated two things at once and nothing marked
which. A heading is not enough when two panels disagree at a glance.

**THE PERIOD PICKER DRIVES EVERY CHART, and the windows are ROLLING:**

| period        | buckets        | grain  |
| ------------- | -------------- | ------ |
| Last 7 days   | 7 daily bars   | daily  |
| Last 4 weeks  | 4 weekly bars  | weekly |
| Last 13 weeks | 13 weekly bars | weekly |
| Last 52 weeks | 52 weekly bars | weekly |

**CALENDAR WINDOWS ARE OUT.** _Owner's ruling 2026-10-02, replacing This week /
This month / This quarter / Year to date._ A calendar window is empty for the
first days of whatever it names: "this quarter" on 2 October is two days long and
rendered $0, which is the same defect the default was changed to avoid one ruling
earlier. A rolling window is the same size every day it is opened.

**Each window ends with the CURRENT SETTLEMENT WEEK (Sunday–Saturday), and the
partial current week is drawn as far as today.** So the last bar is short because
the week is unfinished, not because the business fell off — and because that is
exactly the misreading a short final bar invites, THE PARTIAL BUCKET IS MARKED
and its tooltip says so. An unmarked partial bar is a lie of the same family as a
zero-height driver-pay bar.

**The grain is a property of the preset, not of the span.** The span rule that
preceded this — daily under about five weeks, weekly above — existed because a
calendar quarter could be two days old. Rolling windows have a fixed size, so
each preset names its own grain, and "Last 4 weeks" is weekly even though 28 days
would have been drawn daily under the old rule.

**The default is LAST 13 WEEKS.** A quarter of trading, always populated,
whatever the date.

**Every KPI carries a sparkline** over the same buckets, so a figure is never a
number without a direction. Six cells, six sparklines: gross, driver pay, after
driver pay, loads, miles, per mile.

**Every chart carries a legend, in words.** Not a colour a reader has to infer:
solid is gross, grey is driver pay, hatched is "driver pay not yet recorded in
Zebra". A chart with no legend does not ship.

**Every bar carries its value above it and its period below it**, and the plot
carries horizontal gridlines with money ticks. `$12.4k` above, `Sep 20` or
`Oct 2` beneath. Hover shows the full set — week, gross, driver pay, after
driver pay, loads — as a VISIBLE tooltip and not only a `<title>`: a native
tooltip is slow, unstyled, and absent on touch.

**An empty period keeps its axis, its ticks and its legend.** It says no freight
was delivered and shows the shape of the thing that is empty. A blank panel is
indistinguishable from a broken one, which is the same objection §14 makes to
"No data available".

**Panels, in this order:** Charts, Fleet, Cash, Compliance. _Part 1 rendered
them as empty cards; part 3 fills the last three, 2026-10-02._

**FLEET** — the five tiles (trucks with a driver / idle, drivers with a truck /
idle, moving now) plus **top drivers by gross for the window**: horizontal bars,
name, money and loads, top ten, one named remainder. **Both crew seats are
credited on a team load**, which is the same rule the settlement engine applies
and the opposite of how a load count works: one load, two drivers paid, two
drivers credited.

**CASH** — receivables aging as a stacked bar across 0–30 / 31–60 / 61–90 / 90+
with money labels, over **invoiced, unpaid, non-factored** invoices only;
unapplied payments as a figure and a count; and the settlement pipeline as three
money figures, draft / final / paid, for the window. **Money roles only** — not
rendered for a dispatcher, and its query does not run.

**COMPLIANCE** — expiring within 30 / 60 / 90 days as three counts, each linking
to the safety screen, and a DQF complete / incomplete donut.

**The 30/60/90 counts and the Needs-you compliance row are ONE READER, at two
horizons.** _Amended 2026-10-07 (production walk, queue item 20 (8)) — this
said "two questions, two readers", and the office read 96 on the panel against
54 on the row beside it as one number disagreeing with itself._ The Needs-you
row is `complianceQueue`: subjects somebody can act on (no sold or
out-of-service truck, no inactive driver), superseded records dropped, the
authority's own `complianceWarnDays` horizon, expired included. The panel's
three figures were raw SQL over every live `ComplianceItem` row inside 30, 60
and 90 days — sold trucks' lapsed registrations and renewed-then-superseded
records included — and the 42 between the two numbers was that difference,
which nobody on the floor can see. So the panel's figures are COUNTS OVER THE
QUEUE'S OWN ROWS, read once at a fixed 90-day horizon (`horizonDays` overrides
the warn-days reading and nothing else changes), bucketed by days left against
30 / 60 / 90, expired in all three, cumulative. The SQL columns go. The
2026-10-01 ruling stands the other way round: it refused to re-express the DOT
horizon in SQL, and the fix removes the SQL rather than teaching it the subject
rule. The one place the two still differ is THE HORIZON ALONE — a medical card
expiring in 45 days is in the 60-day figure and not in a 30-day Needs-you row —
and the panel's note says so in words. The agreement test is in
`tests/integration/dashboard.test.ts`: a sold truck's expired registration and
a superseded one are in neither figure; a live truck's registration at 20 days
is in both and in all three horizons; the 45-day medical card is in 60 and 90,
not in 30, and not in the row.

**Every panel obeys the part-2b chart rules**: a legend in words, a value on
every bar, the same figures as a visually hidden table, and an empty state that
keeps the axis and the legend.

**Charts carry no charting library and no client JavaScript.** §14 forbids
charts that animate on every render, and the cheapest way to obey that is to
have nothing capable of it.

**BARS AND SPARKLINES ARE HTML AND CSS; RINGS ARE SVG.** _Amended 2026-10-02 —
this said inline SVG for everything._ A bar chart that must carry a value above
each bar, a label beneath it, gridlines behind it and a styled tooltip on hover
is a layout problem, and HTML does layout. The SVG version needed hand-placed
text at computed coordinates for all four, and a native `<title>` for the
tooltip — which is slow to appear, cannot be styled, and does not exist on
touch. A ring has no HTML equivalent and stays SVG.

The tooltip is a sibling element revealed by `:hover` on the bar's group. CSS,
not script.

**A chart's palette is the ACCENT RAMP, never the status hues.** §3.3 fixes
`--color-success`, `--color-warning`, `--color-danger` and `--color-progress` to
meanings; a donut that coloured RAM Haulage red and Dolphins green would be
saying one authority is in trouble and the other is fine. Slices differ in
VALUE, not in kind, so they differ in intensity: `--color-accent` at descending
opacity, with `--color-ink-3` for the remainder. No new token and no hex outside
the block.

**Every chart carries the same figures as a visually hidden table** (§13). A
`role="img"` with a summary sentence tells a screen-reader user what they cannot
inspect; a table lets them read it. The SVG is `aria-hidden` because it is a
second rendering of that table, not the content.

### 6.2 Navigation groups

The spec lists seventeen destinations. Seventeen flat items is a wall. Group them, with the group label at 11px `--z-ink-3`, uppercase, `0.06em` tracking:

- **Operations** — Dashboard, Dispatch, Loads, Calendar
- **Fleet** — Trucks, Trailers, Drivers, Maintenance
- **Accounting** — Invoices, Payments, Payroll, Charges, Reports _(amended 2026-09-28; was **Money** — Invoices, Receivables, Payments, Settlements, Expenses, Fuel)_
- **Records** — Brokers, Documents
- **Admin** — Users, Settings

_§6.2 amended 2026-09-28, owner's ruling. The **Money** group had grown to
eight entries, six of them built, and three of those answered the same question:
`/money/this-week` and `/settlements/batches` and `/settlements` are one week's
pay seen from three distances. A group where three items land on the same
numbers is a group the reader has to try in turn, which is what happened: the
Tuesday screen was the entry point and the other two were reached from it, so
their sidebar entries only ever served people who had lost their place._

_**Two groups, six destinations.** Owner's ruling, 2026-09-28, revising the
one-section shape of the same morning: "the spec was mine and theirs is better."
Datatruck splits Accounting from Payroll and the artefact in
`corpus/datatruck/ui/` shows why — money coming IN and money going OUT are two
jobs, often two people, and one list of five made the reader scan past three
entries to reach the one their afternoon was about._

| Group          | Destination | The question                                                                                 |
| -------------- | ----------- | -------------------------------------------------------------------------------------------- |
| **Accounting** | Invoices    | who owes us, and how old is it                                                               |
|                | Payments    | what came in, and what it paid for                                                           |
|                | Reports     | the same money cut by company, week or driver — and, line by line, what moved on the cheques |
| **Payroll**    | Batches     | what pay runs exist, and what state each is in                                               |
|                | Statements  | what one driver was paid for one week                                                        |
|                | Charges     | what comes off cheques, standing and one-off                                                 |

_**Each destination is tabs over one grid** (§7.1.6):_

| Destination | Tabs                                                    |
| ----------- | ------------------------------------------------------- |
| Invoices    | Invoices · Ready to invoice · Factored · Direct-settled |
| Payments    | Payments · Unapplied                                    |
| Batches     | Batches · Balances                                      |
| Statements  | Driver statements                                       |
| Charges     | Scheduled · Standing · One-time · This week             |
| Reports     | By authority · By week · By driver · Transactions       |

_**What moved, and nothing was deleted.** The five Payroll TABS became three
Payroll DESTINATIONS plus two tabs. Batches and Balances stay together because
both are a run's totals; Driver statements earns its own entry because it is the
document a driver is handed and the thing people arrive looking for; the two
charge tabs join the Charges page, which leaves Accounting for Payroll._

_**"This week" is the third Charges tab, and is where the week-scoped view went.**
Scheduled is org-wide and every week; This week is what comes off the run on
screen. The distinction this section has recorded since it was built survives the
move — two tabs of one page rather than two pages, which is the honest shape for
two views of one table._

_**Standing is the second tab and reads a different table**, which is what keeps
it from being a filter on the first. Scheduled rows belong to a driver; Standing
rows belong to the organization and materialise onto whoever the week produces.
It sits beside Scheduled rather than at the end because the two together answer
"what comes off a cheque", and One-time and This week are both about a particular
week. See §6.2.4._

_**Charges → Scheduled and Charges → This week read the same table and are not
the same grid**, which is the one place this structure could collapse into a
duplicate. Scheduled is org-wide and every week — "who is not paying insurance",
which needs no batch to answer. This week is scoped to the run on screen. A rule
dormant until November appears on the first and not the second, and that
difference is the reason both exist._

_**The batches grid carries a per-company breakdown row under each batch.** The
batch is the organization's by ruling (Islom, 2026-09-11) and its money is not:
settle together, report apart. The breakdown is an indented continuation of its
parent row, never a separate grid — a reader comparing four authorities' shares
of one week is comparing rows that have to be adjacent (rule 1)._

#### 6.2.1 Where Zebra's Accounting differs from Datatruck's, and why

_Added 2026-09-28, against the four Salary and Invoice screenshots in
`corpus/datatruck/ui/`. Zebra is modelled on that surface; these are the places
it deliberately is not, recorded so that "it doesn't look like Datatruck" has an
answer other than somebody's memory._

| Datatruck                                                                                                                   | Zebra                                                            | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Two sidebar groups** — Accounting (Invoice, Salary, Bill) and Payroll (Driver, Dispatcher, Vendor, Charges, Transactions) | **Two** — Accounting and Payroll, on a different split           | _Resolved 2026-09-28: the artefact won._ This row recorded a divergence for about four hours; the owner read it and ruled that theirs is better. The split differs — ours is MONEY IN / MONEY OUT rather than by payee kind, because Zebra settles drivers and pays neither dispatchers nor vendors.                                                                                                                                                                                                    |
| **One batch per pay company** — `SB-000448` Dolphin and `SB-000447` RAM both cover Sep 13–19                                | **One batch for the organization**, with a per-company breakdown | Islom's ruling of 2026-09-11. This is the root of two other differences: it is why Datatruck needs a Pay company COLUMN, and why Zebra needs a breakdown ROW.                                                                                                                                                                                                                                                                                                                                           |
| **Pay company column** carries a real authority                                                                             | **`All authorities`**, with the names on the breakdown rows      | _Resolved 2026-09-28, with no migration._ Datatruck needs the column because a batch belongs to one payer; Zebra's belongs to all of them, so the honest value IS "all authorities" and the split is the breakdown directly beneath. It had been reading `not recorded`, which described the schema rather than the money.                                                                                                                                                                              |
| **`POSTED` / `PARTIAL POSTED`** pills                                                                                       | **`DRAFT` / `FINAL` / `PAID`**                                   | `SettlementBatchStatus` has three values and no partial state. A fourth pill would be a status nothing can produce.                                                                                                                                                                                                                                                                                                                                                                                     |
| **Seven Salary tabs** (adds Salary report, Dispatcher salary)                                                               | **Five**                                                         | The spec names five. Dispatcher pay is not a thing Zebra settles at all.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **`No Rows To Show`**                                                                                                       | **A written empty state with an action**                         | §10 and §14 — "No data available" is listed as an anti-pattern by name. This is the one place Zebra should NOT match the artefact.                                                                                                                                                                                                                                                                                                                                                                      |
| **Footer is a strip of named figures**, left-aligned below the grid                                                         | **Column-aligned sticky foot**                                   | §7.1.2. A sum belongs under the column it sums; a strip makes the reader match figure to column by name. The COUNT is kept in words, as Datatruck has it.                                                                                                                                                                                                                                                                                                                                               |
| **A filter funnel on every column header**                                                                                  | **Both** — funnels that write the URL the bar reads              | _Built 2026-09-28 by ruling._ §7.4's objection was HIDDEN state, and these have none: a funnel sets the same query parameter the bar renders as a chip, so the two are one filter with two handles, and a filtered grid is still a link somebody can send.                                                                                                                                                                                                                                              |
| **Checkbox column, Delete, Change status**                                                                                  | **checkbox selection · Finalise · Mark paid**                    | _Built 2026-09-28 by ruling; reworded 2026-10-01._ This column read "Checkbox and Change status", which named a control the interface does not have: the bar offers TWO BUTTONS that each say where they go, not a status picker. Both run the SAME `finaliseBatch` / `markBatchPaid` per batch, blockers and all — a bulk path that skipped them would be a way to finalise a blocked week from a checkbox. Delete is absent because a batch is money, soft-deleted, and that is not a toolbar action. |
| **Breadcrumb** (`Accounting / Salary / Batches`)                                                                            | **Built, in these two groups only**                              | _Built 2026-09-28 by ruling._ It earns its place here and nowhere else: two groups, six destinations and eleven tabs is the point at which "where am I" stops being obvious. The rest of the shell is one level deep.                                                                                                                                                                                                                                                                                   |

_Eleven more, added 2026-09-29 against `ST-005562.pdf` and the six workbench
screenshots:_

| Datatruck                                                                          | Zebra                                                         | Why                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The trip is the unit** — `TR-016783-01`, a numbered leg                          | **The load is the unit**                                      | Zebra has no trip entity: a load is dispatched once and its stops are its legs. The Trip column prints the load number rather than inventing an `-01` suffix that nothing allocates and nothing can look up.                                                                                                                                   |
| **A `TIME` selector** on the open-batch screen — Delivery time / Pickup time       | **The POD, always**                                           | A settlement week is decided by when the POD landed (MONEY-DESIGN §0). A control offering to bound the window by delivery date would preview a set `openBatch` then refuses to produce — a filter that disagrees with the thing it is previewing.                                                                                              |
| **Four unavailable buckets, one of them a pair** — `In transit outside date range` | **Five, disjoint, with a stated precedence**                  | Zebra adds `no driver` and `no pay rule`, which Datatruck cannot need because a trip there always carries a payee. The PAIR is not reproduced and the reason is the row above: Datatruck ranges on the delivery date, so a load can be both in transit and out of range. Zebra ranges on the POD, and a load in transit has no POD to compare. |
| **Unavailable groups are collapsible rows inside the grid**                        | **A section below, per-reason heading, count always visible** | The counts and the what-to-do sentence never collapse; the load numbers under them do, and are capped. `Already in batch (7,052)` rendered flat is the one shape this screen must not take, and `no pay rule (3)` hidden behind a triangle is the one fact on the page somebody can act on.                                                    |
| **Check date = created + 2** — every batch from `SB-000433` to `SB-000449`         | **Period end + 13**                                           | Zebra's cadence, owner's ruling of 2026-09-27, not a defect in either. Recorded because the two artefacts sit in one folder and the difference otherwise reads as a bug the next time somebody checks a check date against the corpus.                                                                                                         |
| **`Post` the action, `POSTED` the pill**                                           | **`Post` the action, `APPROVED` the pill**                    | §10 says name things as the user names them, and the office says post. A BUTTON names an action and may speak the office's language; a PILL names a stored state on rows somebody was paid on. Renaming the enum is a migration over money that buys nothing a label already gives.                                                            |
| **Per-cell edit pencils** on deduction rows                                        | **No pencil; remove and re-add**                              | Extends the 2026-09-28 ruling to the workbench. A line carries a frozen `payRuleSnapshot`; editing the amount in place leaves the snapshot describing a figure that is no longer on the row.                                                                                                                                                   |
| **`Send to driver`**                                                               | **Built, and it refuses by name**                             | One channel exists (`sendEmail`, Resend) and `Driver.email` is nullable. A driver with no address gets a named refusal. It sends from production only: a dev deploy holds real drivers' real addresses, and a rehearsal that reaches one of them is not a rehearsal.                                                                           |
| **`+ Deduction tariff`** on the workbench                                          | **Not built**                                                 | It creates a STANDING rule from inside one statement. Zebra's standing rules live on Payroll → Charges where they are visible across every driver; a rule created from one statement is how a deduction nobody can find gets onto forty cheques.                                                                                               |
| **`Dispatcher salary` tab**                                                        | **Not built**                                                 | Recorded already at the five-tabs row; repeated here because the workbench's tab bar shows seven and the difference is now visible on two screens.                                                                                                                                                                                             |
| **Fuel: four show-and-deduct modes**                                               | **Built 2026-10-01, migration 61**                            | All four, and the mode is FROZEN on the statement rather than read from the authority at render — §6.2.3. The row stays in this table because the two still diverge: Datatruck's mode is a live setting, and a Zebra statement records the one it was built under, so re-opening an August statement after a policy change shows August's.     |

_**Factored is a tab and not a chip**, added 2026-09-30 by ruling. A factored
invoice is SOLD — the factor collects it, so it is not our receivable and it
does not age on our books. That is a different question about the same rows
rather than a narrowing of the list, which is what §7.1.6 makes a tab. The
status filter beside it IS a chip, because "show me the disputed ones" is a
narrowing of the question already asked._

_**Mark sent is a BULK action on the selection**, through the same
`markInvoiceSent` per invoice, refusals named rather than counted — the same
argument as the bulk status change on batches (§6.2.1). Finishing a week means
sending twenty invoices, and a path that sent them one detail page at a time
would be the reason somebody stops using the screen._

_**Receivables folds into Invoices.** Aging is a view of the invoice list, not a
second list of the same rows — §7.4 already makes a filter a URL, so "over 60
days" is a chip rather than a page._

_**Reports leaves Records for Accounting**, and `/money/by-company` becomes its
company cut. A report is read by the person who reconciles, and they are already
in this section when the question occurs to them._

_**Payroll absorbs This week, Settlements and Settlement batches.** The week
selector is what the three had between them: one page where the week is a
control rather than a route. The per-driver statement stays its own page,
because it is a document somebody prints and hands over._

_Expenses and Fuel stay unbuilt and keep their Phase 5 marker._

Groups render only where the user's role grants at least one child. A dispatcher without financial permission never sees an empty **Money** heading.

Active item: `--z-accent-soft` fill, `--z-accent` text, 2px accent bar on the leading edge. Icons at 16px, always paired with a label. Icon-only navigation is forbidden except in the collapsed rail, which shows tooltips.

#### 6.2.2 The settlement workbench — _added 2026-09-29_

_Owner's ruling, 2026-09-29, against `corpus/datatruck/ST-005562.pdf` and the
six workbench screenshots added to `corpus/datatruck/ui/` the same day._

**The statement page stops being a document with edit panels bolted under it and
becomes the place the week is actually assembled.** The page it replaces was
nine stacked cards — header, trips, lines, totals, add trips, add line,
recalculate, approve, mark paid — each a full-width panel, so a statement with
four loads ran past three screens and the figure somebody opened the page to
check was below the fold. The artefact fits the same work in one screen because
it treats the totals as a HEADER and the edits as ROWS.

Top to bottom, four parts:

**1. The action row**, top-right, belonging to the page (§7.1.6): Add trips ·
Add charges · Recalculate · Send to driver · Post · Export PDF.

**Add trips is present whenever the statement can be edited, even with
nothing to add.** _Owner's ruling, 2026-09-30._ It was the one action gated on
its own contents — shown only when unsettled freight existed — so a week with
nothing outstanding looked like a week where trips could not be added at all.
The panel it opens renders with an empty state instead, which §10 makes an
invitation rather than a dead end: it is where somebody looks to confirm that
nothing is missing, and that is an answer worth being able to reach.

**Export PDF is offered on EVERY statement, drafts included, and a draft's PDF
is watermarked.** _Owner's ruling, 2026-09-30, reversing the same day's
"absent on a draft"._

The earlier rule came from the route, which refused a draft with a 409 on the
reasoning that a draft's lines are rebuilt on every refresh, so a PDF of one is
a figure that will be different tomorrow. That reasoning is sound and it is an
argument for SAYING SO ON THE PAGE, not for withholding the page — the people
who need a draft on paper are the ones checking it before it is posted, which
is the whole job the workbench exists for.

- **The watermark is the disclosure**, diagonal across the sheet, and it is the
  reason the refusal is no longer needed: a document that says DRAFT on its
  face cannot be mistaken for the one somebody was paid on.
- **No number until one is issued.** The Settlement line prints empty on a
  draft rather than showing the placeholder id (§8) — the same rule as the
  heading, on the same reasoning, and the watermark already says why it is
  blank.
- **A settlement with no batch renders too.** Batch ID prints empty and the
  dates come from the settlement's own frozen fields.

**1a. The title.** _Owner's ruling, 2026-09-30._ The settlement number where
one has been issued; otherwise `Draft — <driver> · <period>`. Never the
placeholder id (§8).

**A STATEMENT NUMBER IS MINTED WHEN THE DOCUMENT STOPS BEING A DRAFT**, which
is the rule the title is only the visible half of. `finaliseBatch` already
mints one per settlement; posting a single statement did not, so a batch draft
posted on its own kept `DRAFT-<batch>-<driver>` through APPROVED and into PAID
— and a paid statement carrying a row id is a document somebody was paid on
that cannot be cited. Both paths mint now, and marking paid mints as a
backstop for rows approved before this ruling.

**2. The header box.** One dense block of label:value pairs at body size, in the
artefact's own order and grouping:

**THE HEADER'S COLUMNS, BOTH ENGINES** — _added 2026-10-06, before migration 67_.
Two engines write a `Settlement`: the batch (`settlement-week.ts`) and the
workbench (`settlements.ts`: `generateSettlement`, `addTripsToSettlement`,
`refreshTotals`). Until 67 they filled the header under different names AND
signs — the workbench put the driver's pay in `grossCents`, the add-backs in
`reimbursementsCents`, a POSITIVE `deductionsCents`, and never touched the
other three — so a workbench statement printed its pay under _Total pay_ and
`$0.00` under _Earnings_, the statements grid showed gross `0` for it, its
trips grid was EMPTY (the grid reads `SettlementLoadLine`, which the workbench
never wrote), and the salary report needed a CASE to read the two at once.

- **The batch engine's meaning is the meaning.** `grossCents` is the FREIGHT the
  percentage was taken of (`grossFor`'s decision per load), `earningsCents` the
  driver's cut, `otherPayCents` everything added back (with `reimbursementsCents`
  its reimbursement part), `deductionsCents` NEGATIVE — the ledger's sign, as
  every line table stores it — and `netCents` = earnings + other pay +
  deductions. `advancesCents` is the batch's own "Advance" other-pay row and
  stays zero on a workbench statement, whose `DEDUCTION_ADVANCE` is a
  deduction.
- **Every workbench trip is a `SettlementLoadLine`, like the batch's — migration 69.** 67 left the generate path's trips as `LOAD_PAY` lines in `SettlementLine`
  because the move touched twelve test sites and six readers and was not what
  that ruling asked for; 69 is that move, as its own step. `generateSettlement`
  writes one load line per trip — freight (`grossCents`) from the load's billed
  total, pay (`amountCents`) from the rule in force when the load ran, the rule
  frozen beside it, the broker's reference, the places and the sheet dates on
  the row — and no `LOAD_PAY` line at all. `SettlementLine` is for what is put
  on by hand: accessorial pay, bonus, reimbursement, the typed deductions.
  **The sheet dates keep their plan-or-record flags**: `SettlementLoadLine`
  gains `puActual` and `delActual`, NULLABLE — true or false on a workbench row,
  null on a batch row, which records nothing the batch did not know rather
  than a default that reads as "plan". The drift checker's snapshot arm reads
  the load lines' snapshots (every row that carries one), the statement page's
  separate "Load pay" list goes — the trips grid shows every statement's trips
  now, and a second list of the same freight was the thing the grid existed to
  replace — and `removeSettlementLine`'s guard stays, because a `LOAD_PAY` row
  that somehow survived is still not removable by hand. 69 moves the rows
  already placed (dev: four lines on two statements) with every net asserted
  unchanged.
- **`refreshTotals` is the one header writer for a workbench statement, over
  BOTH tables**: earnings = Σ `LOAD_PAY` + Σ load lines' pay + Σ
  `ACCESSORIAL_PAY`; other pay = Σ `BONUS` + `REIMBURSEMENT`; deductions = Σ
  the `DEDUCTION_*` lines as stored; gross = Σ the `LOAD_PAY` lines' loads'
  billed totals + Σ load lines' freight; net = the three summed. That is
  GAPS.md gap 2 closed by construction: a hand line on any statement moves the
  net by its amount and nothing else, and the drift checker's totals arm
  applies the same rule to the same two tables.
- **A trip added by hand is PRICED, or refused.** `addTripsToSettlement` wrote
  the freight as the pay and its comment deferred the pricing to
  `Recalculate`, which re-adds and does not re-price (`recalculateAction`
  says so in its own words). Nobody had done it to a real statement — 0 of 6
  workbench statements on dev carry a load line — and it is closed before
  anybody does: the amount is `payFor(load, rule in force at delivery)`, and a
  load with no usable rule is refused whole, the way `generateSettlement`
  refuses, rather than added at a hundred percent.
- **Migration 67 is data, not DDL, and touches headers only.** For every
  `batchId IS NULL` statement it rewrites the six money columns by the rule
  above — freight read off the `LOAD_PAY` lines' loads — with `netCents`
  ASSERTED unchanged on every row before the transaction commits. Rehearsed on
  dev with counts: no row is added or removed in any table, and the net
  column's sum is the same number before and after.
- **What retires with it:** the salary report's CASE on `batchId`
  (`salaryByDriverWeek` reads the columns), and the `ST-000018` sign finding.
  The statements grid keeps computing _Deductions_ from the lines, because
  §6.2.6 defines that column as every net-reducing line, not as one header
  figure.

**FREIGHT IS NEVER CALLED "PAY".** _Owner's ruling, 2026-10-06, answering the
question v10.34 flagged._ Per trip line the freight is **Load gross** — Datatruck's
own header, and the word the PDF already printed — beside **Driver gross**, the
cut. In the summary, **Earnings** is the driver's cut before deductions and **Net
pay** is after; **Total gross** renders the freight sum (`grossCents`); **Total
pay** is removed as a label everywhere, on the screen and in the words file, so
it cannot come back under a key that still exists. Row 2 above loses it; row 3
renders _Total gross_ and _Net pay_ as written. The grid column keeps its stored
key (`totalPay`) under the new header, because a column chooser preference is a
row in somebody's settings and renaming the key would silently drop it.

| Row | Fields                                                                        |
| --- | ----------------------------------------------------------------------------- |
| 1   | Settlement no. `‹ ›` · Driver, period `‹ ›` · Driver type · Payment tariff    |
| 2   | Earnings · Other pay / Reimbursements · Deductions / Advances · Trips count   |
| 3   | Total gross · Net pay · Balances · Fuel & toll expenses · Attachments & notes |

- **Not KPI cards.** §7.3 is for a handful of figures somebody watches over time.
  Fourteen of them as cards is a wall, and these are not trends — they are one
  document's arithmetic.
- **Every figure in the header is the sum of something on the page below it.**
  A figure with nothing under it is a figure nobody can check, which is the
  whole objection this system has to a dashboard.
- **`Balances` and `Fuel & toll expenses` carry a Review link, not just a
  number**, because both are sums of rows that live elsewhere.
- **`‹ ›` on the settlement number steps through the batch's statements** in the
  grid's own order; **`‹ ›` on the period steps the same driver through their
  weeks.** Two different journeys, and the artefact puts them on the two things
  they move: a run and a person.

**3. The trips grid** — eleven columns behind a chooser, **nine shown by
default**, because §7.1 caps a table at nine and enforces it by throwing.

| Default                                                                                                   | Behind the chooser |
| --------------------------------------------------------------------------------------------------------- | ------------------ |
| Trip · Load gross · Driver gross · Status · Delivery date · Pickup date · Pickup · Delivery · Total miles | Load number · Unit |

**The Trip column is the BROKER's reference, falling back to Zebra's own load
number; Zebra's number keeps a column of its own behind the chooser.**
_Owner's ruling, 2026-09-30, the screen following the paper._

The statement PDF prints the broker's reference in its Load number column for
the reason the artefact does — `ST-005562` lists `116RX75DK`, and a driver
checking a line against his own paperwork has that number in front of him. A
grid that led with `DT-016018` while the sheet beside it led with the
reference would make the two documents look like different weeks.

- **The fallback is the frozen number**, so a trip is identifiable when the
  reference is missing, empty, or later moved.
- **Zebra's number is still a column**, behind the chooser, because it is what
  the load is called everywhere else in this system and somebody reconciling
  against a load page needs it.

_Corrected 2026-09-29, an hour after this section was written. The brief named
eleven columns, this section copied them, and the page threw §7.1's own error
on its first render — found by the screenshot run refusing to report a pass.
`AGENTS.md`: the design system wins and the contradiction is flagged, not
silently resolved. See `PHASE-5-BRIEF.md` flag 38._

- **`Load number` and `Unit` are the two that go**, and neither is arbitrary.
  Zebra's own number is a key somebody looks a load up by rather than a column
  anybody reads down — and since 2026-09-30 the Trip column already falls back
  to it, so it is only hidden where the reference makes it redundant. The Unit
  repeats: Zebra freezes one truck per settlement, so that column is the same
  number on every row, and it belongs in the header box where `ST-005562.pdf`
  prints it.
- **The artefact is not arguing for a wider table.** Datatruck shows eleven and
  ships a `Columns` control in the same toolbar. What it is arguing for is the
  chooser, which §7.1.4 already specifies.

- **It is the frozen snapshot, never a join to today's load** (§7, and the
  existing comment in `SettlementLoadLine`).
- **One mileage, labelled for which one it is.** The artefact shows 547.78 on
  the grid and prints 568.18 for the same load; the difference is the deadhead.
  The snapshot freezes ONE figure — the total the statement prints — so the grid
  shows that same figure under the header `Total miles`, and the two surfaces
  agree. A second column is a migration (`loadedMilesHundredths` on
  `SettlementLoadLine`) and waits with §6.2.3. **Until it exists, the grid must
  not label the frozen total as `Loaded miles`**, which would make the screen
  disagree with the paper by the deadhead and be the exact argument the freeze
  exists to settle.

**4. Other pay · Deductions · Driver balances**, three grids, each ending in an
**inline add-row** rather than a separate panel:

- Columns are the grid's own: Type (select) · Amount · Quantity · Total ·
  Description · Add.
- **The total is computed and never typed.** ST-005562 prints Quantity and Rate
  and the total is their product; a typed total that disagrees with its own
  factors is a money bug that survives every review because both numbers look
  deliberate.
- **Quantity defaults to 1 and amount to the type's own rate where it has one.**
- **No per-cell edit pencil** (ruled 2026-09-28). A line carries a frozen
  `payRuleSnapshot`; editing the amount in place leaves the snapshot describing
  a figure that is no longer on the row. Remove and re-add.

#### 6.2.3 Fuel and tolls — _added 2026-09-29_

_`FuelTransaction` already exists and carries the purchase; what it does not
carry is anything about being CHARGED to somebody. Owner's ruling, 2026-09-29:
the migration is HELD until production dispatches, so this section splits in
two._

**Built now, because none of it needs a column:** the header box's
`Fuel & toll expenses` figure and its Review panel read the driver's existing
`FuelTransaction` rows for the period, and the CSV importer's stub declares its
required headers and refuses a file it does not recognise. **A read is not a
charge** — nothing on a statement changes, and the figure is labelled as what
was BURNED rather than what was deducted, because those are not the same number
until somebody rules which of the four modes applies.

**~~Waits for the migration:~~ landed 2026-10-01** — every column below, the
deduct side, the `TollTransaction` model and `DEDUCTION_TOLL` are in migration 61. What the charge side does with them:

- **`Settlement.fuelMode` is frozen at refresh** from `CompanySettings.fuelMode`,
  and null where nothing was deducted — writing `RETAIL` on a statement that
  charged no fuel would claim a decision nobody made.
- **One line, not one per fill-up.** The corpus prints
  `Fuel · 1 · $1,234.56` and the detail lives on the workbench's Review panel.
  Twenty fill-ups as twenty statement lines would bury the figure the driver is
  checking.
- **The line says which amount it charged** — `retail`, `retail + fees` or
  `card invoice`. A driver comparing a deduction against the receipts in his cab
  needs to know he is looking at the card invoice, or the two numbers read as an
  error.
- **An INVOICE mode on a row with no invoice amount charges RETAIL and says so
  on the statement.** `invoiceCents` is nullable because it arrives from the
  import; charging zero would be a gift, and charging retail silently would
  produce a number the mode does not describe.
- **`settlementId` on the transaction is the record that it was charged, and it
  is written at FINAL only.** A draft that claimed its transactions would make
  the next refresh of that same draft find nothing and drop the line it had just
  printed.
- **The toll importer does not exist.** `TollTransaction` has a model, RLS, a
  fixture row and a charge path; nothing writes it but the add-row. The fuel
  importer is still the stub that names its columns.

- **Show and deduct are two booleans, not one.** The artefact has "Show fuel
  transactions" and "Add to calculate Fuel transactions" as separate checkboxes,
  and they are separate questions: a company-fuel driver is shown what was
  burned in his truck and charged nothing for it.
- **Retail and invoice are two amounts and the difference is not rounding.**
  $339.92 at the pump, $284.43 on the fuel-card invoice, on the same gallon of
  diesel. Which one a driver is charged is a policy decision that has to be
  recorded per statement, because changing it silently restates what somebody
  was paid. The artefact offers four modes — retail, retail plus fees, invoice,
  and invoice showing both — and all four print a different statement.
- **Money in cents, gallons in decimal** (§8, and `FuelTransaction` already does
  this).
- **Pending and added are states of the transaction, not two tables.** A
  transaction is pending until a statement claims it; the statement that claimed
  it is the record that it was charged once.
- **The importer names what it needs and refuses what it does not recognise.**
  The provider's format is unknown. A stub that guesses a column order will
  silently import the wrong column as money the first time a provider reorders
  its export — so it declares its required headers, fails closed on an
  unrecognised file, and says which header it could not find. A named refusal is
  a working importer for a format nobody has seen yet; a guess is not.

#### 6.2.6 The statements grid — _added 2026-10-01_

_Owner's ruling. The grid one person uses to finish a payroll week._

**The Deductions column is EVERY NET-REDUCING LINE, computed from the lines
and not read off the settlement.** `Settlement.deductionsCents` is written by
two paths that disagree about its sign — the batch engine sums
`SettlementDeductionLine.totalCents`, which is negative, while `refreshTotals`
sums `-amountCents` from `SettlementLine`, which is positive. Dev holds both
today: one settlement at `-45000` beside two at `+45000`. A column rendering
that field shows `-$450.00` beside `$450.00` for the same kind of charge, and
its footer SUMS THEM AGAINST EACH OTHER.

- **One definition, applied to both line tables.** A settlement's charges live
  in one table or the other depending on which path made it, never both, so
  the figure is the sum over both of whatever is negative — rendered as a
  positive magnitude under a column headed Deductions.
- **The stored field is left alone.** It feeds the statement PDF and the
  workbench header, where it is used consistently within each path; changing
  it is a migration over money and a separate ruling. The grid stops trusting
  it; nothing else changes.

**Status and batch are column filters** (§6.2.1's funnels), and the batch one
filters on the NUMBER a reader knows — `SB-000001` — not on an id.

**Post and Mark paid act on a selection**, per statement through
`approveSettlement` and `markSettlementPaid`, blockers intact, refusals named.
Marking paid asks once for the method and the reference, as the invoice
channel does and for the same reason: one wire pays a run, and "how was it
paid" is the question answered wrong from memory a month later.

#### 6.2.5 Applying a payment — _added 2026-09-30_

_Owner's ruling, 2026-09-30. Money arrives as one wire against several open
items; until it is applied it sits unapplied and nothing it paid for looks
paid._

**One list of the payer's OPEN ITEMS, both kinds together.** Direct-settled
loads with a balance and invoices with a balance, in one list — because the
question is "what does this payer owe us", and a screen that answered it in
two tables would make the person add up two subtotals to see whether the wire
is covered.

- **Every row's amount is prefilled to that item's balance and is editable.**
  The common case is a wire that clears its items exactly, and the common case
  should be one click.
- **Partial is allowed and the remainder STAYS UNAPPLIED.** Not forced onto the
  oldest item, not written off. Unapplied money is a real state — §6 already
  says so about `unappliedCents` — and a screen that always zeroed it would be
  inventing an allocation nobody made.
- **ONE TRANSACTION, ALL OR NOTHING.** This is the opposite of bulk Change
  status and bulk Mark sent, deliberately: those are independent acts on
  independent rows where partial success is honest. Here one person is
  DIVIDING ONE PAYMENT, and applying three of their five allocations while
  refusing two would leave a split nobody chose. Every refusal is named.
- **The application rows are written one at a time, not with `createMany`.**
  The audit extension reports `createMany` as an unfollowable operation, so a
  bulk insert would apply money with no audit trail behind it.

#### 6.2.4 Standing charges — _specified 2026-09-30, built 2026-10-01_

_Owner's ruling, 2026-09-30. The second tab on Payroll → Charges, joining
`Scheduled · One-time · This week`. Migration 61 landed on 2026-10-01 and the
tab table in §6.2 now reads four._

_Until that migration this section said the table "still reads three, and
deliberately", so the guard would not be put in the position of enforcing a
plan. It reads four now because the page has four, and the two were amended in
the same commit — which is the whole discipline that sentence was protecting._

**The scope offers four values, not the three this section first named.**
`company drivers / owner-operators / all` leaves lease operators reachable by
nothing but `ALL`, because the driver's type has three members. A charge aimed
at company drivers would silently skip every lease operator. The schema's
vocabulary wins (`AGENTS.md`) and the divergence is recorded in
`PHASE-5-BRIEF.md` §7 rather than resolved in this file. _Since migration 70 the
scope carries the driver's own words — `COMPANY_DRIVER`, `LEASE_OPERATOR`,
`OWNER_OPERATOR` — as `Driver.driverType` does; it was `OwnershipType`'s
`OWNED`/`LEASED` until then, and 70 rewrote the stored scopes with the rows._

**Two charges of one type cannot both be live, and `ALL` clashes with every
scope of its type.** `Ifta` for all drivers beside `Ifta` for owner-operators
charges the owner-operators twice — which is what somebody reaches for when they
mean "everyone pays $20, owner-operators pay $35". That is two rules with a
precedence nobody has specified, so it is refused by name rather than silently
summed.

A **scheduled** charge belongs to one driver. A **standing** charge belongs to
the ORGANIZATION and materialises onto whichever drivers the week produces —
which is the difference that makes it a separate thing rather than a filter on
the existing list. `Ifta` and `Admin Fee` are the cases: every driver pays
them, nobody signs up for them individually, and a driver hired on Tuesday
pays one on Friday without anybody adding a row.

**The rule:** kind · weekly amount · applies to (company drivers /
owner-operators / all) · effective from · effective to · per-driver exemptions.

- **It materialises at REFRESH, one line per settlement**, for every driver
  with freight in the week. Not a view computed at render: the line is a real
  `SettlementDeductionLine` like any other, so it shows on the workbench, it
  prints on the PDF, and it is frozen at FINAL with everything else.
- **A driver with no freight that week gets no line.** The charge follows the
  work, not the roster — billing a week somebody did not drive is the failure
  this sentence exists to prevent.
- **Editing the rule never touches a FINAL or PAID statement.** Same posture as
  `DriverPayRule` and `RecurringDeduction`, and the same reason: those
  documents were handed to a person. A change closes the old row with
  `effectiveTo` and opens a new one; only DRAFT statements pick it up, and they
  pick it up at the next refresh like everything else.
- **An exemption is a row, not a blank.** "This driver does not pay Ifta" is a
  fact somebody decided and should be able to explain, so it is recorded
  against the rule and the driver rather than inferred from an absence.

**HELD FOR MIGRATION 61, and the reason is a finding rather than a
preference.** The existing `RecurringDeduction` cannot carry this: `driverId`
is `String` NOT NULL with a required relation, there is no column for the
applies-to scope, and there is nowhere to record an exemption. Three of the
six fields have no home. See the schema, where the columns are written beside
`Payment.isAdjustment` in the same bundle.

_The workaround that fits today's schema is rejected on purpose: fanning the
rule out into one `RecurringDeduction` per driver at creation. Editing would
then mean superseding N rows, a driver hired next week would not pick the
charge up, and "applies to owner-operators" would be a filter frozen at
creation rather than a property of the rule. That is a different feature
wearing this one's name._

#### 6.2.10 Payroll takes Datatruck's shape — _added 2026-10-05_

From Islom's walkthrough of the system the office already knows. Five parts; this
section is the whole target and each part ships behind its own ritual.

**1 — Opening a batch.** Company (one, or all) · the week, shown · basis · a trip
grid with a tick per row.

- **`SettlementBatch.companyId` is NULLABLE and null is the default.** Null means
  the whole organization, which is the 2026-09-11 ruling unchanged — Zebra settles
  the organization in one run — and a named company is Datatruck's shape for the
  weeks the office wants it. Both are legitimate; neither is a migration of the
  other.
- **A named company scopes its standing charges and its `recentWeeks`.** A batch
  for RAM Haulage must not carry Dolphins' weekly insurance line, and the 13-week
  comparison beside it must be RAM's thirteen weeks. Owner's ruling: the scope
  follows the batch.
- **THE WEEK IS NOT REVERSED.** A batch is a settlement week by construction and
  `openBatch` still refuses anything else by name. The from/to fields SHOW the
  week — they are not free-form, and a reader who types into them is reading the
  wrong screen. The week is what statements are numbered against
  (`settlement-number.ts`), what standing charges are in force for, what
  `recentWeeks` steps through, and what "one batch per period" is enforced on;
  arbitrary windows would unmake all four.
- **The basis selector offers "Delivery time" and nothing else.** It is the
  office's basis. It is a selector rather than a label because Datatruck has one
  and the screens must read alike, and it is honest about having one option rather
  than implying others exist.
- **Columns:** ID · payee · driver type · load ref · status · load pay · pickup ·
  delivery · locations. Nine, which is §7.1's cap exactly, so a tenth goes behind
  §7.1.4's chooser (§7.1.7).
- **"0 available" never stands alone.** _Production walk 2026-10-07, queue item
  20 (7): the week of 9/20–26 showed 0 available and the reasons were a scroll
  away._ The header line that says how many loads were considered now names the
  buckets that took the rest, with their counts, in the picker's order — "16 in
  transit · 5 outside the week · 2 on a statement" — so the answer to "why zero"
  is on the same line as the zero. The groups below stay as they were; this is
  their sum, said first. MEASURED on dev for that week: 23 considered, 16 never
  delivered in Zebra (8 in transit, 6 booked, 2 dispatched — imported freight
  whose status stopped mid-pipeline), 5 with a POD in a neighbouring week, 2
  already on statements, 0 available; the production reading is the same
  statement in the handover.

**2 — The tick is an EXCLUSION, not a selection.** Owner's ruling, and it is the
part worth reading twice.

> Draft = everything settleable in the week, MINUS the trips the office unticked.
> The exclusions are persisted per batch. `refreshDraft` re-adds new freight and
> never un-excludes.

- **Why this way round:** a picked set makes the absence of a trip ambiguous —
  nobody can tell "not chosen" from "arrived after they chose". An exclusion set
  is monotonic: a refresh can only ever ADD freight, so new deliveries appear
  without erasing a decision, and a decision cannot be undone by a background
  recompute. The failure mode of the other design is a trip silently dropping out
  of somebody's pay.
- **It carries who and when**, because unticking a trip is a decision about
  somebody's wages and "why is this not on my statement" has to have an answer.
- Checkboxes default **ticked**. "Select all available" and "Add N trips" read
  naturally on top of that: both are ways of clearing exclusions.
- **Un-excluding is a deliberate act on the batch**, never a side effect of a
  refresh.

**2b — The batch route IS the batch screen.** _Production walk 2026-10-07,
queue item 20 (1), specified before the code._ `/settlements/batches/[id]`
served MONEY-DESIGN item 3's draft list — totals, held lines, blockers — with a
Statement column that linked to the PDF after FINAL and said "Refresh draft"
before it. WHY THE WORKBENCH WAS NOT THERE: part 1 built the trip grid on the
open-a-batch screen, part 2 persisted the ticks, and no part named the route a
batch lives at afterwards — so opening a batch left the office on the picker,
and every link to a batch landed on the printout. The screen was never wrong;
it was the previous screen.

- **The route renders the part 1 grid for ITS OWN batch**: the batch's week and
  the batch's scope, the same nine columns, through the same reader
  (`previewBatch` with the batch named). A trip on this batch's statements is
  available and TICKED; a trip this batch has excluded is available and
  UNTICKED; a trip on another batch's statement stays "already on a statement".
  The ticks are read from the persisted exclusions, which is the only place
  they live.
- **Save ticks writes the DELTA, as one act.** Shown minus ticked is the
  exclusion set the office wants; against the set it has, the difference is
  excluded or included through `excludeTrips` / `includeTrips`, which refresh
  the draft in the same transaction. Nothing else changes a tick. On a FINAL or
  PAID batch the grid is read-only and says so: a document does not have boxes.
- **The item 3 facts stay, below the grid**: the statements table, the held
  lines by name, the blockers by name, the negative nets. **The Statement
  column links to the statement — `/settlements/[id]`, the workbench — in
  every status**, number shown, and the PDF is the statement page's own export.
  A draft is a document somebody is working on, not a thing that cannot be
  opened.
- **Open a batch lands here.** `openWeekAction` redirects to the batch it
  opened, or to the batch already covering the week, rather than leaving the
  picker on screen with a warning.
- **One place for the grid.** The columns and the table move to a server
  component the picker and the batch screen both render, so the nine columns
  cannot drift apart between "what would go in" and "what is in".

**3 — Batch status: DRAFT → PARTIAL → FINAL → PAID.** `PARTIAL` is some
statements final and some not, which is the state the office works in and the one
the enum could not express. Finalising is per statement; the change-status bar
acts on the selected ones (§6.2.1, v10.12). _Specified 2026-10-06, before the
code:_

- **The batch's status is DERIVED from its statements, never set by hand.** None
  approved → `DRAFT`. Some approved or paid, not all → `PARTIAL`. All approved →
  `FINAL`. All paid → `PAID`. It is recomputed in the same transaction as every
  change that can move it — a statement approved, a statement paid, a draft
  refreshed, the batch finalised — so the list and the statements never disagree
  for an instant somebody could press a button in.
- **A refresh rebuilds only the statements that are still `DRAFT`.** An approved
  statement is a document: it has its number (`approveSettlement` mints it before
  the status changes, 2026-09-30) and a person's name on the approval. Today's
  refresh deleted every statement on the batch, which would have destroyed one
  the office had just posted from the statements grid — a latent defect that
  `PARTIAL` makes impossible rather than merely unlikely. The frozen statements'
  trips stay out of the rebuild by the rule that already exists: a load carrying
  a settlement line is not settleable.
- **`finaliseBatch` becomes "approve every statement still in draft".** Same
  outcome as before for a batch nobody has touched; on a `PARTIAL` batch it
  approves the remainder and the derivation lands on `FINAL`. The batch number
  was allocated at open and does not change.
- **The transition to `FINAL` stamps `finalizedAt` and who**, whichever path
  caused it — the last single approve or the batch button. The transition to
  `PAID` stamps `paidAt` the same way.
- **`PARTIAL` wears `--z-warning` on the list** (§3.3: attention — a batch half
  posted is a batch somebody is in the middle of), with its word.

**4 — Transactions report.** Every pay line in a window, by driver, exportable:
trip pay, deduction, advance, adjustment. The vocabulary exists —
`SettlementLineType` carries `LOAD_PAY`, `ACCESSORIAL_PAY`, `BONUS`,
`REIMBURSEMENT` and seven `DEDUCTION_*` — and "adjustment" has no type of its own
today, which this part has to name rather than improvise. _Specified 2026-10-06,
before the code:_

- **A fourth cut on `/accounting/reports`**, beside company, week and driver
  (§7.1.6: a tab is a different question about the same subject). The question
  here is "what moved on the cheques", line by line.
- **A row is one line from one of the three line tables**, and the report is
  their union, not a fourth copy: `SettlementLoadLine` (trip pay — `amountCents`,
  with the trip's gross beside it), `SettlementLine` (every other typed line) and
  `SettlementDeductionLine` (the deductions the statement printed). Each row
  carries the statement it is on, the driver, the batch, the period end as its
  date, the kind, the description and the amount.
- **The four kinds the office uses, mapped from what the schema has — and the
  mapping is written here so it is not improvised twice:**

  | office's word  | from                                                                                                  |
  | -------------- | ----------------------------------------------------------------------------------------------------- |
  | **trip pay**   | `SettlementLoadLine`; `SettlementLine` of `LOAD_PAY` or `ACCESSORIAL_PAY`                             |
  | **advance**    | `SettlementLine` of `DEDUCTION_ADVANCE`; a deduction line whose type is `Advance(s)`                  |
  | **deduction**  | every other `DEDUCTION_*` line and every other deduction line                                         |
  | **adjustment** | `SettlementLine` of `BONUS` or `REIMBURSEMENT` — the two the schema has for "something added by hand" |

  A deduction row also carries §6.2.7's category (standing · fuel & tolls ·
  advances · other) from the same `CASE` that report uses, **source beating
  label**, so the two screens cannot categorise one line two ways.

- **Signs are the ledger's, not a chart's.** Deductions stay negative as stored;
  §6.2.7 flips them because four negative slices are unreadable, and this report
  does not flip them because a transactions list is read down to a net. The
  foot sums to what the statements netted — which is the agreement test.
- **Exportable** through the §7.1.5 route as grid `reports.transactions`: codes
  not labels, cents as decimals, every page of the filter.
- **The window is the picker's** (§6.2.7's rolling picker), bounding the
  statement's period end, and the driver filter is a chip. The report never
  invents a line: a statement with no lines contributes nothing, and a VOID
  statement's lines are excluded because the statement was struck.
- **Agreement test, to the cent:** for every driver in the window, the sum of
  this report's rows equals the sum of `netCents` over that driver's non-void
  statements whose period ends in the window — both sides seeded above zero,
  with at least one line of each of the four kinds.

**5 — Salary report.** Totals per driver per period — gross / deductions / net —
by company, exportable. `reports.driver` is the half that exists (driver, weeks,
gross, deductions, net, with CSV); per-period rows and the company cut are what it
is missing. _Specified 2026-10-06, before the code:_

- **One row per driver per settlement week per authority.** The period is the
  statement's own `periodStart`; a day-grain preset (Last 7 days) still shows
  weeks, because nothing is settled by the day. Newest week first; the §7.1
  totals row foots every money column; the authority chips narrow the rows.
- **Counted by the STATEMENT's status — APPROVED or PAID — not the batch's.**
  `driverTotals` read `SettlementBatch.status IN (FINAL, PAID)`, which was the
  same rule while a batch was either all draft or all final. Part 3 made PARTIAL
  real: a half-posted week carries approved statements that are already
  somebody's pay, and a batch-keyed rule hid them until the last one posted. The
  join also left out every statement the single-statement engine issued
  (§6.2.2's workbench), which has no batch at all. A DRAFT still contributes
  nothing — it is recomputed on every refresh. **§6.2.9's sparkline moves to the
  same rule in the same commit**: "what this driver has been paid" cannot have
  two answers on two screens.
- **The two engines fill the header under different names AND signs, and the
  reader reconciles them in one CASE.** The batch engine writes the driver's pay
  to `earningsCents`, the add-backs to `otherPayCents` and a NEGATIVE
  `deductionsCents` (`grossCents` on its rows is the linehaul the percentage was
  taken of); the workbench engine writes the pay to `grossCents`, the add-backs
  to `reimbursementsCents` and a POSITIVE `deductionsCents`, and never touches
  the other three. `batchId IS NULL` names the engine. The report shows
  deductions NEGATIVE — the ledger's sign, as part 4 does — so on every row
  gross + other pay + deductions = net, whichever engine wrote it. _Unifying the
  columns so the CASE can go is a GAPS.md item; the old report did not have the
  problem only because it never showed a workbench statement._
- **The window is the statement's `periodEnd`**, as part 4's report counts it,
  so the two cuts of one screen agree on which weeks are in. **A removed
  driver's weeks stay**: this is what was paid, and `driverTotals` dropped them
  with `d."deletedAt" IS NULL`, which made a total shrink when a driver left.
- **Seven columns** — driver · authority · week · gross · deductions · other pay
  · net. Other pay is shown because §6.2.9 already had to say the three are not
  an equation without it; with it they are. Exportable as `reports.driver`
  through the same window the screen reads, replacing an export that sent the
  statements list instead.
- **Agreement test:** on every row gross + other pay + deductions = net; per
  driver the net equals that driver's issued statements to the cent, both sides
  above zero, both engines present; and a draft week inside the window — whose
  existence the test asserts first — appears in neither.

**6 — Driver type on the record, on trip rows, on statements.** Company driver or
owner-operator. `Driver.employmentType` already holds
`OWNED ǀ LEASED ǀ OWNER_OPERATOR` — an ASSET ownership enum on a person, where
"company driver" is spelled `OWNED`, which is why it appears nowhere a reader
would look for it. A person's employment is not a truck's title, and the two
reading alike is the reason this needs saying. _Specified 2026-10-06, before the
code:_

- **The word is the office's, from `drivers.employment.*`, keyed by the enum
  value** — company driver · lease operator · owner-operator — and it is the
  same word at every site because the key is built the same way: the batch
  picker (part 1), the statement header, and now the record and the statements
  grid. No second mapping anywhere.
- **On the record**: beside the name in the header, as a word. It was only inside
  the edit form, where it is a select — and a select is where you change a
  thing, not where you read it.
- **On trip rows**: the batch picker's column (part 1). A statement's trips are
  one driver's, so the type is said once in the statement header rather than on
  every row.
- **On statements**: `/payroll/statements` gains a `driverType` column,
  DEFAULT-HIDDEN behind §7.1.4's chooser because the grid is at §7.1's nine;
  sortable, and NOT funnel-able. The funnel matches the stored value (so that a
  filter works in every locale), and a funnel that wants `OWNED` typed for a
  company driver is the exact failure this part names. It gets a funnel when
  the enum gets its name.
- **THE STATEMENT SHOWS THE DRIVER'S CURRENT TYPE, AND THAT IS A FLAG, NOT A
  DECISION.** §6.2.2 freezes the unit, the payee and the tariff label beside the
  number; the type is not frozen, so a driver who converts in June relabels
  January's statements. The frozen copy is a column — `Settlement.driverType`,
  written by both engines at generation — which is migration 66, and the
  deploy order's step 5 holds every new migration behind the production
  dispatch that 64 and 65 are waiting on. This part makes nothing worse: the
  statement header read the live row before it too. _Migration 66 prepared
  2026-10-06, the same day, once 64 and 65 were on production: the column is
  NULLABLE, both engines write it at generation off rows they already read,
  and every reader takes the frozen copy first and the live row only where
  the copy is null — a statement issued before 66 keeps saying what it said._
- **The driver's type has its own name — migration 70.** `Driver.employmentType`
  was an `OwnershipType`, a truck's title on a person, with "company driver"
  spelled `OWNED`. It is `Driver.driverType`, a `DriverType`: `COMPANY_DRIVER ǀ
LEASE_OPERATOR ǀ OWNER_OPERATOR` — the three words the industry says about
  people, which the screens already printed and the column could not. The
  frozen copy on the statement (66) and the standing charge's scope string
  (§6.2.4) carry the same words; `OwnershipType` stays on trucks and trailers,
  where `OWNED` is the plain truth. **The value is seeded from the export, not
  mapped from the old column.** _Owner's instruction, 2026-10-06._ Dev showed 103
  owner-operators to 64 company drivers and the office's screen showed mostly
  company drivers; compared per driver against the Datatruck export's own
  `Driver Type` column (joined on `externalId`), **56 of 167 disagreed** — one
  rule, inverted: 49 the office calls company drivers on 85–100% tariffs were
  stored owner-operators, 7 it calls owners on 30–60% were stored company
  drivers. The seed's tariff threshold had contradicted the office's column for
  a third of the roster. So migration 70 takes the export's word where the
  export knows the driver (170 ids, generated into the migration from the
  artefact rather than typed), the old value only where it does not, decides
  every driver's landing value before the retype and asserts it after; the
  drivers the export does not know are listed for GAPS.md by
  `scripts/driver-type-gaps.mjs`, which reads the id list back out of the
  migration so there is one source. The frozen copy on a statement (66) is
  mapped by its old value: it records what the statement said. The importer's
  planner now prefers the export's column and falls back to the tariff only
  where the column is blank. **And the funnel arrives**: the
  `driverType` column on `/payroll/statements` is funnel-able now, because
  `company`, `lease` and `owner` each match the stored word — which is the
  condition this part set for it.

**Agreement tests, both to the cent:** the trips left ticked sum to the batch's
gross, and the salary report equals the statements it summarises. Same chart and
strip rules as everything else (§6.1.1, §6.2.8's two kinds of figure).

**One migration carries the schema for parts 1–3** — `companyId`, the exclusion
table and the `PARTIAL` value — so the production step is ONE command for the
owner rather than three.

#### 6.2.9 Payroll: the pipeline strip and the figures on the lists — _added 2026-10-04_

**THE PIPELINE STRIP on `/payroll/batches`: draft, final, paid, as money.** Three
figures, three states, **AS OF TODAY** and labelled so — §6.2.8's balance rule,
because "how much pay is sitting in draft" is not a question about a period. Each
links to the batches list filtered to that status, carrying no period filter.

**THEY ARE A PIPELINE, NOT A PARTITION, AND THE ORDER IS THE POINT.** Draft is
being built and can still change; final is approved and unpaid — money the carrier
owes this week; paid has left the account. A figure that merged them would hide
the only one with a deadline.

**PER-BATCH GROSS, NET AND DEDUCTIONS ON THE BATCH LIST.** Three money columns
from the statement that already groups the batch's settlements — no extra query.

**AND THE THREE ARE NOT AN EQUATION.** `net = gross − deductions + reimbursements

- other pay`, so a reader checking `gross − deductions` against net will be out by
  whatever was added back. The columns are not placed to invite the subtraction, and
  §8's rules about labels apply: _Deductions_ is what came off, never "expenses".

**A NET-PAY SPARKLINE PER DRIVER ON `/payroll/statements`.** One row, one shape:
what this driver has been paid, settlement week by settlement week, so a week that
collapsed is visible beside the week that caused the phone call. §6.1.1's
sparkline, unchanged — no axis, no labels, the figure beside it is the number.

**THE SERIES IS THE DRIVER'S OWN HISTORY, NOT THE WINDOW'S.** A sparkline over
four points says nothing, so it runs over the last thirteen settlement weeks
whatever the picker shows — and that is a DELIBERATE exception to "the picker
governs everything below it", written here because it is the only one in the
product. The row's figures are the window's; the shape beside them is the
driver's. A week with no settlement is a GAP, never a zero: unpaid and
not-yet-settled are different facts, and §6.1.1 already refuses that zero.

**THE PICKER GOVERNS THE LISTS, BY THE DATE EACH LIST ALREADY SORTS AND FILTERS
ON** — the batch CHECK DATE, the settlement period start, the one-time charge’s
apply date. Each shape names it in `dateOf`, and the picker writes the same
`from`/`to` the removed range wrote, so the window means what the list already
meant by a date.

_This sentence said “by the batch’s period start” when §6.2.9 was written, which
is not what `batchShape` filters on: it is the check date, and the range this
replaces was labelled “Check date”. Corrected before the code rather than
silently built to match the doc or the doc quietly bent to the code._

**BATCHES KEEPS ITS WEEK PICKER AS WELL.** That control chooses which week a run
is FOR; the period picker chooses which runs are listed. Two questions, two
controls, and §6.2.1 settled that they are different.

#### 6.2.8 The summary strip on Invoices and Payments — _added 2026-10-04_

**Four money figures across the top, each one a LINK to the list it summarises.**
Invoices: open, overdue, factored. Payments: unapplied, with its count. A figure
nobody can act on is a notification; the link is what makes it a control (§10).

| figure    | what it is                                                  |
| --------- | ----------------------------------------------------------- |
| Open      | issued, not factored, balance outstanding                   |
| Overdue   | open, and past its due date                                 |
| Factored  | issued and SOLD — the factor collects it, so it is not open |
| Unapplied | money received that is not against an invoice yet           |

**FACTORED IS NEVER INSIDE OPEN.** §3.3 again: a sold invoice is the factor's
receivable. The three figures therefore partition the issued paper rather than
overlapping, and overdue is a SUBSET of open — stated on the strip, because
three figures that look parallel and are not is worse than four.

**STATUS CHIPS CARRY COUNTS, AND THE COUNTS COME FROM SQL.** The tab counts on
these screens were computed from the list reader's rows — `readInvoices` takes
2000 and `listPayments` takes 300 — so a count was right only while the business
was small enough not to need it. Any count on a chip or a tab is a `COUNT(*)`
over the same predicate the chip filters by.

**THE SAME PICKER AND CHIPS AS EVERY OTHER CHARTED SCREEN**, and they replace
the `from`/`to` range here as they did on Reports (§6.2.7): one window control,
never two.

**TWO KINDS OF FIGURE, TWO LABELS, NEVER MIXED.** _Owner's ruling, 2026-10-04,
resolving flag 49 — which recorded the opposite arrangement and the trade it
made._

| kind          | figures                                                      | label            | window       |
| ------------- | ------------------------------------------------------------ | ---------------- | ------------ |
| **A balance** | Open, Overdue, Factored (Invoices); Unapplied (Payments)     | _as of today_    | none         |
| **A flow**    | Invoiced in window (Invoices); Received in window (Payments) | _in this window_ | the picker's |

**A BALANCE IS NOT A PERIOD QUESTION, AND WINDOWING ONE HIDES THE WORST ROW IN
IT.** An invoice issued five months ago and still unpaid is the one somebody most
needs to chase, and a thirteen-week window made it invisible — in the figure, on
the screen whose job is to show what is owed. So the balances have no date bound
at all.

**AND THEIR LINKS CARRY NO PERIOD FILTER**, which is what keeps the agreement
honest: a figure with no window must open a list with no window, or the number
above the rows is not the number the rows add up to. `?period=all` is that state.
It is NOT a fifth preset — the picker still offers exactly four (v10.17) and
shows none of them active in this state; the reader leaves it by choosing one.

**THE FLOW FIGURE IS WHERE THE PICKER SHOWS UP ON THE STRIP**, so the control is
not decorative: it moves that figure, and it moves the list and the chip counts
with it. With `?period=all` the flow figure covers every date and says _all
dates_ rather than silently becoming a second balance.

**THE CHIP COUNTS DESCRIBE THE LIST, SO THEY ARE WINDOWED**, and they will
therefore differ from a balance above them — the unapplied chip counts this
window's payments, the Unapplied figure is every unapplied dollar. That is the
reason for the two labels: the only thing that makes two different true numbers
on one screen readable is saying which question each answers.

#### 6.2.7 Accounting → Reports: the charts — _added 2026-10-03_

Reports was three tables. It becomes the same three tables under four charted
sections, on §6.1.1's chart contract and §6.1.1's window.

**ONE WINDOW CONTROL ON THE SCREEN, AND IT IS THE ROLLING PICKER.** Last 7 days
/ Last 4 weeks / Last 13 weeks / Last 52 weeks, each ending with the current
settlement week, partial week drawn as far as today and marked, default Last 13
weeks (§6.1.1, v10.17). The picker and the authority chips are the SAME
components the dashboard uses — not copies. A second date control beside them
would be the two-window arrangement v10.16 revoked: one screen saying two
things, with nothing looking broken.

_This REPLACES the `from`/`to` range and the weekly/monthly toggle this screen
carried. Monthly grouping is no longer offered, because v10.17 makes grain a
property of the preset rather than a control — and a month that is not a whole
number of settlement weeks cannot be drawn on an axis aligned to them. A
removed control is recorded rather than quietly dropped: `PHASE-5-BRIEF.md` §7
flag 45._

**BY COMPANY** — weekly bars per authority: gross, driver pay, after driver pay,
with the hatch for a bucket whose pay was never recorded (§6.1.1). The matrix
table stays underneath, totals row included: the chart answers "which way is
this going" and the table answers "what exactly", and neither replaces the
other. Closed history is INCLUDED in gross here and excluded everywhere else,
which is item 7's rule and the reason this page exists.

**RECEIVABLES** — two charts.

1. The aging stacked bar, 0–30 / 31–60 / 61–90 / 90+, the SAME component and
   the SAME reader as §6.1.1's Cash panel.
2. Invoiced vs collected per week.

**FACTORED PAPER IS ITS OWN SERIES AND IS NEVER INSIDE COLLECTED.** A factored
invoice is sold — the factor collects it — so it is neither a receivable (it is
out of the aging bar, §3.3) nor money the carrier collected. For the same
reason COLLECTED excludes payments whose method is a factoring method: counting
a factoring advance as collection, beside the invoice it advanced against,
double-counts the same freight.

**SETTLEMENTS** — paid-per-week bars, gross against net, over batches that have
been PAID; and a deductions-by-category donut for the window.

**THE FOUR DEDUCTION CATEGORIES ARE ASSEMBLED, NOT STORED, AND THE PRECEDENCE
IS PART OF THE CONTRACT.** `SettlementDeductionLine` has no category column: it
carries a printed `type` label and the id of the rule or one-off that produced
it. So the four buckets are derived, in this order, first match winning:

| bucket           | rule                                                       |
| ---------------- | ---------------------------------------------------------- |
| Standing charges | `recurringDeductionId` matches a `StandingCharge`          |
| Fuel & tolls     | `type` is `Fuel` or `Toll`                                 |
| Advances         | `type` is `Advance`                                        |
| Other            | everything else — insurance, escrow, equipment, violations |

Precedence matters because the categories overlap: an org-wide fuel charge is
both standing and fuel, and a donut whose slices overlap is not a share of
anything. SOURCE BEATS LABEL, because "what did the organization's own rules
take off these cheques" is the question somebody asks of this chart.

**ONLY NEGATIVE LINES.** `totalCents` is signed and Other Pay shares the table;
a donut of "deductions" that included reimbursements would net two opposite
things into one slice.

**EVERY FIGURE TIES TO THE CENT TO THE SCREEN IT SUMMARISES** — invoiced to the
invoices list, collected to the payments list, paid-per-week to the batches
grid, aging to the Cash panel — and there is one agreement test per figure with
both sides seeded above zero. A test where both sides are empty agrees about
nothing, which is the most comfortable way to be wrong.

**THE CHARTS DO NOT READ THE LIST READERS, BECAUSE THE LISTS ARE CAPPED.**
`readInvoices` takes 2000, `listPayments` takes 300, `directAging` takes 500. A
52-week aggregate built on a reader that stops at 300 rows is wrong exactly
when the business is busy, and silently. So the charts aggregate in SQL and the
agreement tests hold over a window where the list is not truncated — which is a
real limit of the claim above, stated here rather than discovered later.

**ONE AGING RULE.** `agingBucketFor` in `factoring.ts` is the authority — a
bucket boundary is `daysPastDue <= 30`, inclusive — and any SQL expression of
it must agree at the boundary, with a test that seeds 29, 30, 31, 60, 61, 90
and 91 days past due. The dashboard's panel statement was off by one against it
until 2026-10-03; see flag 46.

**NO NEW CHART COMPONENT.** `BarChart` carries the weekly money bars, the
invoiced/collected bars and the paid-per-week bars; `Donut` carries the
deductions; the aging bar becomes a shared component extracted from the Cash
panel. `Sparkline` is not used on this screen — a figure here always has its
bars beside it, so a second shape of the same series would be decoration.

**EMPTY KEEPS THE AXIS AND THE LEGEND**, per §6.1.1, on all four sections.

### 6.3 Company filter

_Amended 2026-07-29. This section previously described a company **switcher** — a
modal control that put the interface into one authority at a time. That was
wrong, and wrong in a way that would have shaped every screen built on top of
it. Reason for the change: a dispatcher's actual question at 6am is "what is
running today", across all authorities the group operates. A mode forces them
to ask it twice and then hold the answer in their head. Worse, a mode makes
"which authority am I in" a piece of hidden state, and hidden state is exactly
what produces the outcome this section already warns about._

The topbar company control is a **filter**, not a mode. A user sees every
authority they are scoped to at once; the control narrows the view.

- Tables gain a company column and a per-company colour chip **only when the
  organization holds more than one company** (`maxCompanies > 1`). A
  single-authority organization sees none of this — no filter, no column, no
  chip.
- Creation forms take the operating authority as their **first field**,
  defaulting to last-used. The authority is an explicit, visible choice at the
  moment of writing, not an ambient setting that was decided earlier and
  elsewhere.
- **A destructive or financial action taken under the wrong authority is still
  the worst outcome this interface can produce.** The filter does not prevent
  that; the required first field does. Which is the point of moving the
  decision into the form.

### 6.4 Drivers take Datatruck's shape — _added 2026-10-07_

Queue item 16, the owner's brief (`docs/QUEUE.md` §16), three parts: the list,
the record's tabs, team drivers. This section is written part by part, each
before its code. Where the brief meets a ruling already in this file, the
ruling wins and the brief's wording is answered rather than obeyed.

**1 — The list.** `/drivers` on the grid machinery every Accounting list already
runs on: `readGridColumns` with the §7.1.4 chooser, `gridView` for filter → sort
→ paginate, the funnels, the §7.1.2 footer, saved views (§7.4). _Specified
2026-10-07, before the code:_

- **Five tabs over one grid (§7.1.6), each a different question:**
  **Active** — the roster at work: not removed, not `INACTIVE`, not `VACATION`.
  **Unassigned** — Active with no truck: the dispatcher's own question.
  **All** — every roster row that is a person, whatever their state; a REMOVED
  row (`deletedAt`) is a mistake and not a person, and stays behind the
  existing toggle rather than in a tab.
  **Terminated** — `INACTIVE`, with the termination date as a column.
  **Vacation board** — `VACATION`, or an off-duty return date still ahead, with
  the return date as a column. The tab is in the URL, first tab default, each
  tab counted by a `COUNT(*)` of its own question (§6.2.8), never by the length
  of a capped list.
- **Ten columns, named by the brief, inside §7.1's cap (§7.1.7):** name · assign
  status · driver type · status · last activity · authority · phone · email ·
  truck · warnings — eleven with the CDL column that already exists. Email and
  CDL are DEFAULT-HIDDEN behind the chooser; warnings is never hidden; the
  authority column appears only with more than one authority (§6.3). The
  Terminated and Vacation board tabs swap in their date column.
- **"Employee status" is not a second column.** The brief lists it beside
  "driver status"; the owner's ruling of 2026-09-21 is ONE status per row,
  because two columns were two answers to one question. Here the tab IS the
  employee status — Active, Terminated, Vacation board — and the one badge keeps
  its rule: the derived dispatch status, except where the roster says something
  the freight cannot know. On All, where the tab says nothing, the badge says
  it. _Flagged as the brief's wording answered, not obeyed._
- **ASSIGN STATUS — Ready to go / Not ready — is DERIVED on read and never
  stored.** A driver is ready when they are qualifiable (§6.2's DQF rule: on the
  roster, not a referral payee), their DQF has nothing missing or expired, a
  truck is assigned, and that truck carries no expired compliance. "Not ready"
  NAMES THE FIRST REASON in words beside the badge — DQF, no truck, truck
  expired — because a red that does not say why is a red people learn to
  ignore. One pure function, `readinessFor`, in `src/lib`, with both branches
  tested; the facts come from the two loaders the page already runs once for
  the whole list, plus the trucks' compliance read once for the trucks on the
  page.
- **Filters stay chips (§7.4):** needs attention, the dispatch status, the tag,
  the company filter; the funnels (§6.2.1) on type, authority and truck write
  `f.<key>` like every other grid; the search box matches name, phone and
  email.
- **Bulk actions are ROSTER actions only:** checkbox selection, then Mark active ·
  On vacation · Terminated — the three values the form offers (owner's ruling,
  2026-09-21), written per driver through the one edit function and refused on
  a removed row. Nothing bulk touches freight, pay or compliance.
- **Saved views are per grid.** `view.loads` becomes one key of several; the
  component and its actions take the grid, and `/drivers` saves under
  `view.drivers`. Twelve per user, as before.
- **Export is NOT built in part 1, and that is flagged.** §7.1.5's export is the
  Accounting contract — one shared reader, codes not labels, every page of the
  filter — and §7.1.7 kept `/loads` and `/trucks` out of it for lacking that
  reader. `/drivers` lacks it too, and a drivers-only exception would be a second
  definition of what a list export is. The three operational lists get their
  export together, as one decision, or not at all.
- **Import file is NOT a screen in part 1, and that is flagged.** The Datatruck
  driver import exists as `scripts/seed-datatruck-drivers.ts`, preview by
  default, run by a person with the export in hand. The loads import was a
  screen and was removed as a destination because it read the wrong file for
  most of what the office imports; a drivers file picker would repeat that
  precedent before anybody has asked what file it would read.
- **The page reads 500 rows, not 200, and says so in the footer** when the
  filter selected more: warnings and readiness are computed, so there is nothing
  to page in the database, and a list that silently showed 200 of 240 drivers
  on All was the kind of cap this section replaces with a stated one.

**2 — The record.** `/drivers/[id]` was one long page of panels; it becomes
ELEVEN TABS over one page, the brief's names in the brief's order. _Specified
2026-10-07, before the code:_

- **The tab is in the URL (`?tab=`), Main is the default, an unrecognised value
  opens Main** — the same rule §7.1.6 gives a list, for the same reason: a stale
  link should open. **A tab a role may not see is NOT RENDERED**, never a tab
  that goes empty inside; the gates are the ones the panels already carry
  (`driver.pay`, compliance, inspections), decided in `permissions.ts` and
  applied here. Nothing is fetched that the open tab does not show.
- **Each tab reads what exists today:**
  **Main** — the record form and the authority actions, as today, plus two
  fields the form lacked (queue item 17, 2026-10-07): **kind** — a person or a
  referral payee, a select over `DRIVER_KINDS`, refused in words outside the
  list — and **tags**, one text field split on commas by the same rule the
  import uses, so a tag typed here and a tag imported are the same tag. Both
  under `driver:update` like the rest of the form; that is the ruling the item
  implies for who may turn a person into a payee, and it is flagged as such.
  **Documents** — the driver's documents, as today.
  **Mobile app login** — NOTHING EXISTS: Zebra has no driver app. The tab says
  so in one sentence and names what it will hold (a login and its last sign-in)
  when there is one.
  **Recruiting** — NOTHING EXISTS: the Tenstreet pipeline is deferred
  (`docs/QUEUE.md`). One sentence.
  **Accounting** — pay rules, pay-to, standing deductions, opening balances.
  Money roles only; the tab does not exist for a dispatcher. **Pay-to is its
  own small form** (queue item 17, 2026-10-07): name and address, one Save,
  under `driver.pay:update` like the pay rules beside it, because who a
  statement is made out to is a pay fact. The statement READS these at
  generation and FREEZES them (`Settlement.payToName`), so a change here
  applies to the next statement and restates nothing already issued — the
  sentence under the form says so. Until this item they were read-only and
  the Datatruck import was their only writer.
  **Safety** — CDL and medical card as the compliance rows they already are,
  the DQF checklist, the compliance panel, the random-testing draws that
  selected this driver (or one sentence when none has), inspections.

  _The DQF checklist, amended 2026-10-07 (production walk, queue item 20 (4),
  before the code):_ **a live CDL compliance record satisfies "Copy of the
  CDL".** The row read only a `CDL_COPY` document, so a driver whose licence
  is on file as the dated `ComplianceItem` the alerts already watch showed the
  row MISSING, and the office saw files red for a licence it had recorded. Now
  either satisfies it: the document, undated, reads present; the record alone
  reads by its date — present, due, expired — the way the medical certificate
  does. The record stays out of `DQF_COMPLIANCE_TYPES`, because its expiry
  already warns through Phase 4 and a second warning for one date is one fact
  twice. **And a missing hire date is its own row, not a reason the file reads
  8 of 8 missing.** A driver with no recorded hire date showed every at-hire
  item "missing — no hire date recorded" and a summary that counted the file
  against a date nobody had typed. The checklist now opens with **Hire date
  recorded** (391.51, at hire, evidence the `Driver.hireDate` fact): present
  when it is set, missing when it is not, counted like any other row — so the
  office fixes the date where it is missing and the other rows date themselves
  from it. Nine rows; the roster's totals and the readiness badge read the
  same list.
  **Assets** — the current truck and trailer, then the assignment history from
  `AssetAssignment` periods for this driver, newest first, each with its reason
  and who did it. The Datatruck import wrote no periods, so a driver with none
  gets the sentence, not an empty table.
  **Statistics** — the on-time rate (as today), loads and miles over the last
  thirteen settlement weeks, and for money roles the net-pay-by-week shape
  §6.2.9 already draws, read by its reader. Figures, each with the window it
  counts; no chart that §6.1.1 would then have to govern.
  **Log history** — §7.10's ONE stream, for a person: created, field edits and
  deletion from `AuditLog`, documents by their upload, notes — through the same
  `activityEntries` the load uses, so money fields are omitted for a dispatcher
  by the one rule. A status entry is a load's kind of fact and does not apply.
  **Tasks** — NOTHING EXISTS. One sentence.
  **Others** — tags, notes and kind (a person or a referral payee): the facts
  that fit nowhere else, read here and changed on Main, which the tab says in
  one sentence. (Until queue item 17 kind and tags had no editor — GAPS code
  gap 10, closed 2026-10-07.)

- **"Says so in words" is a rule, not a tone.** A tab with nothing behind it
  renders one sentence stating the fact and naming what the tab will carry —
  never an empty panel, never a placeholder control that does nothing, never a
  grey table with no rows. Three tabs begin that way, and the sentence is the
  honest screen until they do not.
- **What this part does NOT change:** the panels themselves. Every tab renders
  the component the long page rendered, under a tab instead of a scroll; the
  new readers are the assignment history, the per-driver draws, the
  thirteen-week counts and the driver's timeline, and each is a function in
  `src/lib` with its merge order tested where it has one.

**3 — Team drivers.** A truck carries up to two drivers; both seats on the
load, both on the statement, shown on both records as "Team with". _Specified
2026-10-07, before the code, and MEASURED FIRST on dev:_ 90 trucks carry no
live driver, 25 carry one, 4 carry two, none carries three; 0 of 14,467 loads
carry a second seat; 0 of 142 statements froze a team-mate; and each of the
four pairs is one person imported twice (GAPS, duplicate driver rows).

- **Nothing new is stored.** A team is DERIVED three times over and this part
  adds no fourth place: two live drivers holding one truck
  (`Driver.assignedTruckId`, one row per seat), a load with its second seat set
  (`coDriverId`, the schema's own rule), a statement with its crew frozen
  (`teamWith` / `referralWith`). `src/lib/team.ts` is the one place the seat
  count and "who is my team-mate" are answered, so the records, the load form
  and the pairing writer cannot drift on either.
- **The cap is applied where the pairing is written**, in `fleet.ts` through
  `assertSeatFree`, for create and update alike, and refused in words
  (`truck_full`). The driver form does not know the number: an import, a
  script and a second screen reach the same writer, and only one of them has a
  dropdown. A driver keeping the truck they already hold is not counted against
  themselves. VACATION and OFF_DUTY keep their seat; INACTIVE and removed do not.
- **Both seats on the load, by the dispatcher's hand.** When the load's driver
  has a team-mate, the assignment form's second seat is PRE-FILLED with them
  and a sentence beside it says who and from which unit; pressing Save writes
  it, clearing the select does not. A SUGGESTION AND NOT AN ENGINE WRITE,
  because the four pairs that exist today are duplicates, and a silent fill
  would pay one person twice on every RAM Haulage load until the accountant
  merges them. The pre-fill is offered only when the team-mate is in the
  assignable list, so the control never names someone it cannot save.
- **Shown on both records.** The driver record's header names the team-mate
  after the type, as a link; the truck record's header lists its crew, or says
  in words that no driver holds it. The statement already prints "Team with X"
  from the frozen column and is not touched.
- **What this part does NOT change:** the settlement split (each crew member
  is paid their own rule on the same gross, §6.2), the import's second-seat
  resolution (`CoDriverSeat`, which left every seat empty because the column
  named carriers), and the referral payee's place (`referralWith`).

### 6.5 Trucks take Datatruck's shape — _part 0 added 2026-10-07_

The brief for the list and the record comes from Islom's next screenshots
(`docs/QUEUE.md` item 18). Part 0 precedes the screen, by the owner's
instruction of 2026-10-07: _"a 'data health' row on the Trucks list footer and
on GAPS — counts of trucks missing VIN, plate, odometer, registration expiry,
annual inspection — each a link to the filtered list. Same later for Drivers.
The office fixes data faster when the screen counts it."_

**0 — Data health.** _Specified before the code, and MEASURED FIRST on dev:_ of
119 live trucks, 26 have no VIN, 9 no plate, 119 no odometer, 29 no
registration record at all, 97 no annual-inspection record at all. (70 carry an
EXPIRED registration and 11 an expired inspection — those are the warnings
column's business and GAPS' "stale compliance dates", not this row's.)

- **Five counts, one definition each, in `src/lib/data-health.ts`.** VIN, plate
  and odometer are MISSING when the column is null or blank. Registration and
  annual inspection are MISSING when the truck carries NO live `ComplianceItem`
  of that type — a record whose expiry has passed is present and stale, which
  §6.1.1's 30/60/90 counts and the warnings column already say; counting it
  here too would make one fact two numbers. Removed trucks count nowhere.
- **The row sits under the grid, in the footer's register, and every figure is
  a LINK** to `/trucks?missing=<check>`, which applies the same definition as a
  query filter and keeps the other filters in the URL. Zero is SHOWN, never
  hidden (§7.1.6's rule for a count): a row that drops its zeros teaches the
  office that an absent figure means fine. The counts are over the list the
  user may see — company scope and the authority filter apply; the
  attention and tag filters do not, because the row answers "how much of my
  fleet is incomplete", not "how much of this view".

  **AND AN EMPTY SCOPE IS EVERY COMPANY, as it is everywhere else.**
  _Production walk 2026-10-07, queue item 20 (3)._ `companyScopeFilter`
  reads an empty scope list as "unscoped" — the owner's scope is `[]` — and
  the first cut of the counts read it as "no company", so both footers said
  0 for exactly the people who look at them while the grid showed the gaps.
  The filter was never wrong: `?missing=odometer` on a fleet where no truck
  has an odometer lists every truck, which is the right answer, and the
  number beside it said 0. The count and the filter now share the scope rule
  as well as the predicate, and the agreement test runs once with a named
  company and once unscoped, on a blank-odometer truck row, so the two
  readings cannot differ by scope again.

- **One query for the five**, a single `SELECT` with five filtered counts,
  inside the page's transaction beside the rows. Not five `count()` calls and
  not a count per row.
- **GAPS carries the same five figures as a Data row**, with the five links, so
  the file that lists what is wrong names the screen that counts it. The
  figures in the file are the reading of the day they were written; the screen
  is live.
- **Same later for Drivers**, by the owner's words: the module is written per
  subject so the drivers list adds its own five without a second footer design.

**0b — Data health for Drivers.** _Owner's five, 2026-10-07, after part 0
reported: "no CDL on file, no medical card, no phone, no pay rule, no truck
(active drivers only)." Specified before the code and MEASURED FIRST on dev:_
of 59 active person drivers, 13 have no CDL record, 59 no medical-card record
(none exists on dev at all), 6 no phone, 2 no pay rule in force, 26 no truck.

- **Active drivers only means the Active tab's population, and PEOPLE.** Live
  rows on a working roster value (`AVAILABLE · DISPATCHED · ON_ROUTE ·
OFF_DUTY`), and `kind` not a referral payee — a payee has no licence, card
  or truck by its nature, and `driver-kind.ts` already keeps it out of the DQF
  and the compliance warnings for that reason. Terminated and vacation rows are
  not counted: a gap on a row nobody can dispatch is not a gap the office can
  act on this week.
- **"On file" is a live `ComplianceItem` of the type** — the licence record with
  its expiry (`CDL`), the medical certificate with its expiry (`MEDICAL_CARD`).
  Missing, not stale, as for trucks: an expired card is a record, and the
  warnings column says it is expired. The DQF's own CDL item is a COPY of the
  licence, a document, and a different fact the DQF watches; the two are not
  merged here.
- **"No pay rule" is no rule IN FORCE TODAY**, by `ruleInForce`'s own test
  (`effectiveFrom ≤ now` and `effectiveTo` null or `≥ now`), because a driver
  whose only rule has closed generates an empty settlement exactly like one
  who never had one. A rule dated to start next week does not count as one.
- **No phone is null or blank; no truck is `assignedTruckId` null.**
- **The same row, the same module, the same agreement test.** The row sits
  under the Drivers grid as under the Trucks grid, every figure a link to
  `/drivers?missing=<check>` with the tab and the other filters kept; the
  filter applies the same `where` as the count, over the same base, so the
  number and the list agree whichever tab is open. One statement for the five.
  GAPS carries the day's reading with the five links. The component is the
  one the trucks row uses, made generic over the check list rather than copied.
- **Then hold for the Trucks brief**, by the owner's words. Nothing of item 18's
  list or record is built until the screenshots arrive.

### 6.6 Safety — the accident register's driver picker — _added 2026-10-07_

_Production walk 2026-10-07, queue item 20 (6), specified before the code._ The
register's driver select listed every live driver row of the chosen authority
— terminated drivers and referral payees included — because its query asked
only "not removed". The owner's words: **the picker is the active drivers of
the authority.**

- **"Active" is the one word the product already has for it**: the Active
  tab's population (§6.4 part 1) — live rows on a working roster value
  (`AVAILABLE · DISPATCHED · ON_ROUTE · OFF_DUTY`) — and PEOPLE, never a
  referral payee, which is a commission and cannot be in a truck (§6.5 part
  0b's rule, for the same reason). ONE predicate, `activeDriversWhere()` in
  `driver-list.ts`; the drivers' data-health base reads it rather than
  restating it, and the picker reads it rather than writing a third.
- **Scoped to the chosen authority**, as before: an accident is one
  company's register.
- **The register records and voids; it does not edit.** So a picker that
  narrows to active people leaves no old entry without its driver: the entry
  carries its own driver by name, and a later termination changes the picker
  and not the record.

### 6.7 The loads list takes Datatruck's shape — _added 2026-10-08_

Queue item 21, the owner's brief from Islom's screenshots (`docs/QUEUE.md`
§21). Nine items. 1–6 ship as one chain and 7–9 as a second. This section
specifies all nine before any code. Where the brief meets a rule already in
force, the rule wins and the brief's wording is answered here rather than
obeyed. Kept from today's list: the warnings column, the billing chips, and the
authority chips. Not added: a trip planner, LTL, and generic bulk actions.

**Every filter on the list is ANDed.** The list used to merge its filters with
object spread, so two filters that each carry an `OR` overwrote each other.
`?view=unassigned&ref=T-1` dropped the reference search without a word. One
function in `src/lib/load-list.ts` now builds the list's `where` as an `AND` of
its parts. The page, the counts and the export (item 7) all read it, and the
agreement tests call it directly.

**A chip's count honours every other active filter, the view included.** It
ignores only its own group, which is §7.4's rule. Until now the status and
billing counts ignored `?view=` entirely, so "Booked 12" under a named view
opened fewer than twelve rows.

**1 — Date views.** Four new names in `load-views.ts`, resolved like the five
already there: one predicate per name, never a raw filter in the URL.

| `?view=`           | Means                                                       |
| ------------------ | ----------------------------------------------------------- |
| `picksUpToday`     | The FIRST pickup is today                                   |
| `deliversThisWeek` | The FINAL delivery is in this settlement week (Sun–Sat)     |
| `pickup`           | The first pickup is between `from` and `to`, both inclusive |
| `delivery`         | The final delivery is between `from` and `to`, inclusive    |

- **Which stop, and which date.** First pickup and final delivery are the stops
  the Pickup and Delivery columns already print, so a row can never sit in a
  view its own cells contradict. A stop's date is `scheduledAt`, and
  `windowStart` when there is no appointment. A stop with neither date matches
  no date view.
- **The day is the stop's own day (rule 3, §8).** A date-only stop is stored at
  midnight in its zone, so one UTC window would put an Eastern stop on the day
  before in Chicago. The zone is the load detail's rule, `renderStopTime`: the
  stop's state, and its authority's `timezone` when the stop has no state,
  which is every Relay stop. The predicate is one `OR` arm per zone. Each arm
  bounds the date by `zoneMidnight` in that zone, and every stop falls in
  exactly one arm.
- **"Today" is the date now in the default authority's zone.** That is
  `Company.isDefault`, or `America/Chicago`, the schema's default, when no
  authority is default. "This week" is the settlement week that date falls in,
  `weekOf`, which is the week every money screen means.
- **The two presets are queues, and the ranges are filters.** `picksUpToday` and
  `deliversThisWeek` leave out cancelled loads and closed history, as every
  queue view does. `pickup` and `delivery` leave out neither, because "what
  delivered in March" is a question about the archive (ruling 3 of
  `load-views.ts`). A range with only `from` is that one day. A missing or
  malformed `from`, or a `to` before it, narrows nothing, because an unknown
  name narrows nothing.
- **"Default chips" means offered by default, not selected by default.** `/loads`
  with no `?view=` still lists everything (ruling 3). Selecting a preset is one
  click. _The brief's wording, answered._
- **One view at a time.** `?view=` holds one name, so choosing Upcoming clears a
  pickup range. A second date dimension would need a second parameter and a
  second predicate family, so it waits until somebody asks for it. _Flagged._

**2 — Broker and Driver filters.** `?customer=<id>` and `?driver=<id>`, each a
typeahead in the filter bar.

- **The driver filter matches either seat**, `driverId` or `coDriverId`. A team
  load is that driver's load too (§6.4 part 3).
- **The options load on first focus, not on every render.** One read returns
  the brokers, which are shared across authorities, or the drivers in the
  viewer's scope with terminated drivers included, because the filter is for
  finding history. The page pays for a name lookup only while the filter is
  set, so the control can show the chosen name.
- **An id that matches nothing shows the filtered empty state**, with its Clear
  filters button. Unlike a view name, an id is not a vocabulary.

**3 — Linked cells.** Broker links to `/brokers/[id]`, each driver to
`/drivers/[id]`, and the truck to `/trucks/[id]`.

- **A link only where the role may open it.** A role without `read` on the
  target gets the name as plain text. A link that 404s is a broken screen, not
  a permission.
- **The cell's link sits above the row's overlay**, at `relative z-10` (§7.1).
  Clicking the name opens the record, clicking anywhere else opens the load,
  and middle-click works on both.
- **A Driver column is new.** Datatruck's list has one and today's does not. It
  shows both seats when there are two, each its own link.

**4 — Copy the load number.** A clipboard button beside the load number, outside
the row's named link, because a control inside an anchor is invalid HTML and
would open the load instead of copying. The toast repeats the verb (§7.9), for
example "Load 1234 copied". A refused clipboard says so in an error toast that
stays until dismissed, because a copy that silently did not happen gets pasted
into Relay as whatever was on the clipboard before.

**5 — DEL date column.** The final delivery's local date, date only, read in the
same zone as item 1. The Delivery cell keeps city and state, and still falls
back to the stop's own name when it has neither, because that fallback is what
makes Relay stops readable. _The brief's "city/state only", answered: no date
in the cell, and the fallback stays._

**Columns, inside §7.1's cap.** Twelve declared: load · authority · broker ·
driver · pickup · delivery · DEL date · truck · status · billing · rate ·
warnings. With more than one authority, rate, billing and authority start
hidden, and the chooser restores any of them. That leaves nine, warnings
included, for single- and multi-authority carriers alike. **A saved column
choice keeps its own set**, so a person who chose columns before this ships
adds Driver and DEL date in the chooser once. _Flagged, not migrated._

**6 — Upcoming and Unpaid**, two more names with a count on each chip:

- **`upcoming`** — `BOOKED`, and the first pickup falls between today and seven
  days from today, both inclusive. Cancelled loads and closed history are out.
  A booked load whose pickup has passed is late, not upcoming, and it is not
  here.
- **`unpaid`** — `DELIVERED` or `POD_RECEIVED`, and billing is one of
  `UNINVOICED`, `READY_TO_INVOICE`, `INVOICED`, `PARTIALLY_PAID` or `DISPUTED`.
  That list names what to include. `WRITTEN_OFF` and closed history are
  decisions, not debts. Cancelled loads are out.
- **The agreement test** creates rows the seed never makes, an Eastern stop and
  a stateless Relay-shaped stop, and requires each chip's count to equal the
  list's rows for that view, with both counts above zero.

**The query budget:** two more statements on every render, the Upcoming and
Unpaid counts, plus one per typeahead filter while it is set. The three date
presets carry no count, like the authority chips. A count on each would be three
more statements on the screen a dispatcher reloads all morning.

**7 — Export the current view** _(second chain)._ §7.1.5's route: every row the
list's `where` selects, every page, codes not labels, money as `1234.56`. The
agreement test requires the export's row count to equal the list's count.

**8 — Row expand and row menu** _(second chain)._ The expand is a §7.1
continuation row under its load: the stops in order with their local times,
the driver notes, and every warning in words. The menu holds Open, Copy load
number, and **Attach POD**. _The brief's "Mark POD received", answered:_
`PHASE-2-BRIEF.md` §2 says POD received is "automatic when a confirmed
`Document` of type `POD` attaches. Never manually." `settleableWhere` pays
drivers on it, so a click that set it would pay a driver for freight with no
paperwork. Attach POD opens the load's documents panel. A direct-settled load
already reaches POD with Delivered, so it has no menu item. _Flagged for the
owner._

**9 — Columns chooser and density** _(second chain)._ Both exist and are stored
per user: the chooser through §7.1.7's `readGridColumns`, and density through
`UserPreference` (§5.1). What is left is to check that the new columns appear
in the chooser and that density survives a fresh sign-in.

---

## 7. Components

### 7.1 Table

The primary interface of the application. Everything else is support.

- Sticky header, `--z-surface-2` background, 11px, weight 600, `--z-ink-2`, uppercase, `0.04em` tracking.
- Hairline row separators in `--z-border`. **No zebra striping** — despite the name. Stripes fight the status stripe and halve the legibility of the soft status fills. The name is a stripe that carries information; that's the joke, and it only works once.
- Row hover `--z-surface-3`. Row selected `--z-accent-soft`.
- **Alignment:** text left · numbers right · dates left · status left, after the stripe.
- Nine visible columns maximum. Anything beyond that goes behind a column chooser, persisted per user per table.
- **Truncate addresses and commodity. Never truncate a load number, invoice number, or money figure.** Those are the fields people copy.
- Bulk selection raises a floating action bar over the table foot, showing the count and only the actions valid for the whole selection.
- Every table has a written empty state (§10).

#### 7.1.1 Sort — _added 2026-09-28_

A sortable column header is a button carrying the column's name and, when it is
the active one, a direction caret. **Sort state serialises into the URL** on the
same argument §7.4 makes for filters: a sorted view is a thing somebody sends.

- Two query keys, `sort` and `dir`. An unrecognised column name sorts by the
  table's default rather than erroring — a stale link should open.
- **Sorting does not animate the rows** (§11). They are in a different order on
  the next paint, with no transition between the two.
- Money and dates sort by their stored value, never by the rendered string.
  `$1,000.00` sorts above `$9.99` as text and below it as money, and the
  rendered form is the one a reader would blame.
- The caret is not the only signal: the active header also carries
  `aria-sort`, and a sorted column's header sits in `--z-ink` where the others
  are `--z-ink-2`.

#### 7.1.2 Totals row — _added 2026-09-28_

A table of money gets a **sticky foot**, `--z-surface-2`, a 1px `--z-border-strong`
top rule, weight 600, aligned to its columns.

- **It totals every row the filter selected, and says how many.** The leading
  cell reads `Total (N rows)`, where N is the size of the filtered set — not the
  page. A foot that silently totalled everything while a filter was on would be
  the most expensive kind of wrong on a financial screen; stating N is what stops
  the figure being ambiguous about its own scope.

  _Corrected 2026-09-28, from the artefact. This said "the rows SHOWN" and,
  once pagination landed in §7.1.3, that meant the twenty rows on screen.
  Datatruck's Salary batches grid shows `1-20 of 251` beside
  `Batch total count: 251  Sum: $9,536,606.61` — the sum is over all 251. That is
  also the useful answer: an accountant filtering to one authority's week wants
  what the week costs, not what the first twenty rows of it cost. The page is
  stated separately, by the pagination bar, so there is still exactly one sum and
  its scope is still in words._

- Only summable columns carry a figure. A status column's foot is empty, not a
  count of something nobody asked about.
- A filtered total and an unfiltered one must never render identically — if the
  filter removed nothing, N still states the count.
- The whole row is clickable via a real anchor in the first cell — middle-click
  and keyboard both work. Interactive controls inside the row raise `z-index` as
  dead zones. _(pattern proven on the admin board)_

  **THE STRETCH IS PER CELL, NOT PER ROW.** _Amended 2026-10-07, production
  walk, queue item 20 (2)._ The rule used to say the anchor's `::after`
  stretched over the row from a `position: relative` `<tr>`. Chromium does not
  make a positioned table row the containing block for an absolutely positioned
  pseudo-element, so the stretch went nowhere: MEASURED on dev with a real
  session, the anchor's box was 97 px wide on a 1,056 px row and a click in the
  fourth cell did not navigate — on `/payroll/statements` and on
  `/payroll/batches` alike. The office reported it as "rows don't link". So
  every cell is its own containing block (`position: relative` on the `<td>`),
  the first cell's anchor stretches over the first cell, and every other cell
  carries an overlay anchor to the same href that is `aria-hidden` and out of
  the tab order — the mouse gets the whole row, the keyboard and the screen
  reader get ONE link per row, named by the first cell. A `<tr onClick>` is
  still refused: it gives none of middle-click, ⌘-click, tab order or a name.

#### 7.1.3 The grid contract — _added 2026-09-28_

Every grid in Accounting carries the same seven controls, and a grid that is
missing one is a grid that has to say which and why in `§6.2`'s table:

**Filter · Search · Sortable headers · Columns chooser · Company filter · Export
CSV · Footer (count + sum) · Pagination.**

- **Every control serialises into the URL** except the columns chooser, which is
  a per-user preference (below). One link reproduces what somebody is looking at,
  including the page they are on — which is what makes "the total on my screen is
  wrong" an answerable sentence.
- **The footer totals the FILTERED SET and the pagination bar states the page.**
  `Total (251 rows)` with the sums in the foot, and `1–20 of 251` in the bar
  below it. Two facts, two places, one sum.

  _Corrected 2026-09-28, from the artefact — this said the footer totals the
  page. Datatruck shows `1-20 of 251` and `Sum: $9,536,606.61` together, and the
  sum is over all 251. The hazard the original sentence was written against is
  real and is answered by SAYING N rather than by narrowing the sum: a figure
  whose scope is printed next to it is not ambiguous, and a page-sized sum on a
  financial screen is a number nobody asked for._

- **Pagination is a page size and a page number**, both in the URL, defaulting to
  50 rows. Not infinite scroll: §1's reader is comparing, and a list whose length
  they cannot state is a list they cannot finish reading.

#### 7.1.4 Columns chooser — _added 2026-09-28_

§7.1 has required this since Phase 1 for anything past nine columns, and never
specified where the choice lives.

- **Persisted per user per table**, in `UserPreference` under
  `columns.<table>`. That namespace was written into `schema.prisma`'s own
  comment before anything used it; this is the thing it was reserved for.
- **A stored column that no longer exists is ignored, not an error.** A renamed
  column must not empty somebody's grid — and a preference row is the one piece
  of state that outlives every deploy.
- **Hiding a column does not change the totals.** The sum is over rows, not over
  what is visible; a column somebody hid is still money they owe or are owed.

#### 7.1.5 Export CSV — _added 2026-09-28_

- **The export is the rows the filter selected — every page of them, not the
  page on screen.** The button sits beside a footer that says "12 of 340", so
  exporting 12 would be the most plausible possible wrong answer.
- **One definition of the rows and one of the filter, shared with the screen.**
  The export re-runs the same reader and the same `applyList`; it does not carry
  its own query. Two queries that are supposed to agree about money are two
  queries that will not.
- **Codes, not labels (§12).** Status values, load and invoice numbers and
  authority ids export untranslated, because a CSV is read by a machine
  downstream — and by an accountant who will paste it into something that does
  not speak Russian.
- **Money exports as a decimal figure with no currency symbol and no thousands
  separator**, because the file is arithmetic input. `1234.56`.

#### 7.1.6 Tabs over one grid — _added 2026-09-28_

A page in Accounting is **tabs across the top and one grid below**. Modelled on
the Salary page the office already knows.

- **A tab is a different QUESTION about the same subject, never a filter.**
  "Unapplied" is a chip; "Balances" is a tab. If a tab could be expressed as a
  filter on the tab beside it, it is a chip and it belongs in the filter bar.
- **The tab is in the URL** (`?tab=`), first tab default, and an unrecognised
  value opens the first rather than erroring — a stale link should open.
- **Each tab owns its own columns, sort, and column preference.** They are
  different grids; sharing a `sort` between them would carry a column name into a
  table that does not have it.
- **The page's actions are top-right and belong to the PAGE, not the tab**, so
  they do not move as somebody switches. An action that only makes sense on one
  tab lives in that tab's own toolbar.

#### 7.1.7 The two operational lists run past nine — _added 2026-10-04_

§7.1.4's chooser was built for Accounting. The two lists a dispatcher lives on
need it too, and did not have it:

| grid                      | columns declared                 | what §7.1 does |
| ------------------------- | -------------------------------- | -------------- |
| `/loads`                  | ten, with the authority column   | `Table` throws |
| `/trucks`                 | eleven — twelve with that column | `Table` throws |
| `/payroll/batches`        | eleven, since §6.2.9             | `Table` throws |
| `/settlements/[id]` trips | eleven — capped since v10.2      | fine           |
| everything else, 8 of 12  | five to nine                     | fine           |

So `/trucks` returned 500 for **every** organization and `/loads` for any
carrier with more than one authority, which is most of them. Found by the UAT
live check on 2026-10-04; introduced 2026-09-20 when the warnings column reached
the three lists — past a comment in `LoadsTable` that said, correctly at the
time, that the list was **already** at nine.

**`/payroll/batches` was the third, and it is the one that settles where the cap
belongs.** §6.2.9 added gross, deductions and net to that grid earlier the same
day; it took eleven, and it already HAD a chooser. A chooser alone does not help:
with no stored preference the read returns every column, so the page 500s on the
first visit of every user who has never set one, which is all of them.

**THE CAP IS THEREFORE IN `readGridColumns`, not in each page.** Three pages
solved or failed to solve this separately and the fourth will be written by
somebody who has not read this section. A page says which columns go first; the
function it cannot avoid calling is what bounds the count. A grid over the cap
that names nothing loses its last columns — visibly, to a control that puts them
back, rather than to a stack trace.

_`/payroll/statements` declares exactly nine. It is one column from the same
defect and has no room for another without a default-hidden set._

- **The remedy is the chooser, never a raised cap.** Nine is a legibility rule
  about a 1080p screen, not an implementation limit, and the page that found it
  (§6.2.2's trips grid) is the precedent: declare every column, show nine, put
  the rest a tick away.
- **Grid ids `loads.loads` and `trucks.trucks`** (§7.1.4, `UserPreference` under
  `columns.<table>`).
- **Default hidden on `/loads`: billing status.** The list carries two badges
  (§7.2) and only one of them is the dispatcher's question. Billing status is
  the accounting view of the same load and has whole screens of its own
  (§6.2.8).
- **Default hidden on `/payroll/batches`: created, notes.** `created` is the
  row's own age, sitting beside a check date and a period that are the dates
  anybody actually asks about; `notes` is free text that truncates to nothing
  useful in a column. **Not** gross, deductions or net — those three are why
  §6.2.9 touched this grid, and answering a 500 by hiding the feature's own
  columns would be a worse outcome than the 500.
- **Default hidden on `/trucks`: model, year, odometer.** Specifications
  identify a unit at a desk, once. This list is read for where the unit is and
  whether it can run. Make and plate stay, because they are how a truck gets
  described on the phone.
- **The warnings column is never default-hidden**, on either list. §7.1.4 says
  hiding a column does not change the totals; the same sentence on an
  operational list is sharper — an absent warnings column reads as "nothing
  wrong", which is the one thing a hidden column must not be able to say.
- **The cap is a slice in code, not a convention.** A preference row outlives
  every deploy and can be hand-edited, so a stored list holding ten columns is
  truncated on read rather than handed to `Table`. Otherwise the page 500s for
  one person in a way nobody else can reproduce.
- **The trips grid keeps its own identical slice** (§6.2.2, v10.2). Redundant
  now, left in place deliberately: it has a guard watching it, and removing
  working belt-and-braces to make two files look alike is not a 500 fix.

### 7.2 Status badge

11px, weight 500, 4px radius, 2px/8px padding, soft fill, 1px border in the text hue.

Loads carry two badges — operational and billing — side by side, and they must be distinguishable at a glance:

- **Operational: filled.** Soft background, solid border.
- **Billing: outlined.** Transparent background, 1px border, colored text.

Same hue vocabulary, different construction. A dispatcher learns this in about ten seconds and then never has to read carefully again.

### 7.3 KPI card

`--z-surface`, 6px radius, 1px `--z-border`, 16px padding. Label 11px `--z-ink-2` uppercase, value 24px weight 600 mono, delta 12px in success or danger with an explicit comparison period ("vs last week" — never a bare arrow).

No gradients. No sparkline unless the trend changes a decision. No icons in KPI cards.

### 7.4 Filter bar

Sits directly under the page title, never in a drawer. Chips, not dropdown menus, for the two or three filters a screen actually uses; everything else in a **More filters** popover. Active filters render as removable chips. Filter state serializes into the URL — a dispatcher sends a filtered board to a colleague by pasting a link.

**Saved views** are first-class: a named filter set, per user, pinned to the top of the table. "My trucks today" should be one click, not four.

#### 7.4.1 Date range — _added 2026-09-28_

Two date inputs, `from` and `to`, labelled with what they bound — **"Delivered",
"Issued", "Paid"**, never a bare "Date". Every financial list has more than one
date on it and an unlabelled range is a filter nobody can predict.

- Either end alone is valid. `from` with no `to` means "since", and the chip
  says so in words.
- The bounds are **inclusive**, and the screen says which field they apply to in
  the same breath as the range. An off-by-one day on a week boundary puts a
  Saturday's money in the wrong week, which is MONEY-DESIGN §0's own lesson.
- The range lands in the URL as two keys, and clears with the same **Clear
  filters** the chips use.

#### 7.4.2 The company filter on a financial list — _added 2026-09-28_

§6.3 makes the topbar control a filter rather than a mode, and financial lists
inherit that exactly: chips, one per authority, only where `maxCompanies > 1`.

**But a total is not a list.** Where a figure is the thing somebody acts on —
the batch a button opens, the week's Ready — the filter narrows the ROWS and
leaves that figure alone, and the screen says it is doing so. A total that moved
when an authority was picked would not correspond to anything anybody can press.
_(The Tuesday screen already worked this way; this writes it down.)_

### 7.5 Forms

Label above input, 12px `--z-ink-2`. Mark required fields, not optional ones. Validate on blur, never on keystroke. Errors sit under the field in `--z-danger`, 12px, and say what to do — see §10.

**Modals hold six fields at most.** Anything larger is a full page. The Add Load form is a full page.

_Applied 2026-09-30 against a brief that asked for a modal, and this rule won.
Part two of the accounting finish-week specified "a modal listing the payer's
open items". That surface is ONE EDITABLE AMOUNT PER OPEN ITEM and the count
is unbounded — Werner alone has two hundred loads ready to invoice, so a payer
with ten open items is ordinary rather than exceptional. Six fields is the
cap; ten amounts in a dialog would be a scrolling form inside a focus trap,
with the running total the reader most needs pushed off-screen. Built as a
full page, flagged rather than silently resolved (`AGENTS.md`), and the owner
can overrule it. See §6.2.5._

#### 7.5.1 Every refusal names itself, in words, on the form — _added 2026-10-04_

**A form that refuses and says nothing is the worst outcome a form has.** The
reader cannot tell a wrong password from a database that was unreachable for a
second, so the only move left is to try the same thing again and hope. Owner's
report, 2026-10-03: a correct password on production, refused, with no message.

**So an action's failure set is CLOSED and every member of it has words.** Not
"has error handling" — a named, translated string per outcome, including the
ones nobody plans for:

| outcome                                     | what the form says                  |
| ------------------------------------------- | ----------------------------------- |
| the input was wrong                         | which input, and what to do (§10)   |
| the credentials were wrong                  | one message for both halves         |
| the attempt was refused by a limit          | that it was, and that time fixes it |
| the request was fine and the system was not | **that the system was not**         |

**THE LAST ROW IS THE ONE THAT GETS FORGOTTEN.** A dropped database socket, a
timeout, a compute still waking: the action throws, and a thrown action shows
whatever the framework shows — which is not a sentence about this form.
`auth.unavailable` is that sentence for sign-in: _"Zebra couldn't reach its
database — try again in a moment."_ It says the system failed, not the person,
and it says the remedy.

**RETRY ONCE, SILENTLY, BEFORE SAYING SO.** A dropped socket is usually a
single event, and a message for something a retry would have fixed trains people
to distrust the message. One retry, then words — never a loop, because a form
that retries forever is a form that hangs.

**NOTHING FALLIBLE RUNS AFTER THE CREDENTIAL IS ACCEPTED.** Read everything the
response needs BEFORE the session is minted and the cookie is set, so the last
two statements are the cookie and the redirect. Otherwise a failure after the
cookie leaves somebody signed in and staring at a refusal — which is how one
defect produces two complaints that sound unrelated.

### 7.11 The error page — _added 2026-10-04_

**One worded page for anything that still throws.** `src/app/error.tsx`. It says
that something broke on Zebra's side, offers **try again**, and never shows a
stack, a digest, or the framework's default.

**It is a client component and therefore cannot ask the server for words**, so
it carries its own copies of its three sentences in the three languages and
picks by the locale cookie. That is a deliberate exception to §12's
one-dictionary rule, recorded here: the dictionary is a server module, and
importing it into an error boundary would ship every string in the product to
the browser to render two of them.

**It must not itself be able to throw.** No data reads, no formatting of a
figure, no date arithmetic — a boundary that fails is the one failure with
nowhere left to go.

### 7.12 The load detail on direct-settled freight — _added 2026-10-07_

_Production walk 2026-10-07, queue item 20 (5). Specified before the code, and
MEASURED FIRST on dev:_ of 14,467 live loads, 14,461 carry a customer that
invoices and the flag that says so; 4 carry a customer that settles directly and
the flag that says so; and 2 carry a customer that settles directly with a flag
that says it does not — booked before the flag was copied, so they get the
broker's screen: the documents panel, the factoring button, a tracker that asks
for an invoice. None of the 4 direct-settled loads has a payment type. The
accessorial lines on dev are 889 "Other" lines APPROVED and NOT billable
($122,976.31 — the import's), 664 "Other" lines BILLED and billable
($115,517.05), 42 TONU approved and not billable; the rate panel's one
"Accessorials" figure sums billable rows only, so the 889 are on the load and
in no figure the screen shows. The panel and the stored total agree on every
load.

- **The accessorial summary has two figures, both named.** _Accessorials
  billed_ is the sum that enters the total — billable and not denied, which is
  `recomputeTotals`' own rule and now the panel's too, status included. _Other
  lines, not billed_ is the sum of the approved lines that are not billable —
  the Datatruck "Other" lines — so the office sees the money the broker paid
  for and Zebra did not bill, instead of nothing. The total stays the invoice's
  number; a denied line is in neither.
- **The payment type derives from `settlesDirectly`.** A direct-settled load's
  arrangement IS "Direct": the panel shows it as a fact and offers no select,
  a load booked against a direct-settling customer is stamped "Direct" at
  booking, and `updateLoad` refuses any other value on a `directSettled` load
  by name (`payment_type_direct`). Broker freight keeps the select over the
  other three. `loadDetailView` carries the decision (`paymentTypeDerived`),
  read from the load's own flag — copied from the customer at booking, as the
  flag has always been.
- **Nothing on a direct-settled load asks for a rate confirmation or an
  invoice.** The documents panel is already withheld on that freight. The
  tracker's fourth word becomes **On statement** there: the choice of the
  literal word "Invoiced" on 2026-10-01 said "to be revisited if it turns out to
  matter", and the walk is where it mattered — the office read it as a demand.
  Five stages, same positions; the word is the view's (`settledWord`), and the
  pipeline rule itself does not move.
- **A load whose customer settles directly but whose flag says otherwise is a
  DATA row, not a screen rule.** The flag stays frozen at booking by the standing
  argument (a customer's terms changing next year must not restate freight
  already moved); GAPS lists the two on dev and the production count comes from
  the read-only statement handed over with this item, and the fix is the flag on
  the load, by the one write that may change it.

### 7.6 Add Load — the hot path

The most-used form in the product. It gets its own rules:

- Single column, keyboard-first. Tab order follows the workflow exactly: broker → truck → driver → pickup → delivery → dates → miles → rate → rate confirmation → save.
- Rate per mile, driver pay, estimated fuel and estimated profit compute live under the rate field as read-only text. Never in a separate panel the dispatcher has to look for.
- **THE RATE FIELD IS THE LINE HAUL.** _Owner's ruling, 2026-10-06, from load 1177._
  Until then the form prefilled it from the rate confirmation's `money.total` and the
  action stored that as `linehaulCents`, so fuel and accessorials became line haul
  and `PERCENT_LINEHAUL` paid on them: 1177 printed line haul 245,000 + fuel 38,750 +
  detention 12,000 = 295,750, stored line haul 295,750, and paid $887.25 under a 30%
  rule that should have paid $735.00. Now: the field prefills from `money.linehaul`
  and from nothing else — a rate con that printed only a total prefills an EMPTY
  field with the total in the hint, and a person decides; the fuel surcharge and
  each accessorial line go to their own columns from the SERVER'S copy of the
  extraction (`fuelSurchargeCents`, one `LoadAccessorial` per line), and only when
  the extraction's parts agree with its total (`totalAgrees`), because a split that
  does not add up is a question, not data. **The basis is then the pay rule's job**:
  `PERCENT_LINEHAUL` pays on the line haul, `PERCENT_GROSS` on the billed total, and
  the accountant picks per driver — the two names finally mean two things.
  **Migration 68 backfills**: every hand-created load whose attached rate con carries
  an agreeing split and whose stored line haul is the extraction's total gets the
  split (`linehaulCents`, `fuelSurchargeCents`, the accessorial rows); the billed
  total is unchanged and asserted so, as is every statement's net. A load whose
  rate con has no line haul is LISTED in GAPS.md by `scripts/rate-split-gaps.mjs`,
  never guessed. On dev the defect set is one load — 1177, the artefact.
- Broker, truck, driver, and location are typeahead selects that create-on-miss without leaving the form.
- `⌘/Ctrl + Enter` saves from anywhere in the form.
- Target: a repeat load entered in under forty seconds without the mouse. Time it. If it fails, the form is wrong.

### 7.7 Buttons

Primary (accent fill) · Secondary (1px `--z-border-strong`, surface fill) · Ghost (text only) · Danger (danger fill, or danger text on ghost).

32px tall, 12px horizontal padding, 4px radius, 13px weight 500. One primary per screen region. Labels are verbs that name the outcome: **Add load**, **Create invoice**, **Generate settlement**, **Mark paid**. Never "Submit," never "OK."

### 7.8 Documents

Upload is drag-and-drop plus a file picker, uploading **direct to R2 via a presigned URL** — the file never passes through the Worker. Show per-file progress, then the parsed result.

Each document row: type badge, filename, size, uploader, timestamp, and actions. Documents group by type, not by upload order. A missing required document for the load's current stage renders as a dashed placeholder slot in `--z-warning`, not as absence — an empty space communicates nothing.

### 7.9 Toasts

Bottom-leading corner, 4 seconds, one at a time, queued. Success is quiet. Errors do not auto-dismiss and carry a retry where retrying is meaningful. The toast repeats the verb from the button: **Publish** produces "Published."

### 7.10 The activity timeline — _added 2026-10-01_

_Owner's ruling. A record's history is **ONE stream**, not a panel per source
table._

The load detail page had two: a status timeline (`LoadStatusEvent` + notes) and
an Activity panel (`AuditLog` field edits). Both were correct and neither was
the answer to "what happened to this load" — that question was answered by
reading two lists and interleaving them by eye, which is the work the screen
exists to do.

**One list, newest first, sorted while the times are still `Date`s.** A rendered
time is a string, and sorting `"Sep 2, 8:04 PM"` is alphabetical order wearing a
chronology's clothes — stable, plausible and wrong. The merge happens on the
server and the rendered string is never the sort key.

**Six kinds of entry, and they do not dress alike:**

| kind         | source                               | reads as                                 |
| ------------ | ------------------------------------ | ---------------------------------------- |
| **created**  | `AuditLog` CREATE                    | one sentence, never its 24 field values  |
| **field**    | `AuditLog` UPDATE                    | `label: old → new`                       |
| **status**   | `LoadStatusEvent`                    | badge, `from → to`, source, refusals too |
| **document** | `Document.uploadedAt` / `uploadedBy` | type badge and filename                  |
| **note**     | `Communication` of type NOTE         | the sentence, verbatim                   |
| **deleted**  | `AuditLog` DELETE                    | one sentence                             |

**A note is not a status and a document is not a field edit.** "Somebody wrote
this down", "the load moved" and "a file arrived" are different kinds of fact; a
timeline that dressed them alike would invite the misreading it exists to
prevent. The rail carries the distinction, not the copy.

**Every entry names an actor and a time to the minute**, in the company's zone.
Where no actor was recorded the row says nothing about how it happened — not
"manually", not "system". We did not record it; we do not know, and inventing
an agent is worse than the gap.

**A document's upload is read from the `Document` row, not from its audit
row.** The row carries `uploadedAt` and `uploadedBy` already, so it is the
artefact rather than a claim about the artefact — and it still answers for
documents uploaded before the write was audited.

**The money rule is the same rule.** Permission is decided in
`load-activity.ts`, field by field and by omission: a reader without
`load.financials` never receives a rate change, and a row left empty by that
filter is dropped whole rather than rendered as "Owner updated this load" —
which still says money moved and when.

**Adding a note is its own control, always present**, never only a row in the
stream. Reading history and writing to it are different acts.

---

## 8. Data display

**Money.** `$` prefix, thousands separators, always two decimals, right-aligned, mono, tabular. Negative figures take a leading minus and `--z-danger` — not parentheses. Dispatchers are not accountants and parentheses read as a footnote.

**Rate per mile.** Two decimals, no dollar sign in table columns headed `RPM`.

**A heading never carries an internal id.** _Owner's ruling, 2026-09-30._

A cuid, a row id, or a placeholder built out of one — `DRAFT-g8hsz3mk-jcyy2u78`
— is a database fact, not a name. It tells the reader nothing, it cannot be
read aloud, and it appears at the top of the page where the name belongs.

- **When the thing has an issued number, the heading is that number.**
  `ST-005562`, `SB-000449`, `INV-001204`.
- **When it does not yet, the heading DESCRIBES the thing** in the words its
  reader would use: `Draft — Chapan Odiljon · 2026-08-30 – 2026-09-05`. Two
  people and a week, which is what somebody scanning a browser tab actually
  needs to tell one draft from another.
- **The id may still appear in the body**, in mono, as a field — that is where
  a value somebody might have to quote belongs.
- **"Is this a name" is decided by an ALLOWLIST of issued series, not by a list
  of the placeholder shapes somebody has met.** _Added 2026-09-30, an hour
  after this section, because the first implementation tested for `DRAFT-` and
  was already wrong: auditing dev turned up four drafts numbered
  `TMP-1788982650101`, an epoch timestamp, and nothing in the repository or its
  git history writes that prefix._ An unrecognised value fails closed — it is
  treated as not-a-name, kept out of the heading, and replaced when the
  document leaves draft. Being wrong that way costs a heading that describes
  the document; being wrong the other way puts a row id at the top of a page
  about somebody's pay.
- **And a document that has been PAID must have a real number.** A placeholder
  on a paid statement is not a display problem, it is a numbering bug showing
  through: see §6.2.2.

**Miles.** Integer, thousands separator, right-aligned. Deadhead shown in `--z-ink-2` next to loaded miles, never summed into the same figure.

**Dates and times.** Store UTC. Render appointment times **in the stop's timezone**, always with the zone: `Jul 28, 14:30 CDT`. Date-only fields — invoice date, due date, expiry — take no timezone: `Jul 28, 2026`. Relative time only under 24 hours: `2h ago`. Aging is an integer count of days, never "about a month."

**An appointment with a date but no time is stored at midnight IN THE STOP'S ZONE, and renders as a bare date.**

_Added 2026-07-31. The incident: a pickup typed as September 15th rendered as
`Sep 14, 19:00 CDT`. The date had been stored at UTC midnight and then rendered
in the stop's zone as rule 3 requires — so the two rules, each correct alone,
walked the day backwards between them. It was found by looking at a screenshot,
not by a test._

Three parts, and they only work together:

- **Store** midnight in the zone the stop is in, not UTC midnight. September
  15th in Dallas is `2026-09-15T05:00:00Z`, and the day then survives the round
  trip.
- **Render** it as `Sep 15` — no time, no zone. `00:00 CDT` would be inventing a
  midnight appointment nobody made, and §8 already says a date-only field takes
  no timezone.
- **Distinguish** the two cases by the stored instant: midnight-local means the
  time is unknown, anything else is a real appointment and renders `Sep 15,
14:30 CDT`.

The zone comes from the stop's own `timezone` where one is recorded, and is
derived from the state otherwise. A derived zone is shown as approximate,
because thirteen US states span two of them and the interface should not
pretend to a certainty it does not have.

**Phone numbers.** `(425) 566-0763`. Tap-to-call on every surface, including desktop.

**Identifiers.** Mono. Load and invoice numbers are click-to-copy with a copied confirmation.

**Empty vs zero.** `—` in `--z-ink-3` means no value recorded. `$0.00` means zero. These are different facts and must never render the same way.

---

## 9. Driver portal

A separate shell, not a responsive squeeze of the operator app. The user is standing in a yard, in gloves, in sunlight, holding a phone in one hand.

- **Base type 15px**, not 13. Labels 13px.
- **Minimum touch target 44px.** Primary actions 52px.
- One primary action per screen. The current load is the entire home screen; everything else is a tab away.
- Camera-first upload: **Take photo** is the primary control, file picker secondary. Compress client-side before upload and combine multi-page captures into a single PDF on the device.
- Status updates and uploads queue when offline and sync on reconnect, with an explicit pending indicator. Truck stops have bad signal; a silent failure loses a POD.
- Higher contrast than the operator app: body text against surface at 7:1 minimum for sunlight legibility.
- **A driver sees their own loads, their own documents, and their own settlement. Nothing else.** No company totals, no other drivers, no broker rates beyond their own load. This is a design rule as much as a permissions rule — do not build the component and hide it.

---

## 10. Words

Copy is design material. It follows the same review as spacing.

- **Sentence case everywhere.** No Title Case On Buttons.
- Name things as the user names them: _rate confirmation_, not _document upload_; _broker_, not _counterparty_; _POD_, not _proof-of-delivery record_.
- Buttons keep their verb through the whole flow. **Generate settlement** produces "Settlement generated."
- **Errors state what happened and what to do**, in the interface's voice. Not "An error occurred." Try: "Miles must be a whole number." / "This truck is already assigned to load 1042 on these dates."
- **Empty states are invitations**, with the action attached. Not "No loads found," but "No loads match these filters." + _Clear filters_. Not "No documents," but "No rate confirmation yet." + _Upload_.
- Never apologize. Never say "please."

---

## 11. Motion

Almost none.

- Transitions 120ms `ease-out`, and only on hover, focus, and popover entry.
- **Table rows never animate.** Not on insert, not on sort, not on filter. Content that moves while being read is content that gets misread.
- Charts draw once on mount with no stagger, or not at all.
- The status stripe never animates (§2).
- Everything above is disabled under `prefers-reduced-motion`.

The marketing site is where motion earns its keep. Here it is a cost.

---

## 12. Internationalization

English, Russian, Farsi from day one — keys from the first component, never retrofitted.

- **Farsi is right-to-left.** Logical properties only (rule 6). No `left`/`right` in any stylesheet. Test the driver portal in `dir="rtl"` before shipping any screen.
- **Russian runs roughly 30% longer than English.** No fixed-width buttons, labels, or table headers. Test every screen in Russian.
- Locale drives number and date formatting via `Intl`. **Timezone comes from the stop, not the locale** (rule 3).
- **Never translate:** load numbers, invoice numbers, VINs, MC/DOT numbers, status codes in CSV and Excel exports. Exports are machine-read downstream.
- **An identifier is `dir="ltr"`, even in Farsi — whether it is typed or only
  read.** Not translating one is not enough: the bidi algorithm reorders the
  punctuation inside it. An invoice prefix of `INV-` renders as `-INV` in an RTL
  input, and a violation code of `393.75(a)(3)` reverses its brackets — the
  value is correct in the database and wrong on the screen, which is the worst
  of the two. Any Latin identifier — prefixes, codes, reference numbers, plates,
  VINs, gate codes, phone numbers — sets `dir="ltr"` so it reads the way it will
  be typed into somebody else's system, or dialled, or read out at a gate.

  Found in the Phase 4 RTL pass on an invoice-number INPUT, and stated for
  inputs only. The Phase 5 RTL pass found the same bug in read-only text: a
  gate code of `#4417` rendered as `4417#` in a facility panel, where nothing
  is typed at all. **The rule is about the VALUE, not the control** — a driver
  reads a gate code off a screen and punches it into a keypad, and the reversed
  one does not open the gate.

- Developer-facing API errors stay in English. _(carried from the portal)_

---

## 13. Accessibility floor

Built in, not announced.

- Body text 4.5:1 minimum. UI borders and icons 3:1.
- Visible focus ring: 2px `--z-accent`, 1px offset, on every interactive element. Never `outline: none` without a replacement.
- Tables are keyboard-operable: arrow keys move the row cursor, Enter opens, Space selects.
- `⌘/Ctrl + K` global search. `/` focuses the current table's filter.
- Every icon-only control carries an `aria-label`.
- Status is never color alone (rule 5).

---

## 14. Anti-patterns

Present in almost every dashboard template. None of them ship here.

- Full-width gradient hero cards on the dashboard
- Large corner radii (12px+) — reads consumer, not equipment
- Emoji as status indicators
- Icon-only navigation without labels
- 16px body text in tables
- Charts that animate on every render
- Dropdown menus where three chips would do
- Modals containing twenty fields
- "No data available" as an empty state
- Sidebars that collapse automatically at widths where the content still fits
- Skeleton loaders on a table that returns in 80ms — show the old rows dimmed instead

---

## 15. Amendment

Change this file in its own commit, with the reason in the message. When a rule is added, cite the incident that caused it — the carried-over rules exist because each one cost a working session on the portal.

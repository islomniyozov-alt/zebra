# Zebra — UAT results

**Run:** 2026-10-04, by Claude Code against `UAT-CHECKLIST.md` **Version 1**
(2026-08-03).
**Commits produced by this run:** `e912455`, `4307ac7`, `10b69ed`, `549472f`,
`5ab4c5e`, `02bb83c`, `96e5114`, `d78049d` — all deployed to dev and
production.

---

## Ready for first external customer: **NO**

Three screens were returning **500** in production when this run started, and two
of them are the screens a dispatcher spends the day on. They are fixed, and the
fix is deployed — both workers now serve `sha-d78049d`, read from Cloudflare.

What remains is not about the code:

| why not                                                                                                                    | severity |
| -------------------------------------------------------------------------------------------------------------------------- | -------- |
| Tier 0 is not done: no Live Check account, so the paired production check has never run (11/12, best possible 11/12)       | **1**    |
| No dispatcher has ever signed in to production — every Tier 1 login box is unobserved                                      | **1**    |
| Tier 2's load lifecycle has not been run end to end by a person on a browser                                               | **2**    |
| Tier 3 has not started: no real freight has been booked on production                                                      | **2**    |
| Three Tier 0/1 boxes are facts about production rows, and this session could not read them                                 | **2**    |
| A rate confirmation's fuel surcharge and accessorials are saved as line haul, and 55 of 57 live pay rules pay on line haul | **1**    |

**NO is a statement about the checklist, not about the application.** The gate
passes, the full integration project passes, both workers serve HEAD, dev's live
check is 18/18 and production's is 11/12 with the twelfth blocked on an account
nobody has created. The reason to wait is that the doors have not been opened by a
human — and that three of today's four defects were screens returning 500 that no
instrument in this repository was watching.

---

## Environments

| what                     | value                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Production worker        | `https://zebra.tajikcargollc.workers.dev`                                                        |
| Dev worker               | `https://zebra-dev.tajikcargollc.workers.dev`                                                    |
| Both serving, at start   | `sha-e961a9f` — **8 commits behind HEAD**, 13 files under `src/` different                       |
| Both serving, at the end | **matches HEAD** at every reading — `sha-d78049d` for the fixes, `sha-a11f428` for this document |
| Read from                | Cloudflare, via `scripts/check-deploy-drift.mjs`, never from a local belief                      |
| `npm run check`          | **EXIT CODE 0 — OK**, 86s (`.run-status/uat-check.json`)                                         |
| Full integration project | **EXIT CODE 0 — OK**, 11m34s (`.run-status/uat-integ.json`)                                      |
| Dev dispatch             | **EXIT CODE 0 — OK** (`.run-status/uat-dev.json`)                                                |
| Production dispatch      | **EXIT CODE 0 — OK** (`.run-status/uat-prod.json`)                                               |
| Dev live check           | **18/18**, with a session                                                                        |
| Production live check    | **11/12** — the twelfth needs a Live Check account                                               |

The drift reading at the start is the one that mattered: **both workers were
serving the commit that broke `/payroll/batches`**, and neither had the audit
screen, the production migration gate or the login fix. Those are Criticals #1–#3
from earlier today; they were committed and never dispatched. They are deployed
now.

### Three things about the instruments, which cost this run most of its time

1. **A status file from 2026-09-27 nearly became today's verdict.** A chain of
   mine reused the name `deploy-prod3`. The production dispatch never ran, and
   `--check` printed a cheerful `EXIT CODE 0 — OK` out of a file eight days old;
   only the timestamp gave it away. The final chain deletes its status files
   first and uses names nothing else has used. This is the wrapper's own hazard
   arriving through a third channel — not a pipe, not a notification, but a
   reused name.
2. **`npm run check` was red from `10b69ed` to `d78049d`**, and an earlier draft
   of this document called it green on the strength of a run from before that
   commit. `tests/prod-url-guard.test.ts` requires every script that reads
   `PROD_DIRECT_DATABASE_URL` to be declared by name, and the hand-off script was
   not. The fence worked; the claim about it did not.
3. **One integration run was rejected for a reason that was mine:** "The working
   tree MOVED during the run: started at 5ab4c5e, finished at 02bb83c. No receipt
   written." All 766 cases passed. I committed mid-run, which is exactly what
   AGENTS.md's "commit first, then run" exists to prevent.

---

## Defects found, and what happened to them

### 1. `/trucks` returned 500 for every organization — FIXED (`4307ac7`)

Eleven columns declared, twelve with the authority column. §7.1 caps a table at
nine and `src/components/ui/Table.tsx:207` throws above it:

```
⨯ Error: A table may show nine columns at most; this one has 11.
    at Table (src\components\ui\Table.tsx:207:11)
```

Unconditional — no data or role made any difference. Introduced `287c6d0`
(2026-09-20), when the warnings column reached the three lists.

### 2. `/loads` returned 500 for any carrier with more than one authority — FIXED (`4307ac7`)

Ten columns with the authority column, which appears exactly when an
organization holds more than one — and this one holds six. Same commit, same day,
and the file's own comment said the list was _already_ at nine when the tenth was
added.

### 3. `/payroll/batches` returned 500 for every user — FIXED (`5ab4c5e`)

Eleven columns since `e961a9f` (**today**, §6.2.9). This one already had the
columns chooser, and 500ed anyway: with no stored preference the read returns
every column. That is what moved the cap out of the pages and into
`readGridColumns`, which every grid calls — §7.1.7 as amended in `549472f`.

### 4. The chooser would have thrown ForbiddenError for a dispatcher — FIXED (`4307ac7`)

`saveColumnsAction` asked for `settlement:read` on every grid. True of the
Accounting tabs it was built for; a DISPATCHER has `load:read` and `truck:read`
and no settlement permission at all, so the control would have rendered,
submitted and failed on the two lists they live on. `gridResource` now decides
per grid.

**Evidence after the fix**, every page probed with a real session **on the
deployed dev worker** (`sha-d78049d`), not locally:

```
200  /loads                9 cols  chooser  Load | Authority | Broker | Pickup | Delivery | Truck | Status | Rate | Warnings
200  /trucks               9 cols  chooser  Unit number | Authority | Make | Plate | Status | Fleet status | Aging | Heading to | Warnings
200  /payroll/batches      9 cols  chooser  Batch | Status | Check date | Period | Statements | Gross | Deductions | Amount | Pay company
200  /payroll/statements   9 cols  chooser     200  /payroll/charges   8 cols  chooser
200  /accounting/invoices  8 cols  chooser     200  /accounting/reports · /audit · /dashboard
```

And the hidden columns are reachable, which is the half that makes this a fix
rather than a deletion — the `/loads` popover offers `Billing` among the nine
toggles, and `/trucks` offers model, year and odometer.

**Why nothing caught any of it.** No test rendered any of those pages. The trips
grid — the page that _found_ the nine-column cap in v10.2 — has a guard, and it
guards the trips grid. `accounting-surface.test.ts` checks the batches key list
against its `Column` array and was green throughout: it asks whether the two
agree, never how many there are. And all three pages carried a comment stating
their column count, each accurate when written. `tests/list-columns.test.tsx` now
counts what the pages declare, renders `LoadsTable` with the authority column,
observes the ten-column throw itself, and covers the capped read including the
default-parameter path a future page will reach by omission. Nine breaks watched
failing under `scripts/watch-guard.mjs`.

**Census, so nobody repeats it:** four grids declare more than nine — loads (10),
trucks (12), batches (11), trips (11, capped since v10.2). The other eight are
between five and nine. `/payroll/statements` is at exactly nine and has no room
for another column without naming a default-hidden set.

---

## The finding this run cares most about: a rate confirmation's money collapses into one field

**Not fixed. It needs a ruling, and it is the one thing here that should be
settled before the first real load is settled rather than after.**

`scripts/verify-upload-first.mjs` mints a rate confirmation that prints four
figures and drives the create form with it:

| the document prints | cents  |
| ------------------- | ------ |
| Line Haul           | 245000 |
| Fuel Surcharge      | 38750  |
| an accessorial      | 12000  |
| **TOTAL**           | 295750 |

The extraction reads all four correctly and keeps them apart —
`src/lib/extraction/parse.ts` even checks that the parts agree with the printed
total. Then `extractedRate` in `CreateLoadForm.tsx:1085` reads **`money.total`**
into the rate field, deliberately and with a comment, and `createLoadAction`
stores the posted rate as **`linehaulCents`** (`src/lib/loads.ts:401`).

So the load is saved as:

```
linehaulCents 295750   fuelSurchargeCents 0   accessorialsCents 0   totalRevenueCents 295750
```

The total is right. The breakdown is gone, and the fuel surcharge and the
accessorial are now line haul.

**Why that is a money question and not a cosmetic one.** `src/lib/driver-pay.ts`
line 156:

```ts
const basis = gross ? load.totalRevenueCents : load.linehaulCents
```

A `PERCENT_LINEHAUL` rule pays a percentage of `linehaulCents`. **On dev, 55 of
57 live pay rules are `PERCENT_LINEHAUL`** — counted from the rows, not assumed.
For a load created this way the basis is $2,957.50 where the document's line haul
is $2,450.00: **20.7% high**, which at a 25% rule is $126.88 more per load. And
because `fuelSurchargeCents` is zero, `totalRevenueCents` equals
`linehaulCents`, so **`PERCENT_GROSS` and `PERCENT_LINEHAUL` cannot produce
different answers on these loads** — the distinction the engine offers, and
names in every pay snapshot, is not reaching the arithmetic.

**Two checked-in artefacts disagree about the intent**, which is why this is a
ruling and not a bug to quietly fix:

- the form reads the **total** on purpose, with a comment explaining that the
  rate is read and never computed;
- the verification script asserts `linehaulCents === 245000`, the **line haul**,
  and fails today with `295750 cents`.

Both were written here. Either answer is defensible — paying "25% of the load"
on the all-in rate is ordinary in trucking — but they cannot both be true, and
the one that is true has to be the one the schema's four fields mean.

**What a ruling would have to say:** whether a rate confirmation's fuel
surcharge and accessorials land in their own columns (and the rate field means
line haul), or whether the load's rate is the all-in payout (and then
`PERCENT_LINEHAUL` needs to say what it now means, since it can no longer differ
from `PERCENT_GROSS`). Severity **1 for the money path** — it does not stop
anybody booking freight, and it changes what a driver is paid.

---

## Tier 0 — prerequisites (production)

| box                                        | status      | evidence                                                                                                                                                                   |
| ------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Disptach" typo account deactivated        | **Blocked** | A fact about `User` rows. This session was not permitted to read the production database. `scripts/uat-production-read.mjs --target=production` answers it in one command. |
| Real dispatcher account exists, role right | **Blocked** | Same. The script prints every account's role, active flag and whether it has ever signed in.                                                                               |
| Live Check ADMIN account + `.env` entries  | **Failed**  | `PROD_CHECK_EMAIL` and `PROD_CHECK_PASSWORD` are **absent** from `.env` — verified first-hand. So the account either does not exist or its password was never stored.      |
| Production live check, expect 18/18        | **Failed**  | **11/12.** Every anonymous assertion passes; the twelfth is `PAIRED CHECKS SKIPPED (no session)`. 11/12 is the ceiling until the box above is done.                        |

The production live check in full:

```
ok  root → /dashboard (307)   ok  /login 200            ok  /reset-password 200
ok  /loads /trucks /trailers /drivers /brokers /account all 307 → /login
ok  /api/documents/confirm 401     ok  no external font CDN
FAIL PAIRED CHECKS SKIPPED — PROD_CHECK_EMAIL / PROD_CHECK_PASSWORD not set
```

---

## Tier 1 — access & security (production)

| box                                                        | status                                                   | evidence                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dispatcher signs in, changes password                      | **Blocked**                                              | Needs a person at a browser with the dispatcher's credentials. No dispatcher account is known to exist on production (see Tier 0).                                                                                                                                                                                                                                                                    |
| Dispatcher's sidebar: no Money, no Admin                   | **Passed** (machine) · by-eye outstanding                | `tests/permissions.test.ts` — "shows a dispatcher neither money group" and `can(dispatcher,'read','auditLog') === false`. Confirmed again through a real session by `scripts/verify-dispatcher.mjs`: "the sidebar omits the Money group entirely — not rendered and not hidden".                                                                                                                      |
| Dispatcher types a forbidden URL                           | **Passed** (machine) · by-eye outstanding                | `verify-dispatcher.mjs`: a dispatcher gets HTTP 404 on the screens the role does not hold, including the edit screens.                                                                                                                                                                                                                                                                                |
| Accounting sidebar re-glance                               | **Blocked**                                              | By-eye, production, after role changes. No role changes were made by this run.                                                                                                                                                                                                                                                                                                                        |
| Owner sees everything                                      | **Passed**                                               | The owner's own daily use, plus every screen probed 200 in this run.                                                                                                                                                                                                                                                                                                                                  |
| Wrong password refused, neutral message                    | **Passed** (dev + tests) · production by-eye outstanding | `tests/auth-action.test.ts` asserts the exact words for every refusal path, one case per row of the login table. Deliberately **not** exercised against production: it would mean failed sign-ins against a real account.                                                                                                                                                                             |
| Rate limiter: 5 wrong, then correct refused, 15 min, works | **Passed** (tests) · production by-eye outstanding       | Same suite, including the reset case. Not run against production for the same reason — five deliberate failures against a live account is a lockout, not a test.                                                                                                                                                                                                                                      |
| Deactivation kills a live session                          | **Blocked**                                              | Needs two sessions and a person watching one bounce. Not attempted on production (it would deactivate a real account) and not on dev (it needs the two-browser setup the checklist describes).                                                                                                                                                                                                        |
| Reset email, link works once                               | **Blocked**                                              | Needs inbox access. Not attempted: it sends real mail.                                                                                                                                                                                                                                                                                                                                                |
| The trail: today's Users-screen activity                   | **Partly passed**                                        | The hand-off the checklist asked for now has two answers. The **audit screen exists** (`/audit`, Owner/Admin only, org-scoped, shipped `583b4df`) and renders: `200 /audit — When \| Who \| Action \| Record \| Record id \| Changed`. The production **reading** is still blocked — `scripts/uat-production-read.mjs --target=production` prints every `User`/`Membership` audit row with its actor. |

---

## Tier 2 — the working day (dev)

Run against the **deployed dev worker** at `sha-d78049d`, with a real session,
using the verification scripts this repository already has for these claims.
Nothing below is a reading of the code.

| box                                             | status           | evidence                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Broker created → appears → edit → soft-delete   | **Passed, part** | `reference-walkthrough` 12/12: broker created through the UI. Edit and soft-delete were exercised on the truck in the same run — `deletedAt` set, row kept.                                                                                                                                                                                                                                 |
| Truck + trailer + driver, right authority       | **Passed**       | Same run: `wtdhw77-T1`, `wtdhw77-R1`, `Walkthrough wtdhw77`, each created through the interface, counts before/after confirmed against the database.                                                                                                                                                                                                                                        |
| Transfer the truck RAM → Dolphins               | **Passed**       | "transfer wrote a new open period — 2 period(s), last open: true", "the truck's own authority moved with it", and "a second open period is refused by Postgres".                                                                                                                                                                                                                            |
| Pair driver ↔ truck, board shows the name      | **Not executed** | Belongs to `verify-board`, which cannot drive the create form today (below).                                                                                                                                                                                                                                                                                                                |
| Create a load keyboard-only, stopwatch          | **Passed, part** | The create works on the deployed worker: `verify-pod` booked load **1175** through the form, and `verify-upload-first` booked one from a rate confirmation. The stopwatch is a claim about a person.                                                                                                                                                                                        |
| Rate con during create, "Preparing…/Uploading…" | **Passed, part** | `verify-upload-first` 16/18: the offer filled broker, pickup, delivery and both dates, marked 8 fields as document-sourced, attached the rate con, carried the extraction across, saved the printed delivery window with two different ends, and left no orphan pending row. The two words being **visibly distinct** is a human observation. Its two failures are the money finding above. |
| Load appears: stripe, Booked, authority chip    | **Passed, part** | `/loads` renders with Status and Authority columns and the booked load in it. The stripe's colour is by eye.                                                                                                                                                                                                                                                                                |
| Assign from the board → Dispatched, AUTOMATIC   | **Not executed** | `verify-board` reached the board after its driver fixture was repaired, then failed at "two loads booked into the same window" — its own fixture never appeared. Cause not isolated; the form itself books loads, proven above. **Not evidence that the board is broken, and not evidence that it works.**                                                                                  |
| Conflict refusals speak                         | **Passed, part** | The duplicate-unit refusal speaks in words — "That unit number is already in use under this authority." — with the positive control beside it (the same form saves once the number is unique). The overlapping-load and out-of-service refusals belong to `verify-board` and `verify-dispatch-warning`.                                                                                     |
| Mark Delivered                                  | **Not executed** | `verify-pod` booked its load, clicked the control, then timed out for 60s on "no disabled submit button anywhere on the page" — a settling condition the page has outgrown.                                                                                                                                                                                                                 |
| POD upload → POD received by itself             | **Not executed** | Same run, same stop.                                                                                                                                                                                                                                                                                                                                                                        |
| Download the POD back                           | **Not executed** | `verify-upload` takes `--base` and `--load`; I ran it without them. My error, not a defect — it needs a load number, so it belongs with Tier 3.                                                                                                                                                                                                                                             |
| Cancel with a reason                            | **Not executed** | No script covers it; it is a human click.                                                                                                                                                                                                                                                                                                                                                   |
| Saved view survives sign-out                    | **Passed**       | `verify-views`: the save control appears only on a filtered table, the view is pinned as a chip carrying the query, **it is a row in the database and not localStorage**, and it is present in a second browser context with no shared storage.                                                                                                                                             |
| Density survives sign-out                       | **Not executed** |                                                                                                                                                                                                                                                                                                                                                                                             |
| Russian reads, Farsi mirrors right-to-left      | **Blocked**      | A claim about what a person sees. No instrument substitutes.                                                                                                                                                                                                                                                                                                                                |

### What the Tier 2 run found about the instruments

**Three of this repository's own verification scripts had quietly stopped
working**, and that matters more than any single box: they are the Tier 2
coverage, and nothing was watching them.

- `/drivers/new` became the upload-first flow in Phase 5 — a drop zone with a
  manual-entry link beside it, and **no form on the landing step**. Three scripts
  created a driver by typing into the old blank form, so each died after 30
  seconds on a fixture, before reaching anything it was written to test.
  `reference-walkthrough.mjs` and `verify-board.mjs` are patched here to click
  through the manual link, the way `verify-driver-form.mjs` already did; the
  walkthrough went from **2 claims to 12/12**. Three more carry the same rot and
  were left alone: `acceptance-phase2.mjs`, `screenshot-fixtures.mjs`,
  `verify-settlements.mjs`.
- `verify-views` and `verify-pod` each pass their first half and then stop on a
  wait or a lookup that the screens have outgrown.

None of this was visible from a green `npm run check`: these scripts run by hand,
against a deployed worker, and nothing fails when they rot.

## Tier 3 — first real freight (production)

**Not started, and not mine to start.** Every box requires the dispatcher to book
real freight.

Whether production already holds freight is **not known to this run** — reading
the production database was not permitted here, and guessing from the fact that
no dispatcher has signed in would be exactly the kind of inference this document
should not contain. The hand-off script prints the counts.

The one box that is mine is ready and waiting: send a load number and
`verify-upload` rides it to prove the rate con's bytes come back out of R2
through the interface.

---

## Where `UAT-CHECKLIST.md` Version 1 is now wrong

Not defects — the document is two months old and four of its statements have
been overtaken. They matter because its last section exists so that "nobody hunts
for them".

1. **"`/` redirects to `/loads`"** — it redirects to `/dashboard` (307,
   observed). The Dashboard is built.
2. **"Dashboard, Documents and Settings are in no brief at all"** — the dashboard
   shipped across v10.14–v10.18 with charts, panels and a Needs-you rail.
3. **"Reports, Calendar … return in Phase 5"** — `/accounting/reports` is built
   (v10.19) with four charted sections.
4. **"leave this box until an audit screen exists"** — `/audit` exists.

Recommend a Version 2 of the checklist before Tier 3. This run did not edit it:
it is the artefact under test.

---

## To finish this, in order

1. **Rule on the rate confirmation's money** (the section above). It decides
   what a driver is paid on the first real load, and it is cheaper to settle now
   than to correct a settlement later.
2. **Create the Live Check ADMIN account** and put its password in `.env` as
   `PROD_CHECK_EMAIL` / `PROD_CHECK_PASSWORD`. Then the production live check can
   reach 18/18 — it is 11/12 by construction without it.
3. **Run the hand-off**, which closes three Tier 0 boxes and the Tier 1 trail
   box:

   ```bash
   node -r dotenv/config scripts/uat-production-read.mjs --target=production
   ```

4. **Create the dispatcher account**, hand over the temp password, and watch
   Tier 1's five login boxes with your own eyes.
5. **Run Tier 2 by hand on dev.** The stopwatch, the keyboard-only create, the
   "Preparing…/Uploading…" distinction and the right-to-left layout are all
   claims about what a person perceives.
6. **Then Tier 3**, and send the load number.

Already done by this run, so it is not on that list: both workers serve HEAD, the
three 500s are fixed and verified on the deployed worker, and the Tier 2 parts a
script can carry have been executed and are recorded above.

### Loose ends this run created, deliberately left alone

- **Dev carries fixture rows** from the scripts above — trucks, trailers, drivers,
  brokers and a few loads with tag-shaped names (`wtdhw77-T1` and the like), plus
  two from the runs that crashed mid-way. `scripts/sweep-test-rows.mjs` exists for
  this. Nothing was deleted here: the checklist says dev data is disposable, not
  that a UAT pass should decide when to dispose of it.
- **Three more scripts carry the same stale driver path**
  (`acceptance-phase2.mjs`, `screenshot-fixtures.mjs`, `verify-settlements.mjs`).
  Only the two the checklist needed were patched.

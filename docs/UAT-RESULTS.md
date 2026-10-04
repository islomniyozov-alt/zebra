# Zebra — UAT results

**Run:** 2026-10-04, by Claude Code against `UAT-CHECKLIST.md` **Version 1**
(2026-08-03).
**Commits produced by this run:** `e912455`, `4307ac7`, `10b69ed`, `549472f`,
`5ab4c5e`.

---

## Ready for first external customer: **NO**

Three screens were returning **500** in production when this run started, and two
of them are the screens a dispatcher spends the day on. They are fixed in the
commits above, and the fix is not in production until a dispatch succeeds.

| why not                                                                                                              | severity      |
| -------------------------------------------------------------------------------------------------------------------- | ------------- |
| The fixes for the three 500s are not deployed — production serves `sha-e961a9f`                                      | **1 — fatal** |
| Tier 0 is not done: no Live Check account, so the paired production check has never run (11/12, best possible 11/12) | **1**         |
| No dispatcher has ever signed in to production — every Tier 1 login box is unobserved                                | **1**         |
| Tier 2's load lifecycle has not been run end to end by a person on a browser                                         | **2**         |
| Tier 3 has not started: no real freight exists on production                                                         | **2**         |

Nothing here is a reason to doubt the application's _logic_ — the gate is green
and the full integration project passes. The reasons are that the doors have not
been opened by a human, and that what is deployed is older than what is fixed.

---

## Environments

| what                     | value                                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| Production worker        | `https://zebra.tajikcargollc.workers.dev`                                   |
| Dev worker               | `https://zebra-dev.tajikcargollc.workers.dev`                               |
| Both serving, at start   | `sha-e961a9f` — **8 commits behind HEAD**, 13 files under `src/` different  |
| Read from                | Cloudflare, via `scripts/check-deploy-drift.mjs`, never from a local belief |
| `npm run check`          | **EXIT CODE 0 — OK** (`.run-status/check.json`)                             |
| Full integration project | **EXIT CODE 0 — OK**, 11m07s (`.run-status/integ-full.json`)                |

The drift reading is the important one: **both workers were serving the commit
that broke `/payroll/batches`**, and neither had the audit screen, the production
migration gate or the login fix. Those are Criticals #1–#3 from earlier today;
they are committed and were never dispatched.

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

**Evidence after the fix**, every page probed with a real session:

```
200  /loads            Load | Authority | Broker | Pickup | Delivery | Truck | Status | Rate | Warnings
200  /trucks           Unit number | Authority | Make | Plate | Status | Fleet status | Aging | Heading to | Warnings
200  /payroll/batches  Batch | Status | Check date | Period | Statements | Gross | Deductions | Amount | Pay company
200  /payroll/statements · /payroll/charges · /settlements · /accounting/payments · /audit · /dashboard
```

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

Executed as far as a browser automation can carry it. **Every box below that is
not Passed is Blocked on a human at a keyboard, not on a defect.**

| box                                             | status | evidence |
| ----------------------------------------------- | ------ | -------- |
| Broker create → edit → soft-delete              |        |          |
| Truck + trailer + driver under RAM              |        |          |
| Transfer the truck RAM → Dolphins               |        |          |
| Pair driver ↔ truck, board shows the name      |        |          |
| Create a load keyboard-only, stopwatch          |        |          |
| Rate con during create: Preparing… / Uploading… |        |          |
| Load appears: stripe, Booked, authority chip    |        |          |
| Assign from the board → Dispatched, AUTOMATIC   |        |          |
| Conflict refusals speak                         |        |          |
| Mark Delivered                                  |        |          |
| POD upload → POD received by itself             |        |          |
| Download the POD back                           |        |          |
| Cancel with a reason                            |        |          |
| Saved view survives sign-out                    |        |          |
| Density survives sign-out                       |        |          |
| Russian reads, Farsi mirrors                    |        |          |

---

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

1. **Dispatch dev, then production.** The ritual's steps 3 and 4. Until then
   production serves three broken screens.
2. **Create the Live Check ADMIN account** and put its password in `.env` as
   `PROD_CHECK_EMAIL` / `PROD_CHECK_PASSWORD`. Then the production live check can
   reach 18/18 — it is 11/12 by construction without it.
3. **Run the hand-off**, which closes three Tier 0 boxes and the Tier 1 trail box:

   ```bash
   node -r dotenv/config scripts/uat-production-read.mjs --target=production
   ```

4. **Create the dispatcher account**, hand over the temp password, and watch
   Tier 1's five login boxes with your own eyes.
5. **Run Tier 2 by hand on dev.** The stopwatch, the keyboard-only create, the
   "Preparing…/Uploading…" distinction and the right-to-left layout are all
   claims about what a person perceives.
6. **Then Tier 3**, and send the load number.

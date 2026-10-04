import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// A PRODUCTION CONNECTION STRING LIVES ON THIS MACHINE NOW. THIS IS THE FENCE.
//
// `PROD_DIRECT_DATABASE_URL` in `.env` lets the migration check VERIFY against
// production rather than trusting a marker a human wrote. That is strictly
// better evidence, and it costs something real: a production URL moves from
// "one variable, one terminal, one command" to sitting in the ambient
// environment of every process that loads dotenv here.
//
// THAT IS NOT THEORETICAL. On 2026-08-15 a `neondb_owner` string reached
// production's `DATABASE_URL` by clipboard, and only `src/lib/db.ts` refusing
// any string without `zebra_app` in it turned a silent row-level-security
// bypass into a loud outage (flag 77). The same clipboard, the same evening,
// also put an unfilled placeholder into a migrate command twice.
//
// SO THE VARIABLE IS SAFE BY CONSTRUCTION RATHER THAN BY INTENT:
//
//   it is read by an ALLOWLIST of files, by name, and a new reader fails here
//   it is never assigned into DATABASE_URL or DIRECT_DATABASE_URL
//   the readers only ever SELECT
//
// SEVEN READERS, NOT ONE. The ruling that produced this file said the
// variable was read by `check-migration-gap.mjs` and nothing else. It was
// already read by six: five walkthrough scripts choose it over
// `DIRECT_DATABASE_URL` when their target is production, and `verify-users`
// REFUSES TO RUN against production without it. The name was an established
// convention before this fence was proposed, and the fence is written around
// what is actually there rather than around what was believed.
//
// THE LIST IS THE MECHANISM. A new reader fails here by name, so adding one
// is a decision somebody makes on purpose rather than a habit that spreads.
// The two `check:` readers are held to a stricter rule than the walkthroughs:
// they run inside `npm run check`, unattended, constantly, so they may only
// SELECT.
// ---------------------------------------------------------------------------

const VARIABLE = 'PROD_DIRECT_DATABASE_URL'

/**
 * Everything permitted to read it.
 *
 * `check:` scripts run unattended inside `npm run check`. The walkthroughs are
 * run deliberately by a human, at a named target, and predate this fence.
 */
const CHECK_READERS = [
  'check-migration-gap.mjs',
  'check-unrouted.mjs',
  // ADDED 2026-08-20, deliberately, which is what this fence is for.
  //
  // Flag 81: the schema is version-controlled and the GRANTS ARE NOT, so two
  // databases could disagree about who may read what and nothing would say so.
  // `src/lib/grant-rule.ts` derives the expected grants from the migration and
  // `tests/structure.test.ts` asserts them against dev — but the test suite
  // may not read this variable, so production needs its own caller. One rule,
  // two callers, and the second one is this.
  //
  // Held to the stricter half of the rule below: it runs unattended in
  // `npm run check` and only ever SELECTs.
  'check-grants.mjs',
  // ADDED 2026-09-06. `Load.billingStatus` is a cached column and changing
  // `billingStatusFor` silently drifts every untouched row — which reached
  // production once already. This asks the REAL function whether the stored
  // values still agree, rather than a SQL lookalike that would be a second
  // derivation of the rule. TypeScript for that reason, and read-only: the
  // repair path writes a status event and is run by a human.
  'check-billing-drift.ts',
]

/**
 * The deploy reads it to PASS IT ON, and queries nothing itself.
 *
 * It was added on 2026-08-16 because it was the one command whose decision
 * the variable existed to inform and the only one that could not see it: the
 * `check:` scripts run under `node -r dotenv/config` and `deploy:prod` does
 * not, so a deploy accepted a human-written marker while a live answer sat in
 * `.env`. It parses the single key rather than loading dotenv, because
 * loading it would put the dev connection strings into the process the
 * integration gate is spawned from.
 */
const DEPLOY_READERS = ['deploy.mjs']

const WALKTHROUGH_READERS = [
  'verify-factoring.mjs',
  'verify-money-roles.mjs',
  'verify-payments.mjs',
  'verify-settlements.mjs',
  'verify-users.mjs',
]

/**
 * Run by a human, deliberately, and permitted to SELECT and nothing else.
 *
 * A category between the two that existed. The `check:` scripts are unattended
 * and read-only; the walkthroughs are human-run and write fixtures by design.
 * An INSPECTION is human-run like a walkthrough and read-only like a check —
 * somebody asking production a question whose answer governs a decision.
 *
 * Held to the STRICTER rule below, because the whole value of an inspection is
 * that reading it cannot change the thing being read. A question that edits its
 * subject is not a question.
 */
const INSPECTION_READERS = [
  // ADDED 2026-10-04, read-only, and it is the reason this fence fired today.
  // UAT-CHECKLIST.md's Tier 0 and its trail box are questions about `User`,
  // `Membership` and `AuditLog` rows on production, and the session running the
  // checklist was not permitted to read that database — so the boxes became one
  // command the owner runs. Every statement in it is inside
  // `BEGIN TRANSACTION READ ONLY`, which is Postgres refusing a write rather
  // than this list trusting the author.
  'uat-production-read.mjs',
  'inspect-relay-customer.mjs',
  // Counts loads that are finished, billable and attached to nobody, before
  // `isReady` learns to check assignment. SELECT only.
  'inspect-unassigned-pod.mjs',
  // Why the topbar's authority filter renders three of five: inactive rows or
  // a scoped membership are different findings and only one is a defect.
  'inspect-authorities.mjs',
  // ADDED 2026-09-07, read-only. The Datatruck seed left production with two
  // trucks numbered 1024 — the real one and a hand-made row carrying `WW2020`
  // where a VIN belongs. Whether that row is deleted or corrected depends on
  // what points at it, and the honest order is to ask before touching it, not
  // after. Enumerates every referencing table by hand, the way `companies.ts`
  // counts what a cascade would destroy.
  'inspect-asset-refs.mjs',
  // ADDED 2026-09-10, read-only. Settlements cannot be tested against real
  // freight while delivered loads carry no driver: a settlement pays somebody
  // for loads they hauled, and a load with nobody on it is money the engine
  // cannot see. Asks three things that block it — the finished loads with no
  // driver or truck, the drivers whose freight names a truck they are not
  // linked to, and what the two trucks numbered 1024 actually hold.
  //
  // THE DRIVER QUESTION IS ASKED OF THE LOADS, not of the Datatruck export.
  // `seed-datatruck-drivers.ts` counts the cross-authority pairs from a
  // spreadsheet column; this counts them from the freight that ran, which is
  // the standing rule about building an instrument from the artefact. Where
  // the two disagree, that is a finding rather than a discrepancy to hide.
  'inspect-unassigned-freight.mjs',
  // ADDED 2026-09-10, read-only. Before the Amazon remittance importer writes
  // anything, this counts where its rows would land against real freight — the
  // last read of the build. The design predicted four outcomes; the database
  // says a fifth dominates, and a preview that could not count it would report
  // a week as reconciled while pointing payments at loads the settlement
  // engine deliberately cannot see.
  //
  // It reads the six workbooks in corpus/amazon and SELECTs loads by
  // referenceNumber. It writes no Payment, no application, no accessorial and
  // no status — none of that is built yet.
  'preview-amazon-remittance.ts',
  // ADDED 2026-09-10, read-only. The owner ruled that Zebra's revenue starts
  // at the cutover and pre-cutover Amazon money stays out of the books. That
  // is safe only if no pre-cutover load ALREADY carries Zebra money — an
  // invoice line, a settlement line, a payment application or an accessorial —
  // because excluding the remittance for a load that has half a figure on it
  // is worse than either whole answer. Counts the four separately.
  'inspect-amazon-money.mjs',
  // ADDED 2026-09-11, read-only. MONEY-DESIGN item 3 rebuilds `Settlement`
  // into a batch, and `Settlement`/`SettlementLine` already exist from Phase 3
  // with a screen and a PDF route behind them. Whether those tables hold rows
  // somebody was PAID from decides what the migration is allowed to do, and
  // reasoning about it from the code is how a schema change becomes a money
  // incident. SELECT only.
  'inspect-settlement-rows.mjs',
  // ADDED 2026-09-11, read-only. Three readings off the money screen —
  // 17 not-ready on a retired authority, a no-remittance warning on the wrong
  // carrier, a ready count of zero — are each claims about what that page's
  // queries RETURN. Asking the rows the same questions in SQL is how the
  // answer and the screen get compared, instead of one being used to explain
  // the other. SELECT only.
  'inspect-money-screen.mjs',
  // ADDED 2026-09-12, read-only. The provider switch needs to know what one
  // document read actually costs, per document type, and the code cannot say:
  // the prompts are in the repository but the document is most of the input
  // and the output is not knowable in advance. `ExtractionUsage` holds one row
  // per engine call with the tokens as the engine reported them, which is the
  // only measured half of the figure. SELECT only.
  'inspect-extraction-usage.mjs',
  // ADDED 2026-09-24, read-only, by ruling. The first real settlement week
  // after the operational cutover is about to be drafted on production, and
  // three things make freight invisible to a settlement without making it
  // look wrong: a load in nobody’s seat, a truck nobody is linked to, and a
  // driver with no pay rule in force. Each one produces a draft that BALANCES
  // and is short.
  //
  // The alternative to this script was reasoning from the code about what
  // production probably holds, which is the instrument-from-belief failure
  // AGENTS.md records twice. Asking the rows is the whole point.
  //
  // It asks the RULE question the way `settlements.ts` asks it — per load, on
  // that load’s own POD date — rather than per week, because a rule starting
  // mid-week would answer yes to the weekly question while the earlier loads
  // went unpriced.
  //
  // SELECT only, and it refuses outright if more than one organization holds
  // the week’s freight: it connects as the owner role, so the thing that
  // keeps tenants apart everywhere else is absent, and a merged count is not
  // a finding anybody can act on.
  //
  // TYPESCRIPT SINCE 2026-09-24, and for `check-billing-drift.ts`’s reason: it
  // classifies the remittance by IMPORTING `remittanceOutcome` rather than
  // reimplementing three comparisons in SQL. A lookalike agrees with the
  // engine until one of the two grows a tolerance, and then a preflight
  // disagrees with the settlement it is a preflight for.
  'settlement-week-preflight.ts',
  // ADDED 2026-09-24, read-only, by ruling. The loads preview reports names
  // that resolve to NOTHING, and a zero in that table is a count of REFUSALS —
  // not evidence that anybody resolved. Two readings on the settlement week
  // turned on exactly that gap:
  //
  //   1. A driver was reported present on production and the preview still
  //      resolved her to nothing on 7 loads. Absent, present under a different
  //      spelling, and present but not live need different answers, and the
  //      preview cannot tell them apart — it prints the same line for all
  //      three.
  //   2. All three co-driver tables came back zero on a week whose co-driver
  //      column holds `7 Star` and `Said truck 3609`. Read as "everybody
  //      resolves" that is a finding about the data; read honestly it is a
  //      finding about nothing, and the difference decides whether 39 second
  //      seats get filled from notes somebody typed in a text field.
  //
  // It also reports every pay rule VERSION with its effective window, because
  // "the rule exists" and "a rule is in force on the day this load delivered"
  // are different claims and only the second one pays anybody. Same reason
  // `settlement-week-preflight.ts` asks per load rather than per week.
  //
  // It reads every driver and matches names IN MEMORY with the same `nameKey`
  // the seed uses, rather than comparing names in SQL — a lookalike comparison
  // would be a second definition of who counts as the same person, which is
  // the defect `coDriverSeat` was extracted to stop.
  //
  // SELECT only.
  'inspect-crew-and-rules.ts',
  // ADDED 2026-09-25, read-only. The 2026-09-13..19 write reported 185 loads
  // and 182 operational events; the preflight then counted 177 reaching
  // POD_RECEIVED in the week; the export holds 181 rows the books own. Four
  // numbers that should agree, and a gap of four loads is four drivers' pay.
  //
  // EACH NUMBER ANSWERS A DIFFERENT QUESTION — did the row land, did it get an
  // event, should it have one, is that event dated inside the period — so
  // reasoning from one to another is how a week gets declared clean while
  // freight is missing. `settleableWhere` needs four conditions at once and a
  // row can fail any one of them while looking ordinary on the load list.
  //
  // So this walks the EXPORT row by row against the database and names what
  // fell out, with the reason. Built from the artefact rather than from the
  // importer's report of its own writes, which is the instrument-from-belief
  // failure AGENTS.md records twice. SELECT only.
  'inspect-week-landing.ts',
  // ADDED 2026-09-26, read-only. Diffs a transcribed Datatruck statement against
  // Zebra's draft for the same driver and period, to the cent: every load line's
  // gross, miles and driver amount, then the deductions, then the totals.
  //
  // It pairs the lines on `Load.referenceNumber` — a statement names its loads by
  // Amazon reference and Zebra names them DT-016xxx — which is the same handle
  // the remittance matcher uses, so no mapping is invented here.
  //
  // THE ONE ADJUSTMENT IS IN THE COMPARISON ONLY, by ruling: a line the engine
  // held for `no_remittance` is priced on booked gross for the diff, because
  // Datatruck never waited for Amazon and comparing a held line against a paid
  // one reports a difference of POLICY rather than of arithmetic. The engine is
  // untouched and the report names the lines it applied to, so the diff cannot
  // quietly launder the hold the week depends on.
  'diff-statement-against-draft.ts',
  // ADDED 2026-09-26, read-only. Parses every statement in a folder for one
  // period and compares each line against Zebra: does the load exist, does its
  // recorded gross match.
  //
  // THE TIE IS A HARD GATE, by ruling. A statement whose parsed lines do not
  // reproduce its own printed gross, mileage AND amount is reported UNPARSED and
  // contributes nothing — never partially believed, never repaired, never
  // guessed at. That is what makes a bulk parse admissible at all next to the
  // hand-transcribed fixtures: a wrong parse cannot reach the comparison, so the
  // failure mode is a missing answer rather than a false one.
  //
  // It also refuses to count a re-download twice — the folder holds 23 files for
  // 18 settlements — and reports any duplicate whose twin parses differently.
  'bulk-parse-statements.ts',
  // ADDED 2026-09-30, read-only, SELECT and nothing else. Counts the
  // settlements carrying an internal id instead of an issued number — owner's
  // ruling that day, "a settlement marked PAID must carry a number".
  //
  // IT READS PRODUCTION BECAUSE THE QUESTION IS ABOUT PRODUCTION. "How many
  // rows break this" has a different answer on each database and the repair is
  // scoped by that answer; asking dev and assuming production matches is the
  // baseline-you-supplied failure AGENTS.md opens with. It answered zero, which
  // is why no production repair was written.
  //
  // COUNTED PER STATUS, never in total: a DRAFT holding a placeholder is the
  // system working and a PAID one is the defect, and one number over both is
  // the superset that hides the row that matters.
  'audit-statement-numbers.ts',
]

/**
 * Run by a human, deliberately, and permitted to write.
 *
 * A one-off repair of rows the application cannot reach on its own. It is NOT
 * held to the read-only rule — writing is the point — so the safety lives in
 * the script instead: it is dry-run unless told otherwise, it names every row
 * it would touch and why, and running it twice changes nothing the second time.
 *
 * A script in this list is a claim that somebody read its dry-run output before
 * it ever wrote anything.
 */
const MAINTENANCE_READERS = [
  // ADDED 2026-09-24, by ruling, and it WRITES on --apply. Four rows the
  // application could have produced through its own screens, done as one
  // reviewed act because they are one decision: a driver who hauled the first
  // settled week and was never on the roster, her rate, and a rate change for
  // JERRY ROBERT MCKANE from 30% to 20% on the same date.
  //
  // THE DRY RUN IS THE REAL PATH, ROLLED BACK. It opens a transaction, writes
  // through `createDriver`, `closePayRule` and `saveDriverPayRule` — the same
  // functions the screens use — reads the rows back, and throws to roll back
  // unless --apply. A printed plan cannot exercise the overlap refusal in
  // `saveDriverPayRule`, and that refusal is the entire hazard in a rate
  // change: two rules in force on one day means the pay for that day depends
  // on which row is read first.
  //
  // Idempotent by asking, per step, whether it has already happened. A
  // half-finished money change that doubles on re-run is the failure being
  // designed against.
  // ADDED 2026-09-30. It WRITES — to dev, never to production: with
  // `--production` it reads and prints, and `--production --apply` is REFUSED
  // rather than ignored, because a flag silently dropped is how somebody
  // believes they have written when they have not.
  //
  // IT IS IN THIS LIST AND NOT THE READ-ONLY ONE because that list forbids
  // the word UPDATE anywhere in the file, and this file contains two: the dev
  // repair, and the statement it PRINTS for a human to run on production. The
  // guard is right to make no distinction — a checker that tried to tell a
  // write from a string containing one would be parsing SQL out of comments.
  //
  // It reads production to answer what dev cannot: does production hold the
  // CRLF checksum too. It does — the migration was applied there from the
  // same Windows working tree — so the statement it prints is needed.
  'repair-migration-checksum.ts',
  'add-julia-and-rate-change.ts',
  // ADDED 2026-09-24, by ruling, and it WRITES on --apply. Sets
  // `Driver.kind = 'PAYEE'` on four rows named by DATATRUCK ID — 119, 136, 866
  // and 803 — and touches nothing else: not the roster status, not the pay
  // rules, not a load. The ruling is explicit that these rows stay active and
  // keep being paid.
  //
  // KEYED ON `externalId` BECAUSE THE OWNER NAMED IDS. A name is something
  // somebody typed and two rows could share it; an id identifies one row in the
  // source system. It also makes the script unmistakably a list of four rather
  // than a pattern — two of the four trip no heuristic at all, and are on it
  // because the owner knows an arrangement the data does not record.
  //
  // THE READ-BACK ASSERTS THE EXCLUSION, not the column. A row saying PAYEE
  // proves nothing about whether the DQF stopped expecting a file; the script
  // calls `isQualifiable` and REFUSES if it still returns true. Dry run rolls
  // back, same shape as the script above.
  'set-referral-payees.ts',
  // ADDED 2026-09-25, by ruling, and it WRITES on --apply. Moves freight
  // attributed to a TERMINATED driver onto the driver Zebra links to the truck,
  // and writes a note event carrying the reason and the export's original name.
  //
  // The 2026-09-13..19 export named `CANER GUNAL` (terminated 2026-06-25) on six
  // loads on unit 0006 and `ROSARIO SANTOS RODOLFO` (terminated 2026-04-24) on
  // four on unit 216. Both trucks are linked to a different active driver.
  // $10,549.89 would have been held under two people with no pay rule while the
  // two who hauled it got nothing.
  //
  // THE DECISION IS `terminatedYieldsToTruck`, a pure function with its own
  // tests, so the importer and this repair cannot disagree about who a load
  // belongs to — and it requires the delivery to fall AFTER the termination, so
  // a departed driver's earlier freight stays theirs.
  //
  // Dry run rolls back. A load whose truck has two drivers linked is left alone
  // rather than guessed at, and the left-alone rows are printed.
  'repair-terminated-attribution.ts',
  // ADDED 2026-09-25, by ruling, and it WRITES on --apply. The runner
  // `writeRemittance` never had: that function has been built and tested since
  // 2026-09-11 with NO CALLER, so a week could be counted and not imported.
  //
  // WHICH AUTHORITY THE CASH IS BOOKED TO is the decision it exists to make.
  // `Payment` carries one `companyId` and the week's Amazon freight runs across
  // two authorities. The ruling: the company whose identity matches the
  // workbook's Carrier line, refuse unless exactly one.
  //
  // The ruling said MC and the workbook has none — checked the raw sheet. It
  // carries a Carrier name and a SCAC, so the match is SCAC AND legalName, both
  // exact, both picking the same single company. Stricter than either alone: a
  // SCAC typed onto the wrong company cannot route a week's cash by itself.
  //
  // `--invoice` is REQUIRED. Six of the seven workbooks in the corpus are
  // settled history and a directory sweep would be one keystroke from writing
  // all of them. `writeRemittance` is idempotent and would refuse the repeats,
  // which is precisely the net this declines to depend on.
  'import-amazon-remittance.ts',
  // ADDED 2026-09-25, by ruling, and it WRITES on --apply — but only ever a
  // DRAFT. It opens the settlement week and refreshes it, and NEVER calls
  // `finaliseBatch`: a draft holds no truth, every refresh throws its lines away
  // and recomputes from the loads and rules as they are now, and FINAL is the
  // only state that means somebody was paid.
  //
  // It prints every HELD line and every BLOCKED driver by name, because those
  // are the two ways a draft balances and is wrong — money the engine could not
  // price, and a driver who cannot be paid at all.
  //
  // A re-run refreshes the batch that already covers the week rather than
  // opening a second one, which is what `openBatch`'s `period_taken` refusal
  // hands back.
  'open-settlement-batch.ts',
  // ADDED 2026-09-28, by ruling. `openBatch` derives the check date now, and a
  // batch opened before that keeps the one it was given — cmuga82ji0000qkvslwyibodv
  // holds 2026-09-25 against a period ending 9/19, which is period end + 6.
  //
  // IT TAKES NO DATE, only a batch id: a repair script with a `--check` flag
  // would be the deleted field growing back where nobody looks.
  //
  // AND IT REFUSES ANYTHING THAT IS NOT DRAFT. The check date is printed on a
  // FINAL statement, and changing a date somebody has already been handed is a
  // second version of a paper document rather than a correction.
  'correct-batch-check-date.ts',
  'backfill-direct-pod.mjs',
  // Written 2026-09-06 and NOT RUN. `billingStatusFor` is a rule over a cached
  // column, so changing it drifts every untouched row; this repairs them
  // through `refreshBillingStatus`, which writes the status event. Listed here
  // rather than among the read-only scripts because --apply writes, and being
  // on this list is the claim that a human read its dry run first.
  'repair-billing-drift.ts',
  // ADDED 2026-09-09. `Sample Driver` — Datatruck's own test row, Driver ID 1
  // — reached production with the terminated-driver import. `TEST_DATA` in
  // drivers.ts stops a re-run recreating it; this removes the row already
  // there, by soft delete, so it stays reversible and keeps its externalId.
  //
  // It counts all eleven tables that can point at a driver and REFUSES if any
  // is non-zero: "it had nothing attached last Tuesday" is not a fact about
  // today. Dry run by default, `--apply` a second decision, and a second run
  // reports the row as already deleted and leaves it.
  'remove-datatruck-sample-driver.ts',
  // ADDED 2026-09-09. Undoes what the trucks seed wrote onto the wrong `1024`
  // — production carries two trucks with that unit number, the seed took `[0]`
  // of the matches, and the hand-made Dolphins row got the real truck's plate
  // and a compliance item. The seed now refuses an ambiguous unit; this
  // repairs the rows already written.
  //
  // Targeted at ONE truck id and ONE item id, both named in the report that
  // found them, and every identifying field asserted before it writes. Dry run
  // by default; a second run finds nothing to undo.
  'repair-1024-plate-and-compliance.ts',
  // ADDED 2026-09-09. Liability and cargo belong to the carrier, not the
  // vehicle. Production held 25 per-truck rows that are really 5 policies —
  // 17 Dolphins trucks and 5 RAM trucks all expiring 2025-10-21. This
  // promotes the oldest row of each group by clearing its asset link and
  // soft-deletes the copies.
  //
  // It REFUSES if a duplicate carries a document, since soft-deleting the row
  // would hide the document with it. Dry run by default.
  'migrate-insurance-to-company.ts',
  // ADDED 2026-09-10. Datatruck left loads open that nobody here will ever
  // settle — pickups back to 2024-12-01, still BOOKED or DISPATCHED, and the
  // current export still calls every one of them open, so the forward-only
  // sync will never advance them. An open load is a load this system can be
  // asked to settle, so they blocked the drivers seed outright.
  //
  // IT TOUCHES THE BILLING AXIS AND NOTHING ELSE. operationalStatus is never
  // written: a load that was DISPATCHED and never delivered stays DISPATCHED,
  // which is the honest record of what happened to it.
  //
  // Every id is NAMED — there is no query that decides what to close — and
  // each row is checked against BOTH sides before it is touched: still open
  // here, and still open in the export. A row Datatruck has since delivered is
  // refused so the sync can advance it properly. Dry run by default.
  'close-stale-datatruck-loads.ts',
  // ADDED 2026-09-24, by ruling. Until that day the Datatruck loads importer
  // wrote `operationalStatus` as a column value and no operational event, and
  // `settleableWhere` selects on an APPLIED POD_RECEIVED event inside the
  // period — so an imported load read Delivered on every screen and was in no
  // driver’s settleable set, in any week, for ever. The importer transitions
  // properly now; this repairs the rows it already wrote.
  //
  // Same shape as `backfill-direct-pod.mjs`, widened past `directSettled`, and
  // it REFUSES closed history by the owner’s guard — printing the refused
  // count rather than filtering it away, because that set is itself the
  // finding: `readStatus` maps every finished Datatruck row to
  // CLOSED_IN_DATATRUCK, which `SETTLEABLE_LOAD` excludes outright.
  //
  // The date is the freight’s, never `now()`: the delivery stop’s actual
  // arrival, else the scheduled time the import wrote from the export. A load
  // with neither is skipped and named. Dry run by default.
  'repair-missing-pod-events.mjs',
]

/**
 * ── THE FIRST SCRIPTS ON THIS FENCE THAT WRITE ────────────────────────────
 *
 * Everything above either only SELECTs, passes the URL on, or is a walkthrough
 * a human drives. These two INSERT — the Datatruck migration seeds, ~100 rows
 * of real fleet including 54 money-bearing pay rules — and that difference is
 * why they are listed apart rather than folded in beside the readers.
 *
 * WHAT STANDS IN FOR ROW-LEVEL SECURITY. They connect as the database owner,
 * because they write for an organization they are not a member of, and the
 * owner carries BYPASSRLS. The mechanism that makes a wrong-tenant write
 * impossible everywhere else in this system is absent here, so its replacement
 * is explicit and lives in `scripts/datatruck-tenancy.ts`:
 *
 *   * `--production` is required; the default target is dev
 *   * the organization is resolved, NAMED, and its id checked against one
 *     stated by the owner — a slug resolves on either database and proves
 *     nothing about which was reached
 *   * pre-existing counts are printed, so "46 created" against a table that
 *     already held 46 is a distinguishable event
 *   * preview is the default and `--write` is a second, separate decision
 *
 * Being on this list is the claim that somebody read the preview — the same
 * claim MAINTENANCE_READERS makes, one step further, because these create
 * rows rather than repairing them.
 */
const SEED_WRITERS = [
  'seed-datatruck-trucks.ts',
  'seed-datatruck-drivers.ts',
  // ADDED 2026-09-08. The load history names five MC holders; three of them
  // exist nowhere in Zebra and carry 2,757 loads between them. This creates
  // those three as RETIRED companies — never offered for new freight, always
  // visible where history is read — and it is a prerequisite rather than a
  // convenience: nothing about the load import can begin while 2,757 loads
  // have no authority to be filed under.
  //
  // Held to the same rule as the two above: preview by default, `--write` a
  // second decision, `assertTenancy` before anything. It writes THREE rows and
  // no money, which is the smallest thing on this list.
  'seed-datatruck-authorities.ts',
  // ADDED 2026-09-09. 69 people who used to drive here, because 4,118 loads in
  // the history are theirs and a load needs a driver to point at. They land
  // INACTIVE, keyed on `Driver ID` like the active 54, and the two sets were
  // measured disjoint before this was written — no id and no name in common.
  //
  // IT WRITES DRIVER ROWS AND NOTHING ELSE: no pay rules, no compliance items,
  // no asset history, each refused for a reason written out at the top of the
  // file. That makes it the narrowest writer on this list — the active driver
  // seed writes money and this one deliberately does not.
  'seed-datatruck-terminated-drivers.ts',
  // ADDED 2026-09-09. The last 39 names the load history carries, whom
  // Datatruck files as `applicant` while their freight says otherwise — up to
  // 191 loads each. With these, all 155 driver names in the history resolve.
  //
  // IT READS THE LOAD EXPORT TOO, which no other seed does, because the
  // selection rule is the freight rather than a status column: a row is
  // seeded only when at least one load names it, and the eight with none are
  // left out by ruling.
  //
  // Driver rows only. No pay rules, no compliance items, no asset history.
  'seed-datatruck-applicant-drivers.ts',
  // ADDED 2026-09-09, and by far the largest thing on this list: 14,451 loads
  // and $17.2M of freight. It writes Load, LoadStop, LoadAccessorial and the
  // Customer rows those loads need — and no pay rule, settlement, invoice or
  // payment, because none of that money moved through Zebra.
  //
  // IT RECONCILES BEFORE IT WRITES. The sum of what it would import must equal
  // the sum of the column it came from, to the cent, and the preview prints
  // both sides. It is batched and resumable by `externalId`: a run that dies
  // halfway is re-run with the same command.
  'seed-datatruck-loads.ts',
  // ADDED 2026-09-09. The all-trucks export: 113 units where the first held
  // 49. The extras arrive OUT_OF_SERVICE with no asset-history period — the
  // terminated-driver shape — and every truck gains compliance rows from the
  // registration, annual-inspection and insurance dates the first export never
  // carried. Where a unit exists already it adds missing values and replaces
  // nothing.
  'seed-datatruck-all-trucks.ts',
]

/**
 * ADDED 2026-10-01, from the ready-to-invoice rulings.
 *
 * `correct-direct-settled.ts` is the first script in this repository
 * AUTHORISED TO WRITE TO PRODUCTION — two rows, one boolean, by load number,
 * owner's ruling, with four named refusals and `--write` reserved to the owner.
 * Every other `--production` mode here is read-only, so it is on this list as
 * the exception rather than slipping in among the seeds.
 *
 * `breakdown-ready-to-invoice.ts` does NOT read this variable — it reads
 * `PROD_READONLY_DATABASE_URL` and refuses to fall back. It is on the list
 * because it NAMES the variable in its refusal message, and this fence matches
 * on the string. That is the fence being blunt in the safe direction, and the
 * entry is cheaper than wording the refusal around it: a message that cannot
 * say which variable is wrong is a worse message.
 */
const RULING_SCRIPTS = [
  'correct-direct-settled.ts',
  'breakdown-ready-to-invoice.ts',
]

const ALLOWED = [
  ...CHECK_READERS,
  ...DEPLOY_READERS,
  ...INSPECTION_READERS,
  ...MAINTENANCE_READERS,
  ...SEED_WRITERS,
  ...WALKTHROUGH_READERS,
  ...RULING_SCRIPTS,
]

/**
 * THE READ-ONLY PRODUCTION CREDENTIAL, FENCED THE SAME WAY.
 *
 * ── A SECOND VARIABLE THE FENCE COULD NOT SEE ───────────────────────────
 *
 * `PROD_READONLY_DATABASE_URL` was introduced on 2026-10-01 so the
 * ready-to-invoice breakdown could reach production through
 * `zebra_ci_readonly` without falling back to the owner string. It is a
 * production credential, and until this block existed NOTHING WATCHED IT: a
 * script could have connected to the production branch through it and the
 * fence above would have reported a clean allowlist.
 *
 * That is this file's own history repeating — it filtered on `.mjs` alone until
 * 2026-09-06, so a TypeScript script could read the production URL unseen, and
 * the gap was found only while writing the first one. Found the same way again:
 * by the guard failing on a change that introduced the hole.
 *
 * READ-ONLY IS NOT A REASON TO SKIP THE FENCE. The role cannot write, but it
 * carries BYPASSRLS — every tenant's rows, no boundary — so a script holding it
 * can read anything. The question the fence asks is "who can reach production",
 * and the answer has to include the credential that can see all of it.
 */
const READONLY_VARIABLE = 'PROD_READONLY_DATABASE_URL'

const READONLY_ALLOWED = [
  'breakdown-ready-to-invoice.ts',
  // ADDED 2026-10-04, deliberately, which is the whole point of this list.
  //
  // `audit-login-attempts.ts` counts login attempts by outcome and computes
  // whether the next attempt would be refused by the rate limit. The owner
  // reported a correct password refused on production and dev held no evidence
  // — one attempt, one success, zero failures — so the question can only be
  // answered where the attempts are.
  //
  // IT READS AND NOTHING ELSE: counts, two `findFirst`s and a session list. It
  // refuses any role that is not `zebra_ci_readonly` and has NO fallback to
  // another variable, because a fallback is how a read-only tool ends up
  // authenticated as the owner. The refusal was watched firing before the
  // script was committed.
  'audit-login-attempts.ts',
]

/** Every script, since scripts are where a production URL would be used. */
function sources(): { name: string; text: string }[] {
  const dir = join(process.cwd(), 'scripts')
  return (
    readdirSync(dir)
      // EVERY SCRIPT, NOT EVERY .mjs SCRIPT. This filtered on '.mjs' alone
      // until 2026-09-06, so a TypeScript script in this directory could read
      // the production URL and the fence would never have seen it. Nobody had
      // written one — the gap was found while writing the first, which is the
      // only reason it was found at all.
      .filter((name) => /\.(mjs|ts|mts|cts|js)$/.test(name))
      .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))
  )
}

describe('the production URL has exactly the readers it was given', () => {
  const readers = sources()
    .filter((file) => file.text.includes(VARIABLE))
    // This test names it constantly; it is not a reader of it.
    .map((file) => file.name)

  it('is read by the allowlist and by nothing else', () => {
    expect([...readers].sort()).toEqual([...ALLOWED].sort())
  })

  // THE READ-ONLY CREDENTIAL, THE SAME QUESTION. See `READONLY_VARIABLE`.
  it('and the read-only production credential has its own allowlist', () => {
    const roReaders = sources()
      .filter((file) => file.text.includes(READONLY_VARIABLE))
      .map((file) => file.name)
    expect([...roReaders].sort()).toEqual([...READONLY_ALLOWED].sort())
  })

  it('is never assigned into the variables the app connects with', () => {
    for (const file of sources()) {
      expect(
        file.text,
        `${file.name} assigns ${VARIABLE} into a connecting variable`,
      ).not.toMatch(
        new RegExp(
          `(DATABASE_URL|DIRECT_DATABASE_URL)\\s*=\\s*[^\\n]*${VARIABLE}`,
        ),
      )
      expect(file.text).not.toMatch(
        new RegExp(
          `process\\.env\\.(DIRECT_)?DATABASE_URL\\s*=\\s*[^\\n]*${VARIABLE}`,
        ),
      )
    }
  })

  // The stricter half of the rule. A walkthrough writes fixtures by design;
  // a script that runs unattended in `check` must never be able to.
  it('is only ever read by the scripts that run unattended or pass it on', () => {
    for (const name of [
      ...CHECK_READERS,
      ...DEPLOY_READERS,
      ...INSPECTION_READERS,
    ]) {
      const text = readFileSync(join(process.cwd(), 'scripts', name), 'utf8')
      // Anything that mutates. A count and a migration list need none of it.
      expect(
        text,
        `${name} writes through the production connection`,
      ).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i)
    }
  })
})

describe('the unrouted count, which only speaks when it should', () => {
  const script = join(process.cwd(), 'scripts', 'check-unrouted.mjs')

  const run = (env: Record<string, string | undefined>) =>
    execFileSync('node', [script], {
      encoding: 'utf8',
      env: { ...process.env, PROD_DIRECT_DATABASE_URL: undefined, ...env },
    })

  it('says nothing and exits 0 when no production URL is configured', () => {
    // `npm run check` must work on a plane.
    expect(run({}).trim()).toBe('')
  })

  it('says nothing and exits 0 when the database cannot be reached', () => {
    // An unreachable database is not this script's business to fail on.
    expect(
      run({
        PROD_DIRECT_DATABASE_URL:
          'postgresql://nobody:nothing@127.0.0.1:1/nowhere',
      }).trim(),
    ).toBe('')
  })

  it('is wired into check, and check still ends green when it shouts', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts.check).toContain('check:unrouted')
    // Informational: the script exits 0 on every path, including the loud one.
    const text = readFileSync(script, 'utf8')
    expect(text).not.toMatch(/process\.exit\([^0]/)
  })

  it('is silent at zero by construction, not by luck', () => {
    const text = readFileSync(script, 'utf8')
    // The printing lives inside a positive-count branch. A line that printed
    // "0 unrouted" every run would teach the eye to skip the week it said 3.
    const printed = text.indexOf('UNROUTED MESSAGE')
    const guard = text.indexOf('if (count > 0)')
    expect(guard).toBeGreaterThan(-1)
    expect(printed).toBeGreaterThan(guard)
  })
})

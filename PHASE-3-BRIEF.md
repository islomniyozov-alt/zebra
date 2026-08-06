> **Transcribed into the repository at Step 7, when Phase 3 closed.** This
> brief was pasted into a session and never written down, and by Step 7 its
> acceptance criteria had to be excavated from the session transcript to run
> against. A rule that lives only in a chat log cannot be cited in review, and
> a criterion that lives only in a chat log cannot be checked. The text below
> is the brief **as issued** — word for word, with only Prettier's markdown
> normalisation applied (table padding, and `_em_` for `*em*`), which changes
> no rendered character. **§9 records what has been flagged against it**, and
> **§10 records how each §7 box was closed**. Phase 2's discipline:
> contradictions get flagged, not silently resolved.

---

# ZEBRA — PHASE 3 BRIEF: THE MONEY

**Version 1** — 2026-08-03
**For:** Claude Code, working in `C:\Users\Daler\Downloads\zebra`
**Reads with:** `PHASE-1-BRIEF.md` (v2), `PHASE-2-BRIEF.md`, `TMS-DESIGN-SYSTEM.md`, `prisma/schema.prisma`, `UAT-CHECKLIST.md`. Phase 1's mechanisms and Phase 2's engine patterns remain binding: everything through `withCurrentOrg`, every write audited and attributed, every status change through one service function writing its event row.

Phase 3 is the finish-line gate: Part C of PARALLEL-RUN.md cannot complete without a full billing cycle through Zebra. It is also the phase where a wrong number costs real money and real trust. **Correct and auditable beats fast and clever, every step.**

---

## 0. Discipline

One step per session; stop and report; deploy both workers at every step boundary (rule 9); "I measured X" is pasted output (rule 10); negative checks are paired (rule 11); the whole suite runs every step (rule 12). The likeliest failure in this phase is not sprawl — it's a financial calculation that is _plausible_. Every money computation ships with a hand-checkable worked example in its tests.

## 1. Facts from the owner — build to these

- **Both carriers factor** their invoices (factor: Triumph — confirm name/terms per carrier in Step 4's setup screen; advance rate and fee live on the FactoringCompany record, editable).
- **Driver pay is mixed — it differs by driver.** The schema's versioned `DriverPayRule` (percent / per-mile / flat, effective-dated) is the mechanism; Step 6 builds the UI to set a rule per driver. No global pay setting anywhere.
- **Settlements run weekly.** Period boundary (e.g. Mon–Sun) is a `CompanySettings` field, not a constant.
- **Dispatchers never see money** (already enforced). Rates are entered by OWNER/ACCOUNTING — Step 1 makes that possible on a booked load.

## 2. Open decision — answer required before Step 3

**Amazon Relay freight (RAM) is not invoiced to a broker.** Relay pays through its own statements. These loads need a billing path that never generates an invoice: mark the load direct-settled, record the Relay payment against it, keep it out of "ready to invoice" and out of broker AR — while still counting in revenue and driver settlements. The brief assumes a `directSettled` marker on the load (customer-level default: the Amazon Relay "broker" record flags it) and a payment method for Relay statements. **Confirm with the owner how Relay money actually arrives (per-load? weekly statement?) before building Step 3.**

## 3. Decisions already made — do not reopen

1. **Counter allocation moves to last position** in every transaction that allocates (flag 20's fix). Mandatory now: invoice numbers share the counter path and month-end batching is a concurrency event.
2. **Settlement generation is short-read → compute in memory → short-write.** Never one long transaction across a pay period; the 5s ceiling and the 200ms/statement link are facts of life.
3. **A factored invoice is SOLD.** The factor collects; it leaves normal AR aging the moment it's factored and lives in its own view (advance received, fee, reserve outstanding). Mixing factored and direct in one aging number makes the screen lie.
4. **Pay rules and rates snapshot onto what they produced.** A settlement regenerated tomorrow shows the same numbers; a pay change applies forward only.
5. **Money is integer cents end to end.** Display formatting per design-system §8: mono, tabular, right-aligned, minus sign not parentheses.
6. **Billing status moves through the same engine pattern as operational status**: one service function, `LoadStatusEvent` rows on the BILLING axis, idempotent, refusals recorded.
7. **Invoice numbers are per-authority, forward-only, never reused** — same promise as load numbers.
8. **DISPATCHER payloads remain money-free** through every new screen. The scoped-dispatcher walkthrough (16 checks) must stay green after every step.

## 4. Scope

**In:** rate entry on loads; invoice generation + PDF; sending (with the honest constraint in §6); factoring records and factored-AR view; direct AR aging; payments + application across invoices; billing-status engine; weekly driver settlements with per-driver rules, deductions, reimbursements, settlement PDF; the permissions sweep (`invoice.*`, `settlement.*`, `payment.*`, `truck.financials`, `customer.financials`, `location.manage`).

**Out (unchanged):** expenses/fuel/IFTA/maintenance screens (Phase 4), reports/calendar/notifications (Phase 5), driver portal (Phase 6), integrations incl. factoring APIs and OCR (Phase 7), the wall board, and any self-serve billing for Zebra's own customers.

## 5. Order of work

| Step | Work                                                                                                                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Deploy-day-one; counter allocate-last refactor + concurrency test; permissions sweep; **rate entry** for OWNER/ACCOUNTING on a load (linehaul, fuel surcharge, accessorials — live totals); Smart Placement re-measure under this week's real traffic, output pasted |
| 2    | Invoice model + generation service: from one or many POD-received loads, per-authority numbering (allocated last), lines from load + billable accessorials, rate snapshot; `READY_TO_INVOICE` derivation (POD received ∧ rate > 0 ∧ not direct-settled); invoice PDF |
| 3    | Invoice screens: ready-queue, create (single + batch), preview, record-as-sent; **Relay/direct-settled path per §2's answer**                                                                                                                                        |
| 4    | Factoring: FactoringCompany setup per carrier; mark-factored (advance + fee recorded); factored view (reserve outstanding); direct AR aging (0-30/31-60/61-90/90+) that excludes factored                                                                            |
| 5    | Payments: record (check/ACH/wire/factoring advance/reserve/Relay), apply across invoices (PaymentApplication), unapplied balance as a real state; billing-status transitions wired end to end                                                                        |
| 6    | Settlements: per-driver pay-rule UI (effective-dated); weekly generation (short-read/compute/short-write) over POD-received loads in period; deduction + reimbursement lines; approve → settlement PDF → mark paid; rule + rate snapshots onto lines                 |
| 7    | Polish; the two money screens in RU/RTL; full acceptance run incl. the scoped-dispatcher walkthrough; deploy both; stop                                                                                                                                              |

## 6. Honest constraint — invoice delivery

Emailing invoices to brokers **cannot work yet**: the only working sender reaches the owner's inbox alone until a sending domain is verified (the parked domain decision). Step 3 therefore ships: generate → PDF → **download** (for manual email or factoring-portal upload) → record-as-sent with date and channel. The email-send button appears only when `RESEND_FROM` is on a verified domain — never a button that silently reaches nobody. If the owner registers the domain during this phase, the parked runbook block unlocks it in one sitting.

## 7. Acceptance criteria (excerpt — full list grows per step)

- [ ] 100 concurrent invoice creations: distinct contiguous numbers per authority, counter lock held ≤ 2 statements (measured)
- [ ] A worked invoice example in tests: loads + accessorials in, exact cents out, checked by hand in the test comment
- [ ] Factored invoice leaves direct aging the moment it's marked; reserve math shown
- [ ] One check applied across three invoices; partial payment leaves correct balances; unapplied remainder visible
- [ ] A weekly settlement for a mixed-rule driver reproduces byte-identical on regeneration; a pay-rule change after approval changes nothing retroactively
- [ ] Relay load never appears in ready-to-invoice or broker AR; its revenue appears in settlement and profitability
- [ ] DISPATCHER walkthrough still 16/16; ACCOUNTING sees all of it; scoped-user variant green
- [ ] Every money mutation audited with correct diffs; billing timeline shows source per event
- [ ] RU + RTL correct on invoice and settlement screens; no hex outside tokens; suite green; drift matches HEAD on both workers

## 8. Standing rules

All prior rules carry. New: **9-money** — every computed money figure on a screen must be reproducible from stored integers by a reader; no float ever touches a calculation; rounding is banker's-choice-documented, once, in one module.

---

## 9. Flagged against this brief

Recorded rather than resolved, per Phase 1's discipline.

1. **Rounding is half-up, not banker's.** §8 says "banker's-choice-documented,
   once, in one module". Half-up was chosen and documented in `src/lib/money.ts`
   with the reason: an invoice line is read by a broker's clerk with a
   calculator, and "0.5 always goes up" is the rule they will apply. Consistency
   with the person checking the number beats the third-decimal-place bias
   banker's rounding exists to avoid. One module, one rule, documented — which
   is what the standing rule actually asks for.
2. **The PDFs are English-only, and always will be with base-14 fonts.**
   §12's three locales live on the screen; the invoice and settlement documents
   are WinAnsi and cannot draw Cyrillic or Farsi. `winAnsi()` replaces what it
   cannot render with `?` rather than dropping it, so the failure is visible.
   Fixing it means embedding a font subset, which is a real piece of work and
   was not in scope.
3. **Neither PDF paginates.** One page, and the settlement says on the document
   how many lines did not fit rather than dropping them silently. An invoice
   covering more loads than fit is a real case and remains unhandled.
4. **Factoring had two homes and the schema still has three.**
   `factoringCompanyId` and `factoringFeeCents` sat on both `Load` and
   `Invoice`; Step 4 ruled the invoice the source and the load the carrier of
   its apportioned share, with `findFactoringDrift` under it. Separately,
   `Company.factoringFeeBps` exists as a profitability _assumption_ distinct
   from `FactoringCompany.feeBps`, the _negotiated_ rate. Defensible, but
   nothing in code says so and nothing stops them disagreeing. **Still owed** —
   it belongs with the profitability engine.
5. **`PaymentApplication` could not express the Relay path.** §2's answer needs
   a payment applied to LOADS with no invoice anywhere in it, and the schema's
   join table requires an invoice. Step 5 added `PaymentLoadApplication` as a
   second table rather than making the first one's columns nullable: a nullable
   pair admits a row pointing at neither, and Postgres treats NULLs as distinct
   in a unique index, so "one application per pair" would quietly stop holding.
6. **`PayRuleType.CUSTOM` and `DriverPayRule.expression` were a sandboxed
   language for pay.** Refused in Step 6, in words, at the engine and at the
   form; the column dropped in Step 7 (`20260806023129`). Paying a person by
   evaluating a string is a calculator nobody can review, a parser nobody
   wrote, and an injection surface on the one table whose output is somebody's
   wages. `CUSTOM` stays in the enum — dropping an enum member rewrites every
   row that ever held it — and the refusal lives in `src/lib/driver-pay.ts`.
7. **`Load` has no `deliveredAt`.** §5 step 6 needs "POD-received loads in
   period" and there is no date column to filter on. The settlement period is
   keyed on the POD **status event** instead, which is the fact rather than a
   cache of it, and avoids a fourth derived column needing a fourth drift
   check. A Delivered click arriving after the POD is refused as stale, so a
   period keyed on delivery would silently lose loads.
8. **`StatusAxis.BILLING` existed from the first migration and nothing wrote
   it.** §3.6 requires the billing axis to move through the same engine
   pattern as the operational one, with `LoadStatusEvent` rows. It did not
   until Step 7. It does now — `refreshBillingStatus` writes an event per
   change with the source that caused it — and until then the only answer to
   "when did this load become paid" was the column's current value.
9. **Profitability is out of scope but §7 names it.** The box reads "its
   revenue appears in settlement and profitability". The settlement half is
   proven; there is no profitability engine in Phase 3 and the schema's
   `estimatedProfitCents` is written by nothing. **Still owed**, in the phase
   that builds it.

---

## 10. How §7 closed

Each box, and where the evidence lives. Run `npm run check` and
`npm run test:integration` to reproduce.

| Box                                                         | Closed by                                                                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 100 concurrent invoice creations, lock ≤ 2 statements       | `tests/integration/counter-concurrency.test.ts` — 100 callers, distinct and contiguous; a Proxy over the transaction client measures **one** statement in the lock window |
| Worked invoice example, exact cents, by hand                | `tests/invoices.test.ts` — "a worked invoice, checked by hand"                                                                                                            |
| Factored invoice leaves aging; reserve math shown           | `tests/integration/factoring.test.ts` — "a factored invoice leaves aging and appears with its reserve"                                                                    |
| One check across three invoices; remainder visible          | `tests/integration/payments.test.ts` — "spreads ONE CHECK across three invoices"                                                                                          |
| Mixed-rule settlement byte-identical; no retroactive change | `tests/integration/settlements.test.ts` — "reproduces the PDF byte for byte after the rule changes"                                                                       |
| Relay load out of AR, in settlement                         | `tests/integration/settlements.test.ts` — "pays a Relay load in the settlement it never invoices"                                                                         |
| DISPATCHER 16/16; ACCOUNTING sees all; scoped green         | `scripts/verify-dispatcher.mjs` (16/16) and `scripts/verify-money-roles.mjs` (17/17)                                                                                      |
| Money mutations audited; billing timeline shows source      | `tests/integration/payments.test.ts` — the two `§7` tests                                                                                                                 |
| RU + RTL; no hex; suite green; drift matches HEAD           | `scripts/screenshots.mjs` (24 money shots), `npm run check`, `scripts/check-deploy-drift.mjs`                                                                             |

## 11. What Phase 4 inherits

- Flags 4 and 9 above: the third home for the factoring rate, and the
  profitability engine that would use it.
- Pagination for both PDFs (flag 3), and an embedded font subset if the
  documents are ever to carry a Cyrillic or Farsi name (flag 2).
- `CompanySettings` has a settlement period boundary field per §1; Step 6
  defaults the generate screen to the last full Monday–Sunday week and does
  not read that setting yet.

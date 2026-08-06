# ZEBRA — PHASE 4 BRIEF: FLEET & SAFETY

**Version 1** — 2026-08-06
**For:** Claude Code, working in the zebra repo
**Reads with:** the three closed briefs, `TMS-DESIGN-SYSTEM.md`, `prisma/schema.prisma`. All standing rules carry, including 9-money (maintenance costs are money) and the migrate-before-deploy ritual (the owner runs it; the guard enforces it).

> Transcribed into the repository at Step 1, per the rule Phase 3 earned the
> hard way: a brief that lives only in a chat log cannot be cited in review and
> its acceptance criteria cannot be checked. The text is the brief **as
> issued**; **§6 records what has been flagged against it**, in the Phase 1
> style — contradictions get flagged, not silently resolved.

This phase is the owner's home turf: he runs a DOT-compliance business. Where this brief is silent, the question is "what would AR Safety Support tell a carrier to keep?" — and if the answer isn't obvious, stop and ask rather than invent.

Phase 4 does not gate the finish line. It builds alongside the parallel run, exactly as Phase 3 did.

---

## 1. Facts from the owner — build to these

- **Expirations tracked:** annual DOT inspections (trucks _and_ trailers), registrations, insurance, driver CDL, driver medical card. Drug & alcohol program dates were deliberately **not** selected — leave the type enum extensible, build no screen for it.
- **Maintenance is full-depth:** repairs and work orders with **costs and receipts**, not just dates. Costs are integer cents through `money.ts`.
- **Claims cover accident + cargo + DataQs challenges.** A DataQs challenge is its own record tied to a roadside inspection/violation, with a status and an outcome — not a note on a claim.

## 2. Decisions made — do not reopen

1. **Compliance records are history, never overwrite.** A renewed registration is a new record superseding the old; the expired one stays. Same snapshot philosophy as pay rules.
2. **One generic shape:** `ComplianceRecord` — subject (truck | trailer | driver), type, issued/expires, document, notes. Status (current / expiring / expired) is **derived from the date at read time**, never stored — a stored status is a cache that goes stale at midnight.
3. **"Expiring soon" horizon** comes from the `CompanySettings` notification lead-time fields that have existed since Phase 1 with nothing reading them. The dashboard queue is the notification mechanism for now; the real notifications engine stays Phase 5.
4. **An expired truck/driver warns at dispatch, doesn't block.** The assignment flow surfaces the expiry in words next to the confirm; the dispatcher proceeds if the business says so. Refusing outright turns a paperwork lag into a stranded load; the audit row records that the warning was shown.
5. **Roles:** compliance dates are operational — DISPATCHER reads them (they gate real dispatch decisions). Maintenance **costs** are financial — gated like other money. Claims and DataQs: OWNER/ADMIN/MANAGER write, ACCOUNTING reads. The scoped-dispatcher walkthrough grows the matching assertions.
6. **Expenses, Fuel, IFTA move to Phase 5.** The nav's `returnsIn` for those entries updates in Step 1. This phase is fleet & safety, not the spend ledger — maintenance costs land here because they attach to work orders, but the general expense screens do not.
7. Documents and Settings — the two "in no brief" screens — **are hereby assigned to this phase** (Step 6).

## 3. Order of work

| Step | Work                                                                                                                                                                                                                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Deploy-day-one; migrations for `ComplianceRecord`; the compliance service + derived-status logic; `/safety` queue screen (expiring/expired, filterable by subject and type); dashboard gains the expiring-compliance row (role-filtered, lead-time horizon); nav `returnsIn` updates               |
| 2    | Compliance panels on truck, trailer, and driver detail screens — records listed newest-first, add-renewal flow (document upload via the existing pipeline), superseded history visible                                                                                                             |
| 3    | Maintenance: work orders per asset (date, odometer, vendor, category, cost cents, receipts); asset maintenance history with running totals; `/maintenance` list across the fleet; costs role-gated                                                                                                 |
| 4    | Roadside inspections: record per event (date, level, state, truck/driver/trailer, violations with codes, OOS flags, document); inspection history on asset and driver screens                                                                                                                      |
| 5    | Claims (accident/cargo: status ladder, optional load link, parties, notes timeline, documents) + DataQs challenges (tied to inspection/violation, status, outcome); `/safety/claims`                                                                                                               |
| 6    | Settings screen (per-authority `CompanySettings` editable — invoice prefix/terms/notes, lead times, and the settlement period-boundary field Phase 3 §11 left unread) + Documents browser (org-wide, filter by type/entity/date, permission-aware — the pipeline exists, this is the reading room) |
| 7    | Polish + acceptance: RU/RTL on the new screens with screenshots, dispatcher walkthrough grown and green, worked examples for any money math, drift matching HEAD on both workers                                                                                                                   |

## 4. Acceptance excerpt

- [ ] A truck with an expiring annual inspection appears in the queue exactly `leadTime` days out, and in the dashboard row, and on its own detail panel — all three from one derivation
- [ ] Renewing a registration leaves the old record visible as superseded; nothing overwritten
- [ ] Assigning a truck with expired insurance shows the warning in words and proceeds only on confirm; the audit row shows the warning was displayed
- [ ] A work order's cost appears in the asset's running total; a DISPATCHER sees the work order and not the cost
- [ ] A DataQs challenge traces: inspection → violation → challenge → outcome
- [ ] Settings edits are audited with field-level diffs; the settlement period boundary is finally read by Step 6 of Phase 3's code
- [ ] Documents browser shows only what the role may see; a scoped dispatcher sees their authorities' documents alone
- [ ] Dispatcher walkthrough green with its new assertions; RU/RTL screenshots; drift clean

## 5. Inherited and deferred

Inherited from Phase 3 §11 and landed here: the `CompanySettings` period-boundary field (Step 6). Explicitly deferred to Phase 5 with reason: PDF pagination and font embedding (no real invoice has overflowed a page yet — the friction log will say when), the notifications engine, Expenses/Fuel/IFTA, Reports, Calendar.

---

## 6. Flagged against this brief

Recorded rather than resolved, per Phase 1's discipline.

1. **`ComplianceRecord` already exists, under another name, and no migration is
   needed.** §3 step 1 asks for "migrations for `ComplianceRecord`". The schema
   has carried `ComplianceItem` since the init migration, and it is already the
   generic shape §2.2 describes: a subject (`truckId` / `trailerId` /
   `driverId`, all nullable), a `type`, `issuedAt` / `expiresAt`, `notes`,
   soft delete, a `Document[]` relation, and indexes on
   `[companyId, expiresAt]` and `[companyId, type, expiresAt]`. It carries
   `identifier` and `issuer` besides — policy number, insurer — which the brief
   does not ask for and which are obviously worth keeping.

   Per the standing rule the schema wins and the contradiction is flagged:
   Step 1 builds on `ComplianceItem` and adds **no table**. A second model
   holding the same facts is the shape that produced the authority drift check
   in Phase 2, and it would arrive with none of the RLS, the trigger or the
   document wiring this one already has.

2. **The `CompanySettings` settlement period-boundary field does NOT exist, and
   Phase 3 §11 was wrong to say it did.** §5 here inherits it as though it were
   waiting to be read. It is not: `CompanySettings` carries the invoice fields,
   the profitability assumptions and three notification lead-times, and nothing
   resembling a week boundary. Phase 3 step 6 defaulted the settlement screen to
   the last full Monday–Sunday week in code, and my own §11 note then described
   the missing field as merely unread.

   So Step 6 needs a **migration**, not just a screen. Recorded here rather than
   discovered five steps from now.

3. **`DRUG_TEST` is already in the enum.** §1 says drug & alcohol dates were not
   selected and asks that the enum stay extensible. `ComplianceType` already
   carries `DRUG_TEST` and `MVR` alongside the six the owner named. Nothing to
   do — no screen is built for them — but the enum does not need widening and a
   future step should not read their absence from the UI as absence from the
   data model.

4. **Supersession is derived, not stored.** §2.1 requires a renewed record to
   supersede the old one with nothing overwritten. `ComplianceItem` has no
   `supersededById`, and does not need one: for a given subject and type, the
   record with the latest `expiresAt` is current and the rest are superseded.
   That is the same reasoning §2.2 gives for not storing the status — a stored
   pointer is a second copy of a fact the dates already carry, and it is one
   more thing to keep true. If a carrier ever needs to record that a specific
   record replaced a specific other one, that is a real column and a real
   decision, not an inference.

5. **ACCOUNTING cannot read compliance, and §2.5 does not say whether it
   should.** The role list assigns compliance dates to the DISPATCHER as
   operational, puts maintenance costs behind the money gate, and gives
   ACCOUNTING read on claims and DataQs. It is silent on ACCOUNTING and
   compliance dates.

   The permission model already answers it, and the answer is no:
   `compliance:read` rides in `FLEET_READ`, which ACCOUNTING does not hold — it
   is granted `truck:read` and `driver:read` by name instead. So the dashboard
   compliance row and `/safety` are both absent for ACCOUNTING today.

   Left as the model has it, asserted in `tests/dashboard.test.ts`, and raised
   rather than resolved: granting a role a new permission because a test I
   wrote expected it would be inventing an answer to a question the brief did
   not ask. **A one-line change if the owner says accounting should see expiry
   dates** — they do touch insurance certificates at billing and factoring
   time, which is the argument for yes.

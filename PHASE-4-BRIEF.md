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

5. ~~**ACCOUNTING cannot read compliance, and §2.5 does not say whether it
   should.**~~ **Resolved by the owner at the start of Step 2.** ACCOUNTING now
   holds `compliance:read` and nothing more: it handles insurance certificates
   at billing and factoring time, so it sees an expiry date, while renewing one
   stays a safety act behind `FLEET_WRITE`. Asserted as a PAIR in
   `tests/dashboard.test.ts` — reading granted, create/update/delete refused —
   because asserting only the first half would let a later `crud('compliance')`
   slip in unnoticed.

   Original text: §2.5 assigns compliance dates to the DISPATCHER as
   operational, puts maintenance costs behind the money gate, and gives
   ACCOUNTING read on claims and DataQs. It was silent on ACCOUNTING and
   compliance dates, and the permission model's answer was no — `compliance:read`
   rode in `FLEET_READ`, which ACCOUNTING does not hold.

6. **`MaintenanceRecord` already exists too, and Step 3 needed no migration.**
   The same finding as flag 1, one step later. §3 step 3 asks for work orders
   "per asset (date, odometer, vendor, category, cost cents…, receipts via the
   pipeline)" and the schema has carried every one of those since the init
   migration: `servicedAt`, `odometer`, `vendorName`, `category`
   (`MaintenanceCategory`, twelve members), `description`, `costCents`,
   `notes`, soft delete, a `Document[]` relation, and indexes on
   `[companyId, servicedAt]`, `[companyId, truckId, servicedAt]` and
   `[companyId, nextServiceDate]`.

   It carries two fields the brief does not ask for — `nextServiceOdometer` and
   `nextServiceDate` — which are the beginning of a PM-due queue. Step 3 stores
   and displays both and builds no queue on them; that is a Phase 5 screen if
   the owner wants one.

   **Two rules held while building on it.** `MaintenanceRecord.truckId` and
   `trailerId` are both nullable, so a row can hang off nothing — such a row is
   dropped from every view rather than rendered against a dash, the same call
   the compliance panel makes. And the cost gate is a **resource, not a
   column check**: see flag 7.

7. **Maintenance costs are gated on `truck.financials`.** ~~And ACCOUNTING holds
   that resource without holding `maintenance:read`.~~ **The asymmetry was
   resolved by the owner at the start of Step 4: ACCOUNTING now holds
   `maintenance:read` and nothing more** — it reconciles the shop's invoice
   against what was recorded, while opening a work order stays a shop act
   behind `FLEET_WRITE`. Asserted as a pair in `tests/permissions.test.ts`:
   read granted, create/update/delete refused.

   The resource choice itself stands. §2.5 says a DISPATCHER
   "sees the work order and not the cost" and does not name the resource. There
   was no `maintenance.cost` resource and there is now no need for one:
   `truck.financials` was introduced in Phase 3's sweep for exactly this shape —
   money that appears on a FLEET screen rather than a money screen — and is held
   by OWNER, ADMIN, MANAGER and ACCOUNTING and not by DISPATCHER, which is the
   split §2.5 describes. Step 3 reuses it. If maintenance spend ever needs a
   different audience from a truck's purchase price, that is a one-line split
   and the call sites are the three named in `tests/permissions.test.ts`.

   Original text of the asymmetry: **ACCOUNTING can read `truck.financials` and
   cannot read `maintenance`**, so `/maintenance` 404s for the one role most
   likely to be reconciling a shop invoice. The parallel is flag 5 — compliance
   had the same shape and was resolved by an explicit ruling, not by a step
   quietly widening a role.

8. **Step 4 is the first step in this phase that actually needed a migration —
   and it needed two tables, not one.** Flags 1 and 6 found `ComplianceItem`
   and `MaintenanceRecord` already waiting. There is no inspection table
   anywhere in the schema, and `Document` had no column to hang a report off.
   `20260807144838_roadside_inspections` creates `RoadsideInspection` and
   `InspectionViolation`, adds `Document.inspectionId`, and carries by hand the
   three things Prisma cannot express:
   - RLS **enabled, forced and policied** on both tables;
   - a `set_org` trigger deriving `InspectionViolation.organizationId` from its
     inspection — the table has no `companyId` of its own, and a child row is
     exactly where a cross-tenant write is invisible because the child looks
     valid alone;
   - a CHECK constraint, `inspection_has_a_subject`, refusing a row that names
     no truck, trailer or driver. All three columns are nullable because a
     Level III has no truck and a Level V has no driver, so no NOT NULL can say
     "at least one". `tests/structure.test.ts` asserts the constraint exists,
     and the integration suite proves it fires by going around the service.

9. **Two facts on an inspection are derived, and one decision follows from
   §2.2 rather than from anything §3 says.** "OOS flags" (§3 step 4) are stored
   **per violation**, because that is where the officer writes them and because
   a DataQs challenge (step 5) has to name the violation it is challenging. The
   inspection's own out-of-service state, and whether it was **clean**, are read
   off the violations at read time — the same argument §2.2 makes for compliance
   status. Withdrawing a mistyped violation therefore makes an inspection clean
   again, which a stored flag would have got wrong.

   Related, and stated so step 5 does not have to rediscover it: **withdrawing
   is for a typo only.** A violation the carrier challenges and wins keeps its
   row; the outcome is recorded on the challenge, so the history still shows
   what was written and what became of it.

10. **`inspection` is its own permission resource.** §2.5 names roles for
    compliance, maintenance costs, claims and DataQs, and is silent on
    inspections. Reusing `compliance` would weld "who may record an inspection"
    to "who may renew a registration"; the new resource sits in `FLEET_READ`
    and `FLEET_WRITE`, so a DISPATCHER reads (an out-of-service driver is a
    dispatch fact) and does not write. ACCOUNTING gets **read**, and that one is
    read off the brief rather than invented: §2.5 gives ACCOUNTING read on
    claims and DataQs, and §1 says a DataQs challenge is tied to a roadside
    inspection — read on the challenge without read on what it challenges is a
    screen with a hole in it.

11. **A migration's recorded checksum had drifted from the file on disk, and
    `prisma migrate dev` refused to run until it was fixed.**
    `20260806023129_drop_pay_rule_expression` was applied on 6 August and its
    SQL comments were then rewritten in the Step 7 polish commit — the content
    changed after it was applied, which Prisma detects and which would have
    offered to reset the development database.

    The dev branch's `_prisma_migrations.checksum` was realigned to the file
    (the SQL itself is unchanged; only comments differ). **Production has the
    same drift and `prisma migrate deploy` validates checksums too**, so the
    production ritual for Step 4 needs this first:

    ```sql
    UPDATE _prisma_migrations
       SET checksum = '9e72473ecbb5ce35fb128bf86d0523fc77f861998b5a6a405b5ce83c1e405c11'
     WHERE migration_name = '20260806023129_drop_pay_rule_expression';
    ```

    The rule this earns: **an applied migration file is closed to edits,
    including its comments.** A prose pass that sweeps the repository must skip
    `prisma/migrations`.

12. **Step 5 needed a migration too, and three tables rather than the one the
    brief implies.** `Claim` has existed since the init migration with the type,
    the status ladder's enum, the amounts and an optional load link. What §3
    step 5 asks for beyond that does not exist anywhere:
    - **parties** (plural) — `Claim.claimantName` is one string.
      `ClaimParty` adds the roll: claimant, insurer, adjuster, attorney, other
      carrier, witness — each with **their** reference number, which is never
      ours and is the field people copy off a letter.
    - **notes timeline** — no note table at all. `ClaimNote` is append-only and
      carries BOTH a typed note and a status change, because they are one story
      to whoever reads the history. It has no `deletedAt` on purpose: a timeline
      somebody can quietly revise is not an audit answer.
    - **DataQs challenges** — `DataQsChallenge`, hanging off the inspection per
      §1 and not off the claim.

    `20260807182143_claims_and_dataqs` carries the usual hand-written tail: RLS
    on all three, a `set_org` trigger deriving `organizationId` from the claim
    for the two child tables, and two constraints Prisma cannot express — see
    flag 13.

13. **Two rules that live in Postgres because they are relationships, not
    fields.**
    - `dataqs_violation_matches` (trigger): a challenge that names a violation
      must name one belonging to the inspection it names. Two foreign keys
      cannot say this between them, and it is the one way §4's trace
      (inspection → violation → challenge → outcome) could silently lead to a
      different truck.
    - `dataqs_outcome_matches_status` (CHECK): a challenge is CLOSED exactly
      when it has an outcome. Status is where the filing is; outcome is what
      came of it. Without the pairing, "closed" would mean won and lost at the
      same time.

    Both are asserted in `tests/structure.test.ts` and proved to fire in the
    integration suite by going around the service.

14. **A claim's ladder is a TABLE, not a rank — and CLOSED is terminal.** The
    load engine ranks its statuses and refuses backwards moves; a claim
    genuinely goes backwards, because DENIED → DISPUTED is an appeal and is the
    most common move a claims desk makes. So `CLAIM_LADDER` is written out, and
    the screens build their selects from the same table the service enforces —
    a control that offers a move the service refuses teaches people the screen
    is guessing.

    The one hard edge: **a claim that comes back after closing is a new claim.**
    Reopening would destroy the meaning of the closing date on every report
    already run. Recorded here because it is a business rule invented in this
    step, not one the brief states.

15. **`Claim` has no truck or driver link, and Step 5 did not add one.** An
    accident claim involves a tractor and a person, and the schema reaches them
    only through the optional load — which a bobtail accident does not have.
    §3 step 5 asks for "optional load link, parties" and nothing more, so
    nothing more was built. If the owner wants an accident filed against a unit
    directly, that is two nullable columns and a screen change, and it belongs
    to whoever asks for it rather than to a step that guessed.

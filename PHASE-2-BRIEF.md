# ZEBRA — PHASE 2 BRIEF

**Version 1** — 2026-07-30
**Reads with:** `PHASE-1-BRIEF.md` (v2.1), `TMS-DESIGN-SYSTEM.md`, `prisma/schema.prisma`. Read all three before writing anything. Phase 1's mechanism sections (§6–§10) remain binding — nothing in this phase reaches past `withCurrentOrg`, and every write is audited and attributed.

> Transcribed into the repository at Step 2, because §14's standing rules are cited in review and a rule that lives only in a chat log cannot be. The text is the brief as issued; **§16 records what has been flagged against it since**, in the Phase 1 style: contradictions get flagged, not silently resolved.

---

## 0. How to use this brief

Work §5 in order, one step per session, stop and report between steps. Same discipline as Phase 1: the likeliest failure is not bad code but sprawl — this phase borders Money (Phase 3) and the driver portal (Phase 6), and both borders are hard.

Where this brief and the repo disagree, the repo wins for Phase 1's mechanisms and this brief wins for Phase 2's scope.

---

## 1. What Phase 2 ships

At the end of this phase, a dispatcher can: create a broker, truck, trailer, and driver; create a load under a specific authority in under forty seconds; assign equipment; watch the load advance to POD received with almost no manual status work; attach documents from Step 6's pipeline; and see it all on a dispatch board.

**Not one pixel of Money.** Loads carry their financial fields, but invoices, payments, AR, settlements, and every money _screen_ are Phase 3. `load.financials` stays denied to `DISPATCHER` — and this phase finally makes that provable by URL.

---

## 2. Decisions already made — do not reopen

1. **Reference data is in scope.** Loads are unbuildable without it. It lands first, as thin CRUD.
2. **The wall-display dispatch board is out of scope.** The existing Workers board (small-math-403c) keeps running untouched.
3. **Multi-stop in the data, single-stop in the UI.** Every load writes `LoadStop` rows. No "add stop" control this phase — but nothing about the storage may assume two.
4. **Dispatchers work across authorities in one session.** Authority is the FIRST field of Create Load, keyed on MC, displayed by carrier name, defaulting to last-used. The topbar company control is a filter, never a mode.
5. **Statuses are minimal and mostly automatic** (§7). The schema's nine operational states remain valid storage; the UI exposes four.

---

## 3. In scope

1. Day-one deploy + carried security items (§6)
2. Brokers (Customer), Trucks, Trailers, Drivers — CRUD screens + AssetAssignment transfer UI
3. Load model service layer: create, edit, cancel, numbering, stop writes, status engine
4. Create Load flow — the hot path, forty-second target
5. Load detail screen: stops, status timeline, documents, communication-log notes
6. Dispatch board — Zebra's own
7. Loads table: real rows, saved views, filter chips, URL-serialized state
8. Password-reset email transport (Resend)
9. Exercising the built-but-unused: `KpiCard`, `Modal`, density persistence per user (§5.1 — a preference store, not a local-state toggle)

## 4. Explicitly out of scope

Invoices, payments, AR, settlements, expenses, fuel, IFTA, maintenance screens, reports, calendar, notifications beyond the schema table, driver portal, ELD/GPS, rate-con OCR, the wall board, multi-stop UI, load board integrations. If a placeholder feels necessary, leave the route absent.

---

## 5. Order of work

| Step | Work                                                                                | Status    |
| ---- | ----------------------------------------------------------------------------------- | --------- |
| 1    | **Deploy first** (§6): stub deploy, live check, then argon2id migration + rotations | `f632bbb` |
| 2    | Brokers, Trucks, Trailers, Drivers CRUD + AssetAssignment transfers                 | this step |
| 3    | Load service layer: create/edit/cancel, counters, stops, status engine (§7), §8     | this step |
| 4    | Create Load screen (§9)                                                             | this step |
| 5    | Load detail: status timeline, documents UI (§10), notes                             | this step |
| 6    | Dispatch board (§11) + Loads table upgrades                                         | this step |
| 7    | Reset email, density persistence, polish, full acceptance run, deploy               | this step |

**Deploy on day one and after every step.** Every Phase 1 blocker lived in the local-vs-workerd seam. `npm run deploy:dev` + live check is part of each step's definition of done — and `npm run check:drift` says whether production is carrying it too, because a deploy to the worker without freight on it is not a deploy.

---

## 6. Step 1 — security debts that must precede new users

- Replace PBKDF2 with argon2id, verified on the deployed worker. Rolling upgrade via `needsRehash`.
- Rotate the `zebra_app` password and both R2 key pairs.
- Owner changes their own password through the UI.
- Wire `onAuditEvent` to a durable sink if trivially available; otherwise confirm it stays on the owed-before-production list.

## 7. The status engine — minimal, mostly automatic

```
Booked ──(assign truck+driver)──▶ Dispatched ──(manual, one click)──▶ Delivered ──(POD doc confirmed)──▶ POD received
```

- **Booked** — the state a load is created in.
- **Dispatched** — automatic on assignment; reverts automatically if the assignment is removed before any later state.
- **Delivered** — the one manual click.
- **POD received** — automatic when a confirmed `Document` of type `POD` attaches. Never manually.
- **Cancelled** — the orthogonal flag, with reason, via a `Modal`. Cancelling never deletes anything.

All transitions go through one service function that writes the `LoadStatusEvent` row. Billing axis untouched: every load sits at `UNINVOICED` until Phase 3.

## 8. Dispatch conflict rules

On assignment, refuse (in the design system's written-error voice, naming the conflicting load number):

- a truck or driver already assigned to another load whose stop window overlaps;
- a truck or driver whose current `AssetAssignment` places them under a _different authority_ than the load's — offer the transfer flow, never silently move the asset;
- a driver or truck marked out of service / inactive.

The DB already enforces one open AssetAssignment per asset; these checks are the human-readable layer above it.

## 9. Create Load — the forty-second target

Design-system §7.6 is the spec. Tab order = authority → broker → truck → driver → pickup → delivery → dates → miles → rate → rate-con upload → save; `Ctrl+Enter` saves from anywhere; typeahead with create-on-miss; live computed line under the rate field, visible only to roles holding `load.financials`.

Rate-con upload uses Step 6's pipeline: compress → hash → mint → PUT, with "Preparing…" and "Uploading…" visibly distinct, and the load save never blocked by a still-uploading document.

**Time it.** A repeat load, keyboard only, under forty seconds, or the form is wrong. Report the measurement as output, not as a claim.

## 10. Load detail

Status stripe per §2; two badges; stop panels with per-stop local timezones and zone abbreviations (rule 3); document slots grouped by type with dashed warning placeholders for missing-required; a notes thread writing `Communication` rows; the status timeline rendered from `LoadStatusEvent`.

## 11. Dispatch board

Rows = trucks (with current driver), columns = days, cells = loads positioned by stop windows, coloured by the status stripe rules. Unassigned loads in a leading rail; assignment from the board obeys §8. `KpiCard`s across the top. Company filter applies. Drag-and-drop is optional polish — click-to-assign must work first and remain the keyboard path.

## 12. Seed additions

Real reference data only. No fake loads, no demo brokers. Test rows for screenshots are created through the UI and deleted, or live only in test fixtures.

## 13. Acceptance criteria

- [x] Deploy + live check passed at every step boundary (version IDs listed in each report)
- [x] argon2id live: new hash verifies on the deployed worker; owner re-hashed on login
- [x] A broker, truck, trailer, driver each created, edited, soft-deleted through the UI
- [x] Asset transfer between authorities writes a closed period + a new open one; double-open refused and surfaced politely
- [x] Load created keyboard-only in under 40 s — **6.4 s**, measured, output in the Step 4 report
- [x] Load numbers per-authority, contiguous under concurrency — six simultaneous bookings, `RAM Haulage: 1010,1011,1012 | Dolphins Transport: 1070,1071,1072`
- [x] Assignment sets Dispatched automatically; unassignment reverts it; POD confirm sets POD received; Delivered is one click — `verify-board` 13/13 and `verify-pod` 10/10. The revert is covered by `statusForAssignment`'s tests and by the engine, not by a deployed click: nothing in the interface unassigns a load yet
- [x] Conflict rules §8 each demonstrated with the refusal message — overlap, other authority and out of service, each read off the deployed screen, each paired with the same booking succeeding once the reason is removed
- [x] Rate-con uploaded during create; POD attached from detail; both visible in R2 and audited — `verify-pod` uploads a POD from the detail screen and reads it back; every load written in the acceptance run left an audit row
- [x] `DISPATCHER` session: financial fields absent from every payload, and a financial route by URL → denied — `verify-dispatcher` 7/7. Read the caveat in flag 5: fleet money is OMITTED from the payload rather than gated, so it is absent for an owner too
- [x] Status timeline shows correct source (MANUAL vs AUTOMATIC) per event — and the engine's own notes are message keys now, so a Russian timeline reads Russian
- [x] Dispatch board renders both carriers' fleets; company filter narrows it — a truck created under each authority through the interface, both rows on the board, `?company=` narrows to one
- [x] Density preference persists across sessions per user — stored as a `UserPreference` row, still Compact after a fresh login in a browser sharing no storage, and the rows measure 32px against Standard's 39px
- [ ] Reset email delivers via Resend on the deployed worker — **the transport is built, tested and deployed; the API key is not set.** See flag 18
- [x] All screens correct in RU and `dir="rtl"`; hex check still 28-in-one-block; no `any`; all tests green

## 14. Standing rules

Phase 1 §14 carries forward unchanged, plus:

9. **Deploy on day one of the phase and at every step boundary.** The local-vs-workerd seam is where this project's bugs live.
10. **"I measured X" is shown, not summarized.** Paste the output. The PBKDF2 claim was confidently wrong once; measurement claims get the same skepticism as "it works."
11. **Every step runs the ENTIRE test suite, not the suites the step touched.** _(Added Step 5, numbered 12 in the issuing message; kept in sequence here.)_ A test red for two steps is a fact nobody knows. The incident: `tests/integration/audit.test.ts` broke in Step 2 and was not noticed until Step 4, because Steps 2 and 3 each ran only the suites they had just written. `npm run check` is not sufficient on its own — it deliberately excludes the integration project — so a step is not done until `npm run check` AND `vitest run --project integration` have both passed.
12. **A negative check proves nothing unless the same request succeeds with the gate removed.** _(Added Step 2.)_ `expect(...).rejects` and a 401 both pass for the wrong reasons — a malformed request, an absent route, a typo in the test, a worker that is simply down. Pair every refusal with the identical call made after removing the single thing that caused the refusal. The incident: the Step 1 live check asserted "the API refuses an anonymous caller" and got a 405 (wrong method) and then a 400 (bad body). Both passed. Neither touched the auth gate.

## 15. Definition of done, per step

Migration/diff, test output, screenshots for anything visual (1080p Standard, plus RU and RTL where layout is new), deploy version IDs, and anything wrong in this brief, the schema, or the design system — flagged, not silently changed. Then stop.

---

## 16. Flagged against this brief

Recorded rather than resolved, per §0 and Phase 1's discipline.

1. **§6's `hash-wasm` prescription is wrong.** It calls `WebAssembly.compile` at runtime and workerd refuses (`Wasm code generation disallowed by embedder`) — the same refusal that forced a second Prisma client in Phase 1. Step 1 shipped argon2id via `@noble/hashes`, pure JS. Verified before substituting, not after.
2. **§6's R2 rotation could not be done from here.** Creating an S3-compatible token is an account-level act and `wrangler login`'s OAuth token is refused for it. Steps are in the README. **Still owed.**
3. ~~**The schema's fleet unique index and its soft delete disagree.**~~ **Resolved in Step 3.** `truck_unit_per_company` and `trailer_unit_per_company` carry `WHERE "deletedAt" IS NULL` (migration `20260731003653`), so a removed truck no longer holds its number. The `@@unique` is gone from the schema and replaced by a plain `@@index` plus a comment saying not to restore it. Deliberately NOT done for `Load`: load numbers come from a counter, are never reused, and a cancelled load keeps its number reserved forever.
4. ~~**`Truck.companyId` and the open `AssetAssignment` are two representations of one fact.**~~ **Guarded in Step 3**, though the schema still cannot express it. Three layers: `transferAsset` moved into `src/lib/asset-transfer.ts`; ESLint bans `update({ data: { companyId } })` everywhere but that file; and `findAuthorityDrift` asks the database the same question and must return zero rows, in `npm run check`. Each layer has a test that watches it fire.
5. **No permission resource covers fleet money.** _Re-confirmed in Step 7 by `verify-dispatcher`, which asserts the absence for a DISPATCHER **and** for an OWNER — because the fields are omitted from the payload, not gated. The check says so in its own output rather than letting anyone read it as proof of a permission that does not exist._ `Truck.purchasePriceCents` and `Customer.creditLimitCents` are money on screens a `DISPATCHER` can read, and there is no `truck.financials` to gate them with. Both are omitted from every payload for now. Phase 3 should either add the resource or move the fields.
6. **Smart Placement produced no measurable change** — see the Step 2 report. Enabled, deployed, measured, unchanged. Left on, but unproven.
7. **The audit extension costs four statements per write, and that is what the 5 s transaction ceiling actually buys.** Every audited write is `SAVEPOINT … write … audit insert … RELEASE` (Phase 1 §8). Booking a load with a truck and driver sends ~31 statements: 6 reads, 1 raw counter increment, and 24 for six audited writes. At a **measured 200 ms per round trip** from a laptop here to Neon in us-east-2 that is ~6.2 s, and Prisma's default aborts at 5. `LOAD_WRITE_TIMEOUT_MS` raises it for load writes, with the arithmetic recorded on the constant. Everything cheap was cut first — `createMany` for stops, batched conflict queries, no trailing re-read. **The deployed cost is unmeasured**, because Step 3 ships no route that creates a load; Step 4 must measure it against the worker and report the number.
8. **`<input type="date">` is the wrong control for a keyboard-first form**, and only the timed run said so. It holds three internal segments and Tab moves between them, so §9's single "dates" step cost six tab stops — every keystroke after the pickup date landed in the wrong field and the load saved with a delivery date in the year 1. §8 then refused every subsequent load as overlapping, because a load with no usable window overlaps everything. Replaced with text fields and `normalizeTypedDate`, which takes `810`, `8/10`, `08/10/26` and `2026-08-10`. Repeat-load time went from **not saving at all** to **6.4 s**. This is what §9 means by "time it, or the form is wrong".
9. **Buffered audit writes, per the Step 4 instruction.** The audit extension's four-statements-per-write was costing a load save 9.4 s of wall clock against 260 ms of CPU. Rows now accumulate in the scope and flush once, before commit, as a single multi-row insert behind a single savepoint. What did not change: the rows still ride the caller's transaction, still sit behind a savepoint, and a failure is still loud and countable. Save round trip **9.4 s → 6.4 s**.
10. **`LoadStatusEvent` gained an `outcome` column** (`APPLIED` / `REFUSED_STALE`), migration `20260731145835`. A refused transition was previously returned to the caller and written nowhere, so "show stale-transition attempts" had nothing to show. They are recorded now, and anything reconstructing a load's real history filters to `APPLIED`.
11. ~~**A stop has no timezone of its own.**~~ **Resolved in Step 6.** `Location.timezone` (IANA, nullable) landed in migration `20260731165122`, backfilled from state for the 45 states and provinces that have exactly one zone and left NULL for the thirteen that do not. `resolveLocation` sets it at create-on-miss by the same rule, `resolveZone` gives an explicit zone precedence over the derivation, and the load screen lets a dispatcher set or clear it where the guess is admitted. What is stored is a fact; what is derived still says so on screen.
12. **A date typed with no time was stored at UTC midnight and rendered a day early.** A pickup typed as September 15th displayed as "Sep 14, 19:00 CDT" — rule 3's own failure mode, committed by the code written to honour it, and caught in a screenshot rather than by a test. Stops now store midnight in the stop's zone, and a midnight-local instant renders as a bare date because that is how "no time was given" is spelled.
13. **`npm run check` cannot run `next build` on this machine.** Adding it caught a real error the deploy would otherwise have found first — a `'use server'` file may only export async functions, and I had exported a const. But the build crashes Node on teardown with a libuv assertion (`UV_HANDLE_CLOSING`, exit 127), so the chain aborts before the tests run. Reverted. The build check is the deploy's job, which standing rule 9 already requires every step. **Step 6 committed the same error twice more** — `ASSIGN_INITIAL` and `VIEW_INITIAL` — and the deploy did NOT catch it, because the module compiles and the failure is a runtime 500 on the action call with the message on the server and a bare digest in the browser. The board looked correct and silently did nothing. Now an ESLint selector bans a value export from any `'use server'` file, which is the check the build was standing in for and costs nothing.
14. **Status-event notes are stored in English.** "POD document confirmed" is written to the database by the server and rendered verbatim, so it stays English in the Russian and Farsi timelines. Defensible — they are data, not chrome — but if they are meant to be user-facing they should be message keys with the text resolved at render.
15. ~~**Nothing pairs a driver with a truck.**~~ **Resolved in Step 7.** The driver form carries the pairing, with the truck's authority in the option label and a refusal in words when it disagrees with the driver's. The list is unfiltered on create — the authority is a field in the same form, so filtering it would mean either client-side javascript keeping two selects in step or a list that is wrong until the form is submitted once. On edit it is filtered, because there the authority is fixed. Original text: nothing pairs a driver with a truck. `Driver.assignedTruckId` exists in the schema and no surface writes it, so every truck row on the board shows "—" for its driver and the board's "the truck takes its current driver" never has one to take. Step 6 works around it by letting the assign modal name a driver when the truck has none — which it needs anyway, since §7 dispatches on truck AND driver — but the pairing itself belongs on the driver or truck screen and is not built.
16. **No permission resource covers a place.** Setting `Location.timezone` is gated on `load:update`, the closest existing right, because `src/lib/permissions.ts` has no `location` resource and Step 6 is not the step that adds one. Same shape as flag 5: the vocabulary is missing a word, and the nearest word is being used instead.
17. **The DISPATCHER role could not read a company name, and every page paid for it.** §6.3 puts a company filter on every operator screen and the app shell reads the authority names to build it — but `company:read` was held by OWNER and ADMIN only. A dispatcher got `ForbiddenError: Not permitted: company:read` from the LAYOUT on every request; most pages still rendered, and `/trucks/new` returned **500 where it should have returned 404**. Found by the acceptance run typing the URL a dispatcher is not allowed to type. MANAGER and ACCOUNTING had it too. Fixed by a `SHELL_READ` group added to all three roles, with a test that every non-driver role can read a company and still cannot update one.
18. **Reset mail has no API key, and creating one is an account-level act.** Same class as flag 2. The transport is built (`src/lib/email.ts`, 14 tests), wired, deployed, and documented in the README; `RESEND_API_KEY` is not set, so the worker logs `[zebra.email] RESEND_API_KEY is not set; nothing was sent` and the reset screen says exactly what it always says. That silence is deliberate — the answer to "reset my password" must not vary with whether the account exists OR with whether Resend is reachable. **Owed:** one `wrangler secret put`, and for production a verified sender domain.
19. **§5.1's row heights were unreachable, and the density control did nothing.** A Loads row carrying a status badge measures 39px with §5's fixed 8px cell padding — taller than Standard's 36px and Compact's 32px both, and `--z-row-height` is applied as a minimum. So the preference rendered identically in all three modes. §5.1 was amended (own commit, `f627389`) to move the vertical cell padding with the mode; Compact now measures 32px against Standard's 39px. The literal 36px Standard row is still not reachable with a badge in it, and is recorded as a target rather than quietly redefined.
20. **Six concurrent bookings take 16.5–19.6s of wall clock each.** Measured with `wrangler tail` during the acceptance run: ~300ms of CPU against ~18s of wall. The bookings serialize on the per-authority counter row and every statement inside the transaction pays a 200ms round trip to us-east-2. Correctness holds — no number was issued twice and each authority's numbers are contiguous — but a dispatcher booking while five colleagues do the same waits three times as long as the 6.4s single-user case. Not addressed in Phase 2; the fix is fewer statements inside the lock, not a longer timeout.
21. ~~**An uploaded document cannot be downloaded.**~~ **Resolved.** The filename in the documents panel now mints a sixty-second presigned GET through the route that has existed since Step 4 and calls it — verified deployed: 125 bytes uploaded, 125 bytes back. A button rather than an `<a>`, because a URL that lives a minute would age inside an href before the click. Original text: The documents panel renders
    the filename, size, timestamp and uploader as text — there is no link, and
    no route that serves the object back. Documents go into R2 and, from the
    interface, never come out. Found while writing `verify-upload.mjs`, whose
    first version asserted on a download link that does not exist. §7.8 asked
    for the panel and got it; nobody wrote down that a POD's whole purpose is
    to be sent to the broker to get paid. **Owed before the parallel run
    matters:** a presigned GET behind a permission check.
22. **There is no way to change somebody's role, scope, or name after the fact.** The Users screen creates, deactivates and reactivates; editing a membership is not built. A dispatcher promoted to manager needs a second account today, which is the kind of gap that gets worked around with shared logins. **Owed** before the team grows past the handful the parallel run needs.
23. **A restored asset reopens its assignment period.** Step 3 first shipped restore as leaving no open period, on the reasoning that where an asset works next is a decision somebody should make. `findAuthorityDrift` disagreed within the hour and was right: a live asset with a `companyId` and no open period is exactly the disagreement the drift check exists to catch, and §8 would find it un-dispatchable for want of an authority of record. Recorded because the losing argument was a reasonable one.

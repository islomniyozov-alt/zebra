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
| 3    | Load service layer: create/edit/cancel, counters, stops, status engine (§7), §8     |           |
| 4    | Create Load screen (§9)                                                             |           |
| 5    | Load detail: status timeline, documents UI (§10), notes                             |           |
| 6    | Dispatch board (§11) + Loads table upgrades                                         |           |
| 7    | Reset email, density persistence, polish, full acceptance run, deploy               |           |

**Deploy on day one and after every step.** Every Phase 1 blocker lived in the local-vs-workerd seam. `npm run deploy` + live check is part of each step's definition of done.

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
- [ ] Load created keyboard-only in under 40 s — measured, output shown
- [ ] Load numbers per-authority, contiguous under concurrency
- [ ] Assignment sets Dispatched automatically; unassignment reverts it; POD confirm sets POD received; Delivered is one click
- [ ] Conflict rules §8 each demonstrated with the refusal message
- [ ] Rate-con uploaded during create; POD attached from detail; both visible in R2 and audited
- [ ] `DISPATCHER` session: financial fields absent from every payload, and a financial route by URL → denied
- [ ] Status timeline shows correct source (MANUAL vs AUTOMATIC) per event
- [ ] Dispatch board renders both carriers' fleets; company filter narrows it
- [ ] Density preference persists across sessions per user
- [ ] Reset email delivers via Resend on the deployed worker
- [x] All screens correct in RU and `dir="rtl"`; hex check still 28-in-one-block; no `any`; all tests green

## 14. Standing rules

Phase 1 §14 carries forward unchanged, plus:

9. **Deploy on day one of the phase and at every step boundary.** The local-vs-workerd seam is where this project's bugs live.
10. **"I measured X" is shown, not summarized.** Paste the output. The PBKDF2 claim was confidently wrong once; measurement claims get the same skepticism as "it works."
11. **A negative check proves nothing unless the same request succeeds with the gate removed.** _(Added Step 2.)_ `expect(...).rejects` and a 401 both pass for the wrong reasons — a malformed request, an absent route, a typo in the test, a worker that is simply down. Pair every refusal with the identical call made after removing the single thing that caused the refusal. The incident: the Step 1 live check asserted "the API refuses an anonymous caller" and got a 405 (wrong method) and then a 400 (bad body). Both passed. Neither touched the auth gate.

## 15. Definition of done, per step

Migration/diff, test output, screenshots for anything visual (1080p Standard, plus RU and RTL where layout is new), deploy version IDs, and anything wrong in this brief, the schema, or the design system — flagged, not silently changed. Then stop.

---

## 16. Flagged against this brief

Recorded rather than resolved, per §0 and Phase 1's discipline.

1. **§6's `hash-wasm` prescription is wrong.** It calls `WebAssembly.compile` at runtime and workerd refuses (`Wasm code generation disallowed by embedder`) — the same refusal that forced a second Prisma client in Phase 1. Step 1 shipped argon2id via `@noble/hashes`, pure JS. Verified before substituting, not after.
2. **§6's R2 rotation could not be done from here.** Creating an S3-compatible token is an account-level act and `wrangler login`'s OAuth token is refused for it. Steps are in the README. **Still owed.**
3. **The schema's fleet unique index and its soft delete disagree.** `@@unique([companyId, unitNumber])` carries no `WHERE "deletedAt" IS NULL` predicate, so a removed truck 101 keeps holding the number against a new one. Handled in `src/lib/fleet.ts` by detecting the collision before insert and naming it, rather than by changing the schema. A partial unique index would be the cleaner fix and is a migration, so it is flagged rather than taken.
4. **`Truck.companyId` and the open `AssetAssignment` are two representations of one fact**, and nothing in the schema makes them agree. `transferAsset` writes both in one transaction; anything that sets `companyId` directly would desynchronise them silently. §8 reads the assignment as authoritative, so that is the one to trust when they differ.
5. **No permission resource covers fleet money.** `Truck.purchasePriceCents` and `Customer.creditLimitCents` are money on screens a `DISPATCHER` can read, and there is no `truck.financials` to gate them with. Both are omitted from every payload for now. Phase 3 should either add the resource or move the fields.
6. **Smart Placement produced no measurable change** — see the Step 2 report. Enabled, deployed, measured, unchanged. Left on, but unproven.

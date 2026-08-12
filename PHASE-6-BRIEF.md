# ZEBRA — PHASE 6 BRIEF: CREATE LOAD v2 & THE AMAZON PIPELINE

**Version 1** — 2026-08-11
**For:** Claude Code, working in the zebra repo
**Reads with:** `PHASE-6-SPEC.md` (the owner's spec, transcribed verbatim),
the five closed briefs, `EXTRACTION-CONTRACT.md`,
`TMS-DESIGN-SYSTEM.md`, `prisma/schema.prisma`. All standing rules carry. The
owner's full feature spec is the source dream; this brief is its honest
translation.

## 0. What the dream already has — build on, not beside

An inventory before any new table is invented (the ComplianceItem lesson):

- **Load → Stops has been the schema since Phase 1.** "Multi-stop data,
  single-stop UI" was the recorded decision; the database needs nothing. What
  Phase 6 builds is the _UI half_: a multi-stop form and stop timeline over the
  structure that already exists.
- **The extraction shape already speaks stops[]** — the golden set scored a
  three-stop document. The contract, confidence-per-field, all-or-nothing
  parse, money discipline: all inherited, not rebuilt.
- **Learning ([spec §17](PHASE-6-SPEC.md#17-learning-system)) exists**: CustomerAlias + facility memory.
  Amazon FC codes (SAT4 …) are facility-memory rows waiting to happen.
- **Validation (§6) mostly exists**: dup BOL/PO/probable-load,
  missing-required, warn-not-block with signed confirms. Phase 6 adds
  stop-sequence checks.
- **Audit (§19) exists end to end**, including extraction provenance and
  fellBackFrom.
- **"AI never overwrites production without approval" is already law**:
  auto-save is forbidden; prefill + dispatcher Save is the only write path.

## 1. Two architecture decisions — do not reopen

1. **The draft inbox does not repeal the no-review-screen rule — it routes to
   it.** Email-arriving loads have no dispatcher present, so a **Draft Load**
   state and an **Incoming Loads** inbox are legitimate. But opening a draft
   lands on _the same prefilled Create Load form_ with the same validations and
   the same Save. The inbox is a queue of unfinished forms, not a second
   editing surface.
2. **An Excel sheet, a pasted prompt, and a PDF are all just documents.** One
   extraction contract, one parser discipline, per-source ingestion adapters.
   No parallel pipeline.

## 2. The domain is now a prerequisite, not a parked item

Email-in ([spec §1](PHASE-6-SPEC.md#1-amazon-email-integration),
[§13](PHASE-6-SPEC.md#13-email-thread-matching)–[§15](PHASE-6-SPEC.md#15-email-to-tms-fallback)) requires receiving mail at an address you own —
Cloudflare Email Routing on a registered domain. This is the **fourth** feature
blocked on the ~$10 purchase (broker invoice email, dispatcher reset emails,
email-in extraction, and now the Amazon inbox). Steps 1–3 build without it;
Step 4 does not start until the domain exists. The runbook's parked block
executes then.

## 3. The owner owes this phase its corpus

- **3–5 real Amazon booking emails with their Excel "Load Information"
  attachments** (the actual .xlsx files) — the parser is built against real
  sheets or not at all; truth sheets and the interview follow the Phase 5
  method.
- **The MC list**: which of the five entities live in Zebra, with MC/DOT
  numbers.
- **The domain decision**, before Step 4.

## 4. Order of work

| Step | Work                                                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Create Load v2, part 1 — multi-stop**: the form gains add/remove/reorder stops over the existing schema; stop timeline rendering ([spec §8](PHASE-6-SPEC.md#8-visual-route--stop-timeline)) in Zebra's design language; manually-modified indicators; the typed single-stop path keeps its current speed, measured before/after           |
| 2    | **Create Load v2, part 2 — the chooser**: method tabs (Manual · Upload document · Paste text · Amazon), MC-first, recent-customers quick-pick, dropzone on the same surface; paste-text runs the same extraction contract on raw text                                                                                                       |
| 3a   | **Relay Trips CSV importer** _(rescoped by the owner when the corpus arrived as CSV — see flag 12)_: deterministic column parser, no model call; import-as-booked and import-as-delivered; preview-confirm before any write; UTC offsets honored per stop; Load ID as the duplicate key                                                     |
| 3b   | **Excel ingestion + Amazon profile**: .xlsx parsing server-side into the extraction pipeline; Amazon Load Information sheets extracted to multi-stop loads; golden mini-set from the owner's samples with truth interview; manual upload of the Excel works end to end — this alone kills the Datatruck download-upload ritual's worst half |
| 4    | **Email-in** (domain-gated): Cloudflare Email Routing → worker → same pipeline → Draft Load; the Incoming Loads inbox (ready / review / conflict states from real validation results, not vibes); forward-to-address works identically (§15)                                                                                                |
| 5    | **Thread matching + update detection**: same Amazon load number arriving again diffs against the existing draft/load, shows the change ("14:00 → 16:00"), applies on confirm; never a silent second load                                                                                                                                    |
| 6    | Polish + acceptance: RU/RTL on new surfaces, dispatcher walkthrough grown, stop-sequence validations (time-order; travel-time feasibility is PARKED — it needs mileage data Zebra doesn't have), accuracy table extended with an Amazon column, drift clean, brief closed with flags                                                        |

## 5. Parked, with names

- **Travel-time feasibility warnings** ([spec §6](PHASE-6-SPEC.md#6-ai-validation)'s "1h20m estimated") — requires
  a mileage/routing source; a real decision, later.
- **IMAP/OAuth mailbox monitoring** — Email Routing on the owned domain is the
  mechanism; connecting to Gmail inboxes is not.
- **GPS coordinates per stop** — schema hook exists via facility memory; no
  geocoding source this phase.

## 6. Acceptance excerpt

- [ ] A four-stop Amazon sheet becomes a four-stop draft with sequence
      preserved, types read not assumed, and every stop's own times
- [ ] Opening a draft lands on the standard form; Save is the only write; audit
      shows extracted vs corrected per field
- [ ] The same booking re-sent creates no second load; an updated time shows as
      a named diff and applies on confirm
- [ ] Typed single-stop path timing unchanged (measured)
- [ ] Excel manual upload works with the domain still unpurchased; email-in
      works the day it exists
- [ ] Amazon column joins the accuracy table with its own truth sheets

---

## 7. Flagged against this brief

Recorded rather than resolved, per Phase 1's discipline.

1.  ~~**The brief cites a spec this repository does not contain.**~~ —
    **CLOSED.** The owner's spec is transcribed verbatim as `PHASE-6-SPEC.md`
    and every citation in this brief now links into it. Step 1 was built against
    the brief's words alone; flag 2 records what the spec turned out to say when
    it arrived, and what was reconciled.

2.  **§8 arrived after Step 1 shipped, and it asks for three things the
    numbered list does not do.** Reconciled here in words rather than left as a
    silent disagreement.

    [§8](PHASE-6-SPEC.md#8-visual-route--stop-timeline) shows a **route summary**
    — `Chicago, IL ↓ Gary, IN ↓ Columbus, OH ↓ Pittsburgh, PA` — above per-stop
    blocks headed `Stop 1 — PICKUP`, each carrying a facility name, a city and
    state, a date, and **a time window** (`08:00–10:00`).

    What Step 1 built is the editable list: a numbered row per stop against a
    leading rule, with place, type and date. Three differences, and only one of
    them is a disagreement:
    - **No route summary.** §8's arrow chain is a READING view; the create form
      is a writing one, and a summary of four cities above four inputs that
      contain those cities is duplication on the screen where §9's forty seconds
      is measured. It belongs on the load DETAIL screen, which is where a
      dispatcher looks at a load rather than types one. Owed there, not here.
    - **`Stop 1 — PICKUP` as a heading.** The form carries the same two facts as
      a number and a type SELECT, because on this screen the type is editable —
      [§9](PHASE-6-SPEC.md#9-editable-stop-sequence) requires "change
      pickup/delivery type". A heading would be a label for something the
      dispatcher has to change elsewhere.
    - **THE TIME WINDOW IS A REAL GAP.** §8 shows `08:00–10:00` per stop and the
      form takes a DATE only. `LoadStop` has carried `scheduledAt`,
      `windowStart` and `windowEnd` since Phase 1, and the extraction reads all
      three — so a window that arrives on a document is currently **read,
      prefilled nowhere, and dropped at save**, exactly as it was before Phase 6.
      Not introduced by Step 1 and not fixed by it. Owed as its own step.

    And **[§9](PHASE-6-SPEC.md#9-editable-stop-sequence) asks for drag-and-drop
    reordering; Step 1 built ↑/↓ buttons.** Buttons are keyboard-reachable and
    drag-and-drop is not without a second implementation for the keyboard; the
    spec's requirement is "reorder", and the buttons meet it. If the owner wants
    the drag as well, it is additive rather than a replacement.

3.  **The stop type is a real control in the tab order, and it costs two tab
    stops per stop.** The alternative was `tabIndex={-1}`, which would keep §9's
    keyboard path exactly as it was and make the type unreachable without a
    mouse — a control a keyboard-only dispatcher cannot get to is not a saving.

    Measured rather than argued: typing went **101 ms → 101–125 ms** across
    runs, which is two extra tab stops and nothing else. The save round trip is
    unchanged within its own noise — 12.11/12.21 s before, 12.22/12.17 s after,
    with one outlier run at 8.4 s that was a quiet network rather than a
    speed-up, and is reported because dropping it would have flattered the
    result.

4.  **Eleven walkthrough scripts were repointed at indexed field names.**
    `pickup`/`delivery`/`pickupAt`/`deliveryAt` became
    `stops[i].place`/`stops[i].date`, because §6's "types read not assumed"
    rules out a form whose first row is a pickup by construction. The rename was
    mechanical and every affected walkthrough was re-run rather than reasoned
    about.

    **One run of `verify-dispatcher` reported 47/48 and the failing line was not
    captured**; two runs after it were 48/48. Recorded rather than dismissed —
    an unexplained flake in the script that guards the money split is worth a
    name, and the next session should capture the failure output rather than the
    tail.

5.  **A stop's identity is its key, not its index.** Reordering with index keys
    would make React reuse the moved row's uncontrolled place input, so dragging
    stop 3 above stop 2 would leave the text behind. The rows carry a minted
    key; the fields are keyed by it.

6.  **Flag 4's unexplained 47/48 has a name: the dashboard's transaction
    expires.** Captured in full this time, under `wrangler tail`:

    ```
    PrismaClientKnownRequestError: Transaction API error: A commit cannot be
    executed on an expired transaction. The timeout for this transaction was
    5000 ms, however 6034 ms passed since the start of the transaction.
    ```

    `/dashboard` runs the queue, the fleet and the week in ONE interactive
    transaction against the 5 s default, and whether it fits depends on how
    quickly Neon answers a dozen queries. An owner gets a 500 on the main
    screen. It is the Phase 4 `/documents` failure exactly, and it was already
    there before Phase 6 — the walkthrough had been reporting it as an
    unattributed flake.

    Raised to 20 s, which converts a broken screen into a slow one. **That is
    not the fix and does not pretend to be**: Phase 5 §7 flag 31 says the answer
    to a slow transaction is fewer statements inside it, and this screen is the
    next candidate. Two dispatcher runs clean afterwards.

7.  **The chooser moved the file input behind a tab, and five walkthroughs went
    looking for it where it used to be.** `section input[type="file"]` only
    exists on the Upload panel now. Every affected script clicks the tab first —
    which is what a dispatcher does, so the walkthrough got more faithful rather
    than less.

8.  **`stopRowsFrom` and `typedDateFrom` were lifted out of the component
    because nothing in it can be tested.** `CreateLoadForm` is a client
    component whose imports reach `server-only`, so a unit test of it fails at
    import. The paste walkthrough found three stops arriving with no dates and
    two readings of the code did not find why; moving the three pure readers
    into `prefill.ts` and testing them directly found it in one run.

    The bug: `windowStart?.value ?? scheduledAt?.value` falls through on `null`
    and `undefined` **and not on `''`**, so a model that sends an empty window
    start beats a perfectly good appointment, slices to an empty string and
    normalises to null. Emptiness is absence now, and eleven tests cover the
    readers.

    Worth carrying: **a client component that imports a server action cannot be
    unit tested at all**, so anything in one that is worth testing does not
    belong in it.

9.  **The window gap is closed, and it cost four tab stops.** `LoadStop`'s
    `windowStart`/`windowEnd` have existed since Phase 1 and the extraction has
    read them since Phase 5; the form had nowhere to put them, so every printed
    `08:00–10:00` was read and dropped at save. Each stop row now carries From
    and To beside the date, prefilled from the extraction and written to the
    columns as instants **in the stop's own zone** (design rule 3) — the
    fixture's `06:00–10:00` delivery lands as `13:00–17:00 UTC`, which is
    Pacific in August, and `verify-upload-first` asserts the pair rather than
    the clock face.

    TWO FIELDS, NOT ONE RANGE. A range needs parsing and `0800-600` is a real
    thing a broker prints (Phase 5 flag 30). Two plain times cannot be
    malformed, only empty — and empty is the ordinary answer, because rule 1 of
    `EXTRACTION-CONTRACT.md` says a window needs two DIFFERENT ends and most
    stops carry an appointment.

    **Measured cost to §9's typed path: 101 ms → 147 ms of typing**, which is
    four extra tab stops on a two-stop load. The save is unchanged
    (12.5/12.9 s against 12.2 s, inside its own noise). Under the forty-second
    target by a wide margin, and named here rather than discovered later.

10. **The dashboard diet: 7.0 s → 5.7 s, and the 5 s default is still not
    earned.** Five loads each, before and after, under `wrangler tail`.

    The screen ran eighteen statements in ONE interactive transaction — the
    thing that expired at 6034 ms and 500'd for an owner. It now runs three
    SHORT reads CONCURRENTLY: the queue, the fleet, and the week (whose two
    statements stay together because the second needs the first). The wall
    clock is the slowest section rather than the sum, and no single transaction
    is open long enough to expire.

    The 20 s bandage is gone; the ceiling is **10 s**, not the 5 s default,
    and the reason is the measurement rather than caution: 5.7 s of client wall
    across three CONCURRENT transactions puts the slowest of them close enough
    to five seconds that returning to the default would bet the screen on a
    quiet network. Worker CPU is ~260 ms of it either way — this was never
    computation.

    **What earns the default: fewer statements.** `fleetGlance` runs five
    counts and `actionQueue` several more, and Prisma serialises them onto the
    transaction's single connection however they are written. Collapsing the
    counts into one query is the next cut, and it is deliberately not bolted
    onto a measurement session: raw SQL under RLS with a dynamic authority
    filter is the shape that produced the seven wrong screens in Phase 2.

11. ~~**Companies are seed-only**~~ — **CLOSED.** An owner-gated Add authority
    screen exists at `/companies`, and the original flag is kept below because
    the reasoning it records is why the screen is shaped the way it is.

    Three decisions worth naming:
    - **The plan limit is enforced at create, and the refusal says the
      number.** `maxCompanies` has defaulted to 1 since the init migration and
      nothing ever checked it — nothing could, because nothing could create a
      company. It is counted INSIDE the caller's transaction, so two people
      adding the last authority at once cannot both pass a check that was true
      when each of them read it. The list screen prints "2 of 2 used" beside
      the heading, so somebody knows they will be refused before filling in a
      form rather than after.
    - **The state field is stricter here than everywhere else.** The shared
      `stateCode` TRUNCATES — "Texas" becomes "TE" — which on a stop is a wrong
      label and on an authority is a wrong state at the top of every invoice
      that carrier sends. Refused rather than silently shortened, and the
      shared helper is left alone because stops chose leniency deliberately.
    - **The nav entry is gated on `create`, not `read`.** Every operator role
      holds `company:read` — the topbar's authority switcher is built from
      these rows — so a read-gated entry put the whole Administration group in
      a dispatcher's sidebar. The permissions test caught it on the first run.

    No counter is seeded: the per-authority series starts at the first booking,
    and an integration test asserts a new authority has no counter row until it
    books, then numbers from its own start rather than continuing another
    carrier's.

    THE ORIGINAL FLAG: `company` is a resource in
    `permissions.ts` and OWNER/ADMIN hold `company:create` through EVERYTHING —
    and nothing implements it. The only ways an authority exists today are the
    seed script and hand-written SQL.

    §3 owes this phase "the MC list: which of the five entities live in Zebra,
    with MC/DOT numbers", and every one of them has to be typed in somewhere.
    Until then the authority select on the create form, the per-authority
    factoring remit-to, the settlement week boundary and the invoice numbering
    series are all configured for carriers that can only be conjured by a
    developer.

    **Owed: a minimal owner-gated screen** — name, MC, DOT, address, and the
    fields the invoice header already reads. Small, and blocking more than it
    looks: it is the difference between the owner onboarding a carrier and
    filing a ticket.

12. ~~**`corpus-amazon/` was not in the working tree**~~ — **CLOSED, and it
    arrived as something else.** The directory did not exist when Step 3 was
    called; §3 says the Excel parser is built "against real sheets or not at
    all", so the step did not start — building a parser against an invented
    spreadsheet would produce a golden set that grades a guess, which is the
    failure the Phase 5 interview method exists to prevent.

    The corpus landed mid-session as **three CSVs, `Trips (45-47).csv`, and no
    emails** — a Relay **Trips export**, not the `.xlsx` Load Information
    attachments §3 names. The owner rescoped rather than resupplied: both
    artifacts are real, the CSV is the true Relay export format, and Step 3
    split into **3a** (this CSV importer) and **3b** (the `.xlsx` path, which
    still waits for its corpus).

13. **A Relay export is a MAPPING, and mapping it with a model would have been
    the expensive kind of wrong.** The owner's rescope said it outright — "no
    model call; fixed columns are a mapping, not an extraction" — and it is
    worth recording why, because the pull the other way is real: Phase 5 just
    built an extraction contract and every instinct says reuse it.

             A rate confirmation is a PAGE. Every broker lays one out differently, only
             a reader can tell a pickup date from a print date, and the
             observed-instability tables in `EXTRACTION-CONTRACT.md` are what that
             costs. A Relay export is a SPREADSHEET Amazon generates: `Stop 2 Planned

        Arrival Time`is the planned arrival time of stop 2 in every file that will

    ever exist. Reading it with a model would pay per token for a lookup AND
    make a deterministic mapping non-deterministic.`src/lib/relay-csv.ts` therefore imports nothing from`claude.ts`, `gemini.ts`or
    `model-engine.ts`.

             The result still travels the shared road: the same `LoadWarning` type, the
             same signature-gated confirm, the same `createLoad`, the same status
             engine.

14. **THE OFFSETS IN THE EXPORT ARE STANDARD-TIME OFFSETS, AND AUGUST IS NOT
    STANDARD TIME.** This is the one finding in §3a that needs the owner's
    ruling, and it is flagged rather than resolved because resolving it would
    be inventing a fact.

    Every stop in the corpus carries a `Stop N UTC Offset` column and every
    value is the facility's STANDARD offset, not its current one:

    | Facility               | Region  | File says | Actual, August 2026 |
    | ---------------------- | ------- | --------- | ------------------- |
    | FOE1, MCI4, JAN1, BNA6 | Central | −6        | −5 (CDT)            |
    | LG_ELECT_37040...      | Central | −6        | −5 (CDT)            |
    | NSRR-ATLANTA, AGS1     | Eastern | −5        | −4 (EDT)            |
    | BNSF-FAIRBURN-EFC      | Eastern | −5        | −4 (EDT)            |

    Consistent across all five loads and both zones — this is not noise, it is
    what the column means. The ruling was "UTC offsets honored per stop", so
    they are honored literally: instant = printed clock − printed offset.

    THE CONSEQUENCE, IF THE PRINTED CLOCK IS THE FACILITY'S WALL CLOCK: every
    imported instant is one hour late. Relative arithmetic is unaffected — both
    ends of a cross-zone run shift equally, so a 6h30 transit stays 6h30 — but
    an appointment stored an hour late is an appointment a driver can be late
    for. The preview prints `Aug 11, 23:30 UTC−6` rather than an abbreviation
    precisely so this is visible and correctable: `CST` would be a claim the
    file never made, and would have hidden the question.

    What settles it is one imported load compared against the Relay app.

15. **The export has NO ADDRESSES, so imported stops are facility codes.**
    `FOE1`, `BNSF-FAIRBURN-EFC`, `LG_ELECT_37040_1720_825` — a name and nothing
    else. Each becomes a `Location` with that name and null city, state and
    timezone, which is the truth rather than a town parsed out of a code.

    `LG_ELECT_37040_1720_825` contains what looks like ZIP 37040 (Clarksville,
    TN) and a building number. Splitting it would be an inference about a
    string Amazon composed for its own reasons, and rule 5 of the extraction
    contract forbids exactly that on the other path.

    THE CONSEQUENCE IS A DISPLAY ONE and it compounds flag 14: with no state
    and no zone, `resolveZone` falls back to `America/Chicago`, so an Augusta
    stop renders in Central time on the load screen. Phase 5's facility memory
    is the fix already built — the first time a dispatcher fills an address in,
    the code has a dock behind it and every later import finds it.

16. **The driver is NAMED on the load and not ASSIGNED to it, and the corpus
    proves why.** `Driver Name`, `Tractor Vehicle ID` and `Trailer ID` are all
    in the export and all go into `dispatcherNotes` as text.

    Matching a name to a `Driver.id` is a fuzzy join onto a compliance record.
    Worse, it would fail the import: trip `T-113PDBV26` carries two loads whose
    windows OVERLAP — the first is planned out of MCI4 at 01:02 and the second
    planned into MCI4 at 00:32, because Amazon's planned times overlap at a
    handoff. Assigning one driver to both hits Phase 4's `assertAssignable` and
    throws a dispatch conflict over freight that really did run that way.

    Assignment stays a human act on the dispatch board.

17. **`LoadInput` types its scalar fields `unknown`, and passing a NUMBER to
    one silently stores nothing.** `createLoad` reads `dispatchedMiles`,
    `weightLbs` and the rest through `optionalText`, which returns null for
    anything that is not a string. The first version of `importRelayLoad`
    passed `241` and the load saved with no miles at all — no error, no type
    complaint, nothing to notice.

    Caught by the integration test asserting the EXACT value. An assertion of
    "not null" would have passed on the null, and `toBeDefined()` would have
    passed on `undefined` — the same lesson Phase 5 recorded about ranges
    hiding counts, one layer down.

    Not fixed at the source: `LoadInput`'s `unknown` fields are what let the
    create form pass raw `FormData` values, which is the right design for the
    caller that has them. Flagged as a trap for the next non-form caller.

18. **A one-click forty-five-load write cannot share one transaction, so it
    does not.** A create is ~31 statements (`LOAD_WRITE_TIMEOUT_MS`), and
    Prisma's ceiling is wall-clock: forty-five in one interactive transaction
    cannot finish on any connection. Phase 5 flag 31's rule is "fewer
    statements inside the lock, not a longer lock", and the smallest honest
    lock here is one load.

    THE COST IS THAT AN IMPORT CAN END PARTLY DONE, and that is reported rather
    than hidden — the result names how many were created and how many failed.
    Re-running the same file is safe by construction: every row that landed
    raises the duplicate-reference warning the second time.

    UNMEASURED: the corpus is five rows and the largest real file is unknown.
    Forty-five sequential creates is roughly 27 s of wall time on the deployed
    worker at its measured round trip. That is inside a Worker's limits — the
    30 s cap is CPU, not time spent waiting on a socket — but it has not been
    run at that size, and `MAX_IMPORT_ROWS` is 200.

19. **The preview-confirm step is the ONLY review screen in Zebra, and §1.1
    still stands.** The no-review-screen rule governed a single prefilled load
    a dispatcher reads field by field: the form IS the review. Forty-five loads
    written by one click cannot be reviewed that way — nobody can review what
    they cannot see, and the thing being confirmed is the SET.

    So the plan is computed, shown, and gated by a signature over itself, the
    same device `warningSignature` uses. Reading a file writes NOTHING: not the
    customer, not a location, not a load. This is a distinction between acts,
    not a repeal.

20. **`duplicate_reference` is a new warning kind, and the export forced it.**
    The owner's ruling was "the trip/load ID column is the duplicate key
    through the existing warnings" — and the existing warnings had no hook for
    it. A Relay export carries no BOL, no PO and no addresses, so
    `duplicate_bol`, `duplicate_po` and the broker+date+lane check all have
    nothing to compare.

    `Load ID` → `Load.referenceNumber` is the exact key, so `WarningInput`
    gained an optional `referenceNumber` and `loadWarnings` a fifth check. A
    warning rather than a constraint, like the other two: `referenceNumber` has
    never been unique and a broker really does reissue a number.

    The create form does not pass it — it has no field for it — which is why
    the input is optional rather than nullable: omitting it says "not
    applicable", which is different from having one and leaving it empty.

21. **The stop TYPE is assigned by position, which §6 forbids everywhere
    else.** "Types read not assumed" is the rule, and every other path obeys it
    because a rate confirmation prints the words PICKUP and DELIVERY.

    THIS EXPORT HAS NO TYPE COLUMN. `Facility Sequence` is `FOE1->MCI4` and
    nothing more. Position is not an assumption here — it is the only
    information the file contains — and Relay's own model is one Load ID per
    leg, A to B, which is why every row in the corpus has exactly two stops.
    First is PICKUP, last is DELIVERY, anything between is INTERMEDIATE.

    If a Relay export ever ships three stops on one Load ID, the middle one
    will be honestly labelled INTERMEDIATE and honestly wrong half the time.

22. **`Estimated Cost` is imported as the linehaul, and it is an ESTIMATE.**
    The column is Amazon's estimate of what the trip pays and it is the only
    rate figure in the export. Two of the five corpus loads are $17.18 and
    $1.47 — a bobtail move and a container-pool adjustment — which are real
    payments for real moves and look like nothing.

    Rule 4 of the extraction contract would call an estimate a weaker thing
    than a booked rate. It is imported anyway because there is no other number
    and a load with no rate cannot be reconciled against the weekly statement
    at all; the settlement is what corrects it. Named here so nobody later
    reads `linehaulCents` on an imported load as a contracted figure.

    Subject to the same money wall as everything else: a DISPATCHER's preview
    has no rate column IN THE PAYLOAD, and their import books at zero.

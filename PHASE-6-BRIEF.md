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

14. ~~**THE OFFSETS IN THE EXPORT ARE STANDARD-TIME OFFSETS**~~ — **SETTLED
    BY THE RELAY PORTAL, AND FIXED.** The owner checked the same trips in
    Amazon's own interface: identical wall clocks, labelled **CDT**. So the
    printed clock is the facility's wall clock, and `Stop N UTC Offset` is
    static standard-time metadata that reads −6 all summer while Central is on
    −5. Subtracting it, which the first version did, landed every August
    instant an hour late.

    The evidence that made this worth asking rather than assuming:

    | Facility               | Region  | Column says | Actual, August 2026 |
    | ---------------------- | ------- | ----------- | ------------------- |
    | FOE1, MCI4, JAN1, BNA6 | Central | −6          | −5 (CDT)            |
    | LG_ELECT_37040...      | Central | −6          | −5 (CDT)            |
    | NSRR-ATLANTA, AGS1     | Eastern | −5          | −4 (EDT)            |
    | BNSF-FAIRBURN-EFC      | Eastern | −5          | −4 (EDT)            |

    **THE FIX IS STRUCTURAL, NOT ARITHMETIC.** `relay-csv.ts` no longer
    produces `Date`s at all — it returns `RelayClock`, the printed date and
    hands, validated and not rearranged. A parser that cannot see a facility
    cannot know its zone, and the zone is now part of the answer. Instants are
    built in `relay-import.ts` by `zoneWallClock`, which is `zoneMidnight`
    generalised past midnight: the same two-pass DST-aware conversion every
    typed date in the create form already goes through, so a clock is never
    turned into a moment by adding hours to something.

    Re-verified against the corpus: `FOE1` reads back **Aug 11, 23:30 CDT** and
    `JAN1` **Aug 13, 01:51 CDT** — the two faces the portal shows. Every stop
    in all three files round-trips to the clock it was printed with, and the
    preview now renders through `renderStopTime` with the real abbreviation
    instead of the `UTC−6` placeholder the old reading forced.

15. **The zone comes from the offset column's ZONE FAMILY, and that is a
    deliberate reading of "demote it to a cross-check".** Three sources, in
    order (`zoneForRelayStop`):
    1. **`Location.timezone`**, when the facility has one — design rule 3 says
       the recorded zone wins, and a dispatcher who has filled in where `AGS1`
       is has said something the file cannot.
    2. **The zone the standard offset names** — −6 Central, −5 Eastern, −7
       Mountain, −8 Pacific.
    3. **The company fallback.**

    WITHOUT SOURCE 2 THE FIX WOULD BE HALF A FIX, silently. A facility code has
    no state, so `resolveZone` falls to `America/Chicago` for every imported
    stop — and an Augusta appointment read as Central is still an hour late,
    with the cross-check agreeing that −5 is −5 and saying nothing. The failure
    would be invisible exactly where it matters. The offset is not converting
    anything; it is answering "which zone", which is the one geographic fact
    the file states.

    THE CROSS-CHECK is `offsetDisagrees`: after the instant is built, compare
    the resolved zone's real offset at that moment against the column. Expected
    is `actual − column ∈ {0, +1}` — zero in winter, one in summer. Outside
    that, a `offset_disagrees` warning naming the facility, both offsets and
    the zone, in front of the confirm. Not a refusal: the times are still the
    best reading available, and the fix is to record the facility's timezone,
    which is source 1 and makes every later import of that dock right.

    **ARIZONA IS THE KNOWN HOLE.** −7 maps to `America/Denver`, which observes
    DST; Phoenix does not, so a Phoenix facility's summer clocks land an hour
    EARLY and the cross-check calls the one-hour gap explainable. Not resolved
    by guessing between two zones that share an offset — resolved by source 1,
    a dispatcher recording the zone. Relay runs little into Arizona and the
    corpus has none, so this is named rather than pre-empted.

16. **The export has NO ADDRESSES, so imported stops are facility codes.**
    `FOE1`, `BNSF-FAIRBURN-EFC`, `LG_ELECT_37040_1720_825` — a name and nothing
    else. Each becomes a `Location` with that name and null city, state and
    timezone, which is the truth rather than a town parsed out of a code.

    `LG_ELECT_37040_1720_825` contains what looks like ZIP 37040 (Clarksville,
    TN) and a building number. Splitting it would be an inference about a
    string Amazon composed for its own reasons, and rule 5 of the extraction
    contract forbids exactly that on the other path.

    THE CONSEQUENCE WAS GOING TO BE A DISPLAY ONE — with no state and no zone,
    `resolveZone` falls back to `America/Chicago`, so an Augusta stop would
    render in Central on the load screen. Flag 15's second source closes it for
    the IMPORT, which writes `Location.timezone` from the offset column's zone
    family, so the row is created knowing it is Eastern. What is still missing
    is the street: a facility with a zone and no address cannot be matched by
    Phase 5's facility memory, which keys on a folded address. The first time a
    dispatcher fills one in, the code has a dock behind it and every later
    import finds it.

17. **The driver is NAMED on the load and not ASSIGNED to it, and the corpus
    proves why.** `Driver Name`, `Tractor Vehicle ID` and `Trailer ID` are all
    in the export and all go into `dispatcherNotes` as text.

    Matching a name to a `Driver.id` is a fuzzy join onto a compliance record.
    Worse, it would fail the import: trip `T-113PDBV26` carries two loads whose
    windows OVERLAP — the first is planned out of MCI4 at 01:02 and the second
    planned into MCI4 at 00:32, because Amazon's planned times overlap at a
    handoff. Assigning one driver to both hits Phase 4's `assertAssignable` and
    throws a dispatch conflict over freight that really did run that way.

    Assignment stays a human act on the dispatch board.

18. **`LoadInput` types its scalar fields `unknown`, and passing a NUMBER to
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

19. **A one-click forty-five-load write cannot share one transaction, so it
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

20. **The preview-confirm step is the ONLY review screen in Zebra, and §1.1
    still stands.** The no-review-screen rule governed a single prefilled load
    a dispatcher reads field by field: the form IS the review. Forty-five loads
    written by one click cannot be reviewed that way — nobody can review what
    they cannot see, and the thing being confirmed is the SET.

    So the plan is computed, shown, and gated by a signature over itself, the
    same device `warningSignature` uses. Reading a file writes NOTHING: not the
    customer, not a location, not a load. This is a distinction between acts,
    not a repeal.

21. **`duplicate_reference` is a new warning kind, and the export forced it.**
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

22. **The stop TYPE is assigned by position, which §6 forbids everywhere
    else.** "Types read not assumed" is the rule, and every other path obeys it
    because a rate confirmation prints the words PICKUP and DELIVERY.

    THIS EXPORT HAS NO TYPE COLUMN. `Facility Sequence` is `FOE1->MCI4` and
    nothing more. Position is not an assumption here — it is the only
    information the file contains — and Relay's own model is one Load ID per
    leg, A to B, which is why every row in the corpus has exactly two stops.
    First is PICKUP, last is DELIVERY, anything between is INTERMEDIATE.

    If a Relay export ever ships three stops on one Load ID, the middle one
    will be honestly labelled INTERMEDIATE and honestly wrong half the time.

23. **`Estimated Cost` is imported as the linehaul, and it is an ESTIMATE.**
    — **PARTLY CORRECTED 2026-09-02.** What follows is right about the money
    and wrong about the input, and the wrong half was repeated into a screen
    title, a cross-link and a commit message before anybody checked it.

    THERE IS ONE RELAY EXPORT, NOT TWO. Both importers read the same columns —
    `Trip ID`, `Load ID`, `Facility Sequence`, `Load Execution Status`,
    `Estimate Distance`, `Estimated Cost`, `Stop N …` — and the board parser's
    own refusal message calls the file "a Relay Trips export". What differs is
    the UNIT OF THE OUTPUT: `/loads/import` makes one load per ROW,
    `/loads/import/trips` groups rows by Trip ID and makes one load per TRIP.

    SO THE REAL RULE IS ROW CARDINALITY, not two file formats. On a trip whose
    export is a single row, `Estimated Cost` is that load's price — verified
    against the Relay portal at $5,089.07. On a trip spread across several
    rows it is an allocation between them, summing to ~$310 on a trip that
    paid $1,776. Everything below about the money still holds; only the
    sentence "the other export" was wrong.

    AND A RULE BUILT ON A WRONG MODEL OF THE INPUT IS WORTH RECORDING EVEN
    AFTER THE RULE IS REPLACED. On 2026-08-19 the two screens were renamed to
    "load-board export (rates)" and "Trips export (legs & miles)" — a naming
    ruling made carefully, agreed explicitly, and built on the belief that a
    dispatcher could tell the screens apart by which FILE they were holding.
    That question has no answer, so the titles could not help, and the owner
    lost real time on the confusion they were meant to end. The titles now name
    what each screen DOES, and the preview prints "16 trips from 41 rows" —
    the one number that differs between the screens on the same file.

    The original entry follows.

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

24. **The FMCSA lookup was built outside §4's order, and it is UNVERIFIED
    AGAINST THE LIVE REGISTER.** An owner request rather than a step: a
    DOT-or-MC lookup on the Add authority form, prefilling legal name, DBA,
    address, phone and entity type, warning in words on an authority that is
    inactive or out of service.

    ~~`FMCSA_WEBKEY` is set on the workers and deliberately absent from this
    machine, so no call has been made against the real API.~~ — **CLOSED
    2026-08-13.** The owner ran both lookups on production: the authority form
    filled from a real USDOT, and the broker lookup corrected a customer
    recorded as "Warner" to **Werner** from the register.

    That second one is the better evidence of the two. It exercised the broker
    path end to end AND confirmed flag 28's decision in the field: the legal
    name landing in `Customer.name` is what caught a misspelling that would
    otherwise have gone out on an invoice to a company whose name was spelled
    wrong — and `Customer` has no `legalName` column to hide it in.

    WHAT TWO SUCCESSFUL CALLS DO NOT PROVE, named so the next session does not
    read this flag as blanket coverage:
    - No record in a BAD STATE has come back, so `concernsFor`'s sentences —
      out of service, inactive, revoked broker authority — remain proven
      against constructed payloads only. The not-getting-paid gate has never
      fired against a real broker.
    - No malformed answer has arrived, so `parseCarrier`'s defensive branches
      are still untested by the register rather than by the suite.
    - The rate limit has not been near its budget in production.

    The tests still build their payloads by hand rather than recording one,
    which is deliberate: it keeps them runnable with no credential and no
    network. What changed is that the shape they assert against is now the
    shape the register actually sends.

    That is why `parseCarrier` is written the way it is: every field is
    null-on-anything-unexpected, and a test feeds it an object where a legal
    name, a city and two nested blocks have the wrong types. A register that
    changes a field must produce a blank on a form somebody is about to check,
    never `[object Object]` in a legal name on an invoice.

    THREE THINGS THE REGISTER RETURNS AND ZEBRA CANNOT STORE: entity type,
    operation and safety rating. `Company` has no column for any of them, so
    they are SHOWN in the lookup panel and not saved. Three columns to hold
    what the register can be asked again is a migration this screen has not
    earned; if fleet-wide safety history becomes a feature, that is when it
    earns one.

    THE LOOKUP NEVER WRITES AND NEVER AUTO-SAVES. It fills the form's fields,
    marks each filled field "From FMCSA" until somebody types in it, and the
    only write on the screen is still the button at the bottom — the extraction
    contract's posture applied to a different source of the same kind of claim.
    Every failure (no key, not found, 5xx, unreachable, unreadable) is its own
    sentence ending in "type the details instead", and nothing on the form is
    disabled while it runs except the lookup button itself.

    THE KEY IS THE REASON IT IS A SERVER FUNCTION. QCMobile takes the web key
    as a QUERY PARAMETER, so a browser fetch would put it in the network tab of
    anybody who opened the form, in their history and in every proxy log on the
    way. `verify-dispatcher` asserts that neither `webKey` nor the FMCSA
    endpoint appears anywhere in the page payload.

    ~~NOT RATE-LIMITED.~~ **LANDED — see flag 26.** The parked reasoning was
    that the action is gated on `company:create`, which only OWNER and ADMIN
    hold, so the exposure was a trusted user pressing a button in a loop; and
    that it "becomes real the day this same service is pointed at broker
    verification, where a DISPATCHER might hold the permission". That day
    arrived one session later, and wider than this flag guessed.

25. **`@@unique([organizationId, dotNumber])` has been in the schema since the
    init migration and nothing ever handled it.** A second authority with the
    same USDOT escaped `addCompany` as a Prisma unique violation, went
    uncaught through `addCompanyAction`, and reached the browser as a 500 with
    no sentence in it.

    Harmless while a DOT number was something somebody typed occasionally.
    Not harmless the moment a lookup fills it in, because looking the same
    carrier up twice is exactly what a person does when they are not sure
    whether they already added it. Now a named refusal that prints the number,
    checked before the insert rather than caught after it — a caught constraint
    error does not carry the value, and "USDOT 3162967 already belongs to
    another authority here" is the whole usefulness of the message.

26. **The broker lookup opened the door to EVERY role, not to dispatchers.**
    Flag 24 parked the rate limit against the day a DISPATCHER could reach the
    lookup. `customer:create` turns out to be held by all five roles —
    DISPATCHER because §9's create-on-miss needs it mid-booking, and ACCOUNTING
    through `RECORDS_WRITE`, because a broker's billing email, payment terms
    and block are accounting's to keep current. The pair-assert in
    `tests/permissions.test.ts` was written asserting four roles and failed;
    the test was wrong, not the permissions.

    So the second door is the wide one and the budget in `fmcsa-gate.ts` is
    sized for it: ten lookups per person per minute, sixty overall.

    A SLIDING WINDOW, AND REFUSALS ARE NOT CHARGED. A fixed window lets
    somebody spend a whole budget in the last second of one and the whole of
    the next in its first second — twice the limit in two seconds, which is the
    exact burst this exists for. And recording refused attempts would push the
    oldest allowed one out of the window on every retry, so a client in a tight
    loop would never recover: a rate limiter that punishes retrying turns a
    burst into an outage. Both are asserted.

    IN MEMORY, WHICH IS A REAL LIMITATION AND IS NOT A PRETENCE. Workers share
    no memory, so this counts within one isolate and Cloudflare may run
    several. It stops the loop it was built to stop — a runaway client hits one
    isolate repeatedly — and it does NOT stop a determined authenticated user
    spreading requests across isolates. The honest fix is a Durable Object or a
    KV counter, which is a binding and a deploy rather than a code change. Say
    the word and it becomes one.

    NOT A DATABASE COUNTER, deliberately: a per-request write to Neon on a path
    whose whole job is to be a convenience would cost more than the thing it
    guards.

27. **A broker's authority is judged as a broker's, and silence stays
    silence.** The same JSON means different things depending on who is asking,
    and `LookupAudience` is the only place that difference is allowed to live:
    - `operating` — an authority WE book under. Common or contract authority is
      what matters; broker authority is not expected.
    - `broker` — somebody who will tender freight and then owe money. Broker
      authority is the whole question. `I` (granted, then revoked or lapsed) is
      the not-getting-paid gate and gets its own sentence, because an unpaid
      invoice against a revoked broker is a claim on a surety bond that may
      already be spent. `N` (never granted) is a DIFFERENT fact and gets a
      different, milder sentence.
    - `shipper` — a factory handing us freight holds no authority of any kind
      and is not supposed to. Warning that a customer has none would be an
      accusation built out of the ordinary case, so the general "no active
      authority" sentence is suppressed entirely for them.

    `null` — the register did not answer about broker authority — says nothing
    at all, in every audience. Absent data is a gap, not an accusation, and the
    test that pins this is the one that matters most: a system that invents bad
    news out of a blank field trains its users to click past the warnings that
    are real.

    The audience comes from the form's own Type select, so changing a record
    from BROKER to SHIPPER changes what the next lookup warns about.

28. **The legal name goes in `Customer.name`, and the authority form does the
    opposite.** `Company` has both `name` and `legalName`, so an authority
    takes the DBA as its trade name and keeps the legal one for the invoice
    footer. `Customer` HAS NO `legalName` COLUMN — so the single `name` field
    is the only place an entity's identity can live, and it takes the LEGAL
    name first.

    That is the entity who signs the rate confirmation, who the invoice is
    addressed to, and who a collections letter names; a trade name in that
    field is a trade name on an invoice a legal person has to pay. The DBA is
    not lost — it is on the panel beside the fields, and `CustomerAlias` learns
    whatever the rate confirmations actually print the first time a dispatcher
    corrects it.

    A `Customer.legalName` column would remove the asymmetry. Not taken: it is
    a migration, and the alias table already carries the "they print something
    else" case that motivates one.

29. **`RecordForm` gained prefill by remounting, not by becoming controlled.**
    Four reference forms share it and three needed nothing. Making all four
    controlled to serve one would have moved every keystroke in the fleet forms
    through React state for a feature two screens use.

    Instead a prefilled field's `key` carries its prefilled value: change the
    value, the input remounts and adopts the new default. Every other field
    keeps its key, its cursor and whatever was already typed into it. Typing in
    a field takes it back from the register — the mark clears and the prefill
    stops applying to it.

    THE ONE THING THIS CANNOT DO is re-prefill a field to the value it already
    had after somebody typed over it, since the key would not change. Looking
    the same carrier up twice after editing the city leaves the edit standing.
    That is arguably correct and is certainly not obvious; named here rather
    than discovered.

30. **The duplicate-MC refusal is a door, not a law about the column.**
    `Customer.mcNumber` is indexed and NOT unique, and it stays that way: a
    unique index would also forbid the legitimate case of one MC recorded twice
    while a merger settles. The refusal lives at `createBroker`, which is the
    one door brokers come through.

    Two customers for one broker is the expensive kind of duplicate — it splits
    the payment history, the credit limit and the aging of a single
    relationship, and nothing downstream notices, because an unpaid invoice
    sits under one row while the payments land against the other.

    RETIRED BROKERS COUNT. A `deletedAt` row still holds the freight it ran, so
    the answer to "we already have them, they were retired" is to restore that
    record rather than start a second history. Asserted.

31. **§7.1 SPECIFIED CLICKABLE ROWS IN PHASE 1 AND `Table` NEVER IMPLEMENTED
    IT.** The owner reported it on Companies and Brokers. The audit finding is
    wider: the design system has said "the whole row is clickable via a
    stretched-link `::after` on a real anchor — middle-click and keyboard both
    work" since Phase 1, and the component had no such prop, so **every** list
    put a link on one cell and left the other eight columns dead.

    `Table` now takes `rowHref` and wraps the FIRST cell's content in the
    anchor, so the row's accessible name is the thing that identifies it rather
    than a bare "open". A real anchor, not an `onClick`: middle-click opens a
    tab, the keyboard reaches it in tab order, and a screen reader announces
    it — none of which a `<tr onClick>` gives, which is why the rule specifies
    the mechanism and not just the behaviour.

    THE BROKER LIST'S NAME CELL LOST ITS OWN `<Link>`. An anchor inside an
    anchor is invalid HTML that browsers resolve by silently closing the outer
    one — which would have made the rest of the row unclickable again, the
    exact bug being fixed. The phone cell gained `relative z-10`, which is the
    rule's other half: without it the stretched link covers the number and
    tapping a broker's phone on a tablet opens their detail page.

    ~~ADOPTED ON THE TWO SCREENS THE OWNER REPORTED.~~ **CLOSED — adopted
    everywhere.** The owner ruled the debt paid across the board, so loads,
    trucks, trailers, drivers, invoices, payments and settlements all took
    `rowHref`. SEVEN, not the six this flag said while listing seven — the
    miscount was in the flag, not in the ruling.

    Each cost one line plus removing the anchor the first column already had,
    and the mono face moved from that anchor onto the value it belongs to, so
    a load number and an invoice number still read character by character.
    `drivers` needed the dead zone as well: it has a `tel:` link in the row,
    and without `relative z-10` the stretched link covers the number and
    tapping a driver's phone on a tablet opens their record instead of
    dialling. The walkthrough checks the set in a loop, so a list added later
    and forgotten is named rather than merely absent.

32. **Flag 11's "minimal" left an authority uneditable and permanent.** Both
    were reachable only with SQL, which is the state that whole screen exists
    to end. The edit form is the create form with a different action and
    starting values — one form, so the strict two-letter state, the duplicate
    refusals and the FMCSA lookup cannot drift between adding and correcting.

    EVERY DUPLICATE CHECK EXCLUDES THE RECORD BEING EDITED. That is the bug an
    edit form written by copying a create form always has: saving a row without
    touching its name refuses, because its name is taken by itself. Asserted
    directly rather than assumed.

    FIELD-LEVEL AUDIT DIFFS COME FROM THE PATH, NOT FROM NEW CODE. The audited
    Prisma extension already reads the row before and after and writes
    `{ field: { from, to } }`. The test asserts the wiring — that `phone`
    appears in the diff and `name` does not — because a lib function called
    outside `withOrg` would leave an audit gap instead, and that failure is
    silent.

33. **Deactivate is the act; delete is the exception, and the difference is
    `onDelete: Cascade`.** Every child of `Company` cascades, so an unguarded
    delete of an authority that has run freight destroys its loads, invoices,
    settlements and audit trail in one statement — and reports success.

    `companyUsage` therefore counts **twenty-four relations**, not the three
    the sentence names. A check that looked at loads, invoices and settlements
    would happily cascade away an authority holding three trucks and a year of
    inspections; there is a test that builds exactly that authority. Three
    relations are deliberately not counted — `settings`, `memberScopes` and
    `auditLogs` — because they are bookkeeping this screen creates rather than
    history somebody entered, and blocking on them would make every authority
    undeletable the moment it existed.

    DEACTIVATION NEEDED NO NEW FILTERING. The topbar switcher, the create-load
    select and the Relay import already filter `isActive`, so a deactivated
    carrier leaves all three, and every load it ever ran keeps rendering it
    because those join by id. The test asserts both halves.

34. **A hidden control still ships its words, and the walkthrough caught it.**
    The remove button is absent once freight is filed under an authority — but
    the first version passed its labels to the client component anyway and
    rendered nothing, which serialised "Remove permanently" into the RSC
    payload of a page where removing is impossible. The deployed assertion
    grepped the payload and failed.

    Fixed by not sending them: the action and its four sentences are one
    optional prop, present only when removal is possible. Not a security bug —
    they are labels, not data — but it is the same discipline the money fields
    follow, and the walkthrough could not tell the difference. Neither could a
    reader.

35. **Retiring a broker with freight is refused, and the reason is the
    duplicate bug from the other side.** Retiring is already a soft delete, so
    nothing is destroyed; what it does is remove the broker from the booking
    path, and §9's create-on-miss will then cheerfully make a SECOND customer
    with the same name the next time a dispatcher types it — splitting the
    payment history the duplicate-MC refusal (flag 30) exists to protect.

        So the refusal names the counts and points at the states the schema already
        has: ON_HOLD stops new bookings while the office argues, BLOCKED is the
        first-class "do not haul for these people" BIG M II bought. Both keep the
        record findable; retiring hides it.

        THE CONTROL IS ABSENT RATHER THAN FAILING, and ~~the race still 500s~~ —
        **CLOSED.** `retireBrokerAction` now returns a `RetireState` instead of
        `void` and catches `BrokerInUseError`, so freight booked between the page
        rendering and the button being pressed prints the same sentence the screen
        would have shown — naming the broker and the counts — instead of a stack
        trace. The state type lives in its own plain module, because a `"use

    server"` file may only export async functions and the lint rule has caught
    that twice now.

        The throw in `retireBroker` is unchanged and is still the wall: the action
        translates it rather than replacing it, so a caller that is not this screen
        still cannot retire a broker with freight by accident.

36. **Step 3b was called and `corpus-amazon/` still holds only the three Step
    3a CSVs.** No `.xlsx`, no `.eml`, nothing hidden in a subdirectory, and
    nothing of either kind anywhere in the repository or in Downloads, Desktop
    or Documents. The directory's own timestamp has not moved since the CSVs
    landed on 2026-08-12.

    §3 says the parser is built "against real sheets or not at all", and the
    Phase 5 interview method needs real documents by construction: a truth
    sheet drafted from an invented spreadsheet grades a guess, which is the
    exact failure that method exists to prevent. So the step did not start,
    for the same reason and in the same words as flag 12.

    THE LAYOUT IS THE WHOLE QUESTION AND IT CANNOT BE GUESSED. A Load
    Information sheet might be a form — labels in one column, values in the
    next, one stop per block — or a table with a header row, or several sheets
    in one workbook. Merged cells, a stop count that varies by row, dates as
    Excel serial numbers versus text: every one of those changes the reader,
    and none of them can be settled by imagining the file.

37. **What DID land: workerd can open an .xlsx with no dependency, and that is
    proven rather than assumed.** An `.xlsx` is a ZIP of XML, so step 3b's
    first blocking question is whether the deployment engine can inflate one —
    and the answer changes the whole shape of the step if it is no.

    `tests/workers/zip-inflate.test.ts` runs INSIDE workerd, not Node, and
    round-trips a payload through `deflate-raw`. That argument is the point:
    ZIP entries are stored with method 8, which is headerless raw DEFLATE, and
    `new DecompressionStream('deflate')` expects a zlib header and fails on a
    ZIP member. Testing through `nodejs_compat`'s `zlib` would have proven
    nothing about the deployed Worker's own primitives. `DataView` is there for
    the central directory's byte offsets, which is the other half.

    SO NO SHEETJS AND NO DEPENDENCY. A minimal reader — unzip, then pull
    `sharedStrings.xml` and the sheet XML — is a few hundred lines and matches
    the fetch-only, no-SDK posture `claude.ts`, `gemini.ts` and `fmcsa.ts`
    already hold. Recorded now so the decision is made in daylight rather than
    at the moment somebody wants a parser working.

38. **A Relay booking email pasted into production returned a bare 500, and
    the cause was a model call inside a database transaction.** Reproduced on
    dev under `wrangler tail`, which named it in full:

    > Transaction API error: A query cannot be executed on an expired
    > transaction. The timeout for this transaction was 60000 ms, however
    > 61858 ms passed since the start of the transaction.

    The extract route held an interactive transaction open across the HTTP call
    to Gemini. Gemini was answering 503 "This model is currently experiencing
    high demand", the seam fell back to Claude, Claude answered 529
    "Overloaded", and the retries outlived the lock. The Prisma error that
    produced is not a `ClaudeError`, so nothing recognised it and the route
    rethrew it into an empty response.

    **RAISING THE CEILING WOULD HAVE BOUGHT A SLOWER FAILURE.** Measured after
    the fix, the same paste takes 38–53 seconds against a busy model — which is
    to say the old 60-second budget was not generously sized, it was a coin
    toss. Phase 5 flag 31's rule was "fewer statements inside the lock, not a
    longer lock"; this is that rule one step further, because a third party's
    latency has no business inside a Postgres transaction at any number.

    So `rate-confirmation.ts` is three functions where it was one:
    `beginExtraction` claims the row and marks it PROCESSING in a short
    transaction, `askForExtraction` calls the model and parses with NOTHING
    open, and `recordExtraction` writes what came back in a second short one.
    The two old entry points are gone rather than kept as wrappers — a wrapper
    that rejoined them would be a trap for the next caller.

39. **The bare 500 was the second defect and the one that hid the first.** The
    route caught auth errors and rethrew everything else, which Next turns into
    a 500 with an EMPTY body — so the client's `messageOf` had nothing to read
    and said "Request failed (500)". The worker knew exactly what had happened
    and said none of it.

    Nothing leaves that route without a sentence now, the detail goes to
    `console.error` where `wrangler tail` can reach it, and an expired
    transaction gets its own 503 `too_slow` — because "the model was slow" and
    "this file cannot be read" deserve opposite advice.

40. **A third defect nobody reported: the dispatcher was being shown the
    vendor's JSON.** When the extraction DID fail in a handled way, the client
    printed `body.message` verbatim, so a paste during the outage read
    `Gemini returned 503: {"error":{"code":503,...,"status":"UNAVAILABLE"}}` off
    the screen. A stack trace in a nicer font: it names a vendor, it is
    untranslated in a three-language product, and §10 asks an error to say what
    happened AND what to do.

    The reason CODE now picks the sentence — the codes are ours and finite —
    and the upstream detail goes to the browser console. The walkthrough
    asserts both halves: no `Request failed (NNN)` and no vendor JSON on that
    screen, ever.

41. **THE EXTRACTION INTEGRATION SUITE HAD BEEN RED SINCE THE ENGINE SWITCH
    AND NOTHING SAID SO.** Found while proving the refactor: four of the seven
    tests in `tests/integration/extraction.test.ts` were already failing before
    a line was changed. The stub still returned Anthropic's response shape —
    `content[].text`, `usage.input_tokens` — while `EXTRACTION_MODEL` became
    `gemini-3.6-flash`, so `askModel` routed to Gemini, which said "returned no
    text" every time.

    THE REASON IT WENT UNSEEN IS THE PART WORTH KEEPING: `npm run check` runs
    the node and workers projects and NOT the integration project, which needs
    a database. So the gate everybody runs was green while the suite that
    exercises the shipped engine was not. A suite outside the gate reports on
    nothing.

    Fixed by giving the stub the shipped engine's shape and correcting the cost
    expectations to Gemini's 150/750 per Mtok — including that the two sides
    are rounded before they are summed, which is 1,292 and not 1,291.

42. **Step 4 needed a SECOND worker, and that is Cloudflare's constraint rather
    than a preference.** Email Routing delivers only to a Worker with an
    `email()` handler; the application's worker is generated by OpenNext and
    exports a `fetch` handler it owns. Bolting a mail handler onto generated
    output survives exactly until the next OpenNext upgrade.

    It is the right shape anyway. `workers/email/` holds no database binding,
    no Prisma client and no secret but the bearer token it forwards — it parses
    MIME and posts JSON. Which tenant the mail belongs to, whether it is a
    duplicate, what the reader makes of it and what the office is told are all
    decided in the application, where RLS, permissions and the audit trail
    already live. A mail worker that knew about tenants would be a second place
    tenancy is decided.

43. **`postal-mime` is a dependency, and flag 37 said no to one.** The
    difference is worth stating because the two look alike. An `.xlsx` is a
    ZIP: a documented byte layout, a few hundred lines, and a wrong answer
    fails loudly — so no SheetJS. MIME is nested multipart, RFC 2047 encoded
    headers, quoted-printable, base64 and per-part charsets, and a subtly wrong
    parse does not throw, it silently mangles a booking. `postal-mime` is
    purpose-built for this runtime and has NO dependencies of its own, which is
    the condition the no-SDK rule actually cares about.

44. **THE TENANT COMES FROM CONFIGURATION BECAUSE RLS WILL NOT ALLOW A LOOKUP,
    and that is the boundary working.** `Organization`'s own policy is
    `id = current_setting('app.current_org_id')` — no connection can find a
    tenant it has not already been told about. So there is no query that
    resolves a recipient address to an organization without first weakening the
    one rule this schema is built on.

    `INBOUND_EMAIL_ORG_ID` names the tenant and the scoped read CONFIRMS it:
    the organization must actually claim the address the mail arrived at.
    Config alone is a claim; config plus the check is an agreement between two
    places that have to be changed together.

    WHEN A SECOND TENANT WANTS AN INBOX this becomes a routing table outside
    RLS, beside `User` and `Session`, exactly as `auth-db.ts` documents. Not
    built now: there is one tenant, and a router with one route gets its first
    real exercise on the day it matters.

45. **Mail is written `unattributed`, and that is the truth about it.**
    `withOrg` requires attribution precisely so forgetting is impossible, and
    inbound mail has no session — a stranger sent a message and a mail server
    delivered it. The existing escape hatch fits without being bent: typed out,
    reason carried into the audit log, greppable.

    The lint rule banning `withOrg` inside `src/app` caught the first draft. The
    fix was the one `auth-db.ts` already prescribes — the exception lives in one
    lib file with one comment, and the rule stays absolute.

46. **A booking email is not a Load in a draft state, deliberately.** Adding
    DRAFT to `LoadOperationalStatus` would put unconfirmed, machine-read
    freight into every query that already exists — the dispatch board,
    ready-to-invoice, settlement lines, the load-number counter — and every one
    would have to learn to exclude it. One forgotten filter and a draft nobody
    has read is on an invoice.

    So `InboundEmail` is its own table and the states come from
    `loadWarnings` — the create form's own checks, which is what the brief's
    "from real validation results, not vibes" asks for. The duplicate family
    (BOL, PO, broker reference, probable-duplicate) is the CONFLICT family,
    because each one means this booking may already BE a load.

47. ~~**WHAT STEP 4 DOES NOT YET DO**~~ — **MOSTLY CLOSED; see flag 48 for
    what is left.** The
    pipeline runs end to end in code — mail in, parsed, read, checked, queued —
    and none of the following is built:
    - **Opening a row does not prefill.** The Incoming list links to
      `/loads/new?from=<id>` and the create form does not read that parameter
      yet, so a dispatcher lands on an empty form. This is the single biggest
      remaining piece and it is what makes §1.1's "queue of unfinished forms"
      true rather than aspirational.
    - **No confirm or dismiss.** `CONFIRMED` and `DISMISSED` exist in the enum
      and nothing writes them, so nothing leaves the queue.
    - **The raw message is not stored.** `rawR2Key` and `rawBytes` are columns
      with nothing writing them, so spec §12's "open the original" has no
      original to open. Attachments are read and then dropped rather than kept
      as Documents.
    - **Nothing has been proven against a real message.** No DNS, no routing
      rule, no secret — the account steps in the README are the owner's and
      have not been run. Every test here is against constructed input.
    - **Thread matching and update detection (§13, §14) are Step 5** and are
      untouched.

48. **The queue is a queue of unfinished forms now, and it was proved end to
    end.** Flag 47's list is closed except for the one item that needs an
    account setting:
    - **`?from=` prefills** through the same `Prefill` shape an upload
      produces — the form cannot tell a draft from a PDF, which is how §1.1's
      "no second editing surface" is enforced rather than merely intended. The
      money strip happens on the SERVER, by role, exactly as
      `/api/documents/[id]/extract` does it for uploads.
    - **Confirm is the ordinary Save.** There is no confirm button, because
      §1.1 forbids the surface one would live on: booking the load IS
      confirming the email, and the draft closes in its own transaction after
      the load exists. A queue that failed to update must not roll back
      freight somebody just booked.
    - **Dismiss** writes DISMISSED with the person and the moment, and keeps
      the message, the extraction and the original. Gated on `load:update`
      rather than `delete`, because nothing is destroyed.
    - **The original is real.** The `.eml` lands in R2 under
      `{org}/inbound/{id}/message.eml` and a route serves it back behind the
      session — deliberately NOT a presigned URL, which is a bearer capability
      that outlives the click. Attachments land beside it.

    STILL OPEN: **attachments are not `Document` rows.** `Document.companyId`
    is required and an inbound email has no authority — which one it belongs to
    is decided on the create form, where authority is field 1. The bytes are in
    R2 waiting to be claimed at confirm; wiring that claim is a separate piece.

49. **The proof, and precisely what it does not cover.** Email Routing is not
    enabled on `zebratms.com` — `nslookup -type=mx` returns nothing — so the
    delivery hop cannot be exercised by anyone but the owner. Everything either
    side of it now is:
    - `tests/workers/email-parse.test.ts` parses a REAL forwarded booking
      inside workerd, two MIME boundaries deep, with quoted-printable and a
      nested `message/rfc822`. That is the hard case and the one that will
      arrive first, since spec §15 says manual forwarding must work
      identically. A parser that only read the top-level text part would hand
      the reader "Booking below, please book it." and produce a draft with no
      lane, no times and no money — looking exactly like a message the model
      failed on.
    - `scripts/verify-inbound-email.mjs` posts the payload the worker sends,
      field for field, and follows it through: read, stated, queued, original
      downloadable, form prefilled, Save books load **#1174** and closes the
      draft with attribution. 15/15 on dev.

    THE GATE FIRED ON THE WAY THROUGH AND THAT IS THE FINDING. The draft
    reached Save and was warned — "No pickup date, so this load will not appear
    on any screen that sorts by one" — because a Relay booking carries times
    with no year. A dispatcher confirms past it, which is what routing drafts
    through the ordinary form is FOR: the checks are not skipped because the
    freight arrived by machine. The first version of the script clicked Save
    once and reported failure; the script was naive, not the product.

50. **THE PRODUCTION-BRANCH GUARD WAS CHECKING A STICKER ON THE BOX.**
    `deploy:prod` was run in a ritual terminal carrying a production
    `DIRECT_DATABASE_URL`. The gate's integration suite ran, wrote fixtures to
    production, failed 237 of 405, and refused the deploy — nothing shipped.
    `tests/setup.ts` said nothing the whole time.

    IT SAID NOTHING BECAUSE IT WAS ASKING THE WRONG QUESTION. The guard was
    `if (process.env.NEON_BRANCH === 'production') throw`. `NEON_BRANCH` is a
    LABEL: nothing derives it from a connection, nothing enforces it, and it is
    not what decides where a write lands. The two connection strings are.

    THE SPLIT-BRAIN SHAPE IS THE PROOF, and it names the mechanism exactly:

    | path     | client                                | went to    |
    | -------- | ------------------------------------- | ---------- |
    | fixtures | `retryingClient(DIRECT_DATABASE_URL)` | production |
    | the app  | `prisma` → `DATABASE_URL` (from .env) | dev        |

    Only ONE of the pair was overridden, so organizations were created on one
    database and looked for on the other — "missing their own rows" —
    child inserts on dev referenced `organizationId`s that existed only on
    production, which is the foreign-key violations, and reset tokens written
    one side came back null from the other. Every reported symptom follows from
    that single table.

    THE REPLACEMENT DOES NOT ASK ABOUT LABELS. `tests/db-target.ts`: the two
    URLs must name the same Neon endpoint, with the `-pooler` suffix folded
    away because the pooled and direct doors of one endpoint are legitimate.
    That is true of every correct configuration and false of every way this
    goes wrong, including ways nobody has thought of. The old label check is
    KEPT as well — worthless alone, still worth honouring when set honestly.

    Proven by running the suite with the incident's own environment: it now
    aborts with **no tests run**, where the incident ran 237.

51. **The gate no longer inherits the terminal at all.** Scrubbing beats
    checking: `deploy.mjs` DELETES `DATABASE_URL`, `DIRECT_DATABASE_URL` and
    `NEON_BRANCH` from the child's environment, so `.env` — read through
    dotenv, which does not override — is the only possible source. A
    terminal's leftovers cannot aim the gate at anything, and it says out loud
    which variables it ignored and which endpoint it will write to.

    And it checks `.env` itself afterwards, because scrubbing says nothing
    about whether the file is pointing somewhere dangerous.

52. **What could not be swept from here, and why.** No production connection
    string exists on this machine — `.env`, `.next/standalone/.env` and the
    OpenNext copy all name the dev endpoint, and the production string lives
    only in the owner's ritual terminal and in Cloudflare secrets. So the
    production sweep is `scripts/sweep-test-rows.mjs` and the OWNER runs it.

    Read-only by default, `--delete` needs `--yes`, and it prints the host it
    is talking to before anything else — because not knowing that is the entire
    incident. The signature is exact rather than heuristic: `.test` is reserved
    by RFC 6761, so no real person has an `@example.test` address, and the slug
    prefixes are harvested from the suites and anchored with their separator so
    `loads-` cannot match a tenant called `loads`.

    RUN AGAINST DEV AS A REHEARSAL, it found **zero fixture organizations** —
    the suites' `afterAll` cleanup does run, and it uses the same owner client,
    so most of what the incident created on production was probably removed on
    the way out. Probably is not a report; the owner's run is.

53. **The invoices failure was collision, and the aborted run proved it by
    leaving evidence.** Two full runs at HEAD passed that file — 6/6 alone and
    405/405 in a complete suite — while my own runs were hitting the same dev
    database as the owner's gate. `fileParallelism: false` exists because the
    files "mutate shared tables"; two RUNS at once breaks that harder, and the
    first invoices assertion is `numbers it from the counter`, which is exactly
    what fails when something else is allocating numbers underneath it. Logged
    as collision, not a regression from the inbound-email work — that work
    touches no table `invoices.test.ts` reads.

    AND THE ABORT LEFT ITS OWN TRAIL. Killing vitest mid-file means `afterAll`
    never runs, so the stopped gate left `iso-A-tfrnkvpd` and `iso-B-tfrnkvpd`
    in dev with half-built fixtures. Those orphans then failed FOUR whole-
    database integrity checks in `npm run check` — trailers whose `companyId`
    disagreed with a missing open period, and payment, billing and settlement
    drift. `check` had been green all day; the orphans arrived with the abort.
    `scripts/sweep-test-rows.mjs` found them by name and cleared them, and
    `check` returned to green at 873.

    THE LESSON IS ABOUT THE INTEGRITY TESTS, NOT THE ORPHANS. They read the
    whole database on the owner connection with RLS bypassed, so they see every
    tenant — including wreckage from an interrupted run. That is a feature: an
    aborted suite now announces itself the next time anybody runs `check`.

54. **The suite costs 54 minutes, measured, and a receipt is what makes that
    affordable.** 405 tests, 3254 seconds, on the owner's machine. Every
    earlier claim in these reports that the gate ran "in minutes" was
    impression rather than measurement, and is corrected here.

    Where it goes: 26 files strictly serial, audited writes costing four round
    trips each (`SAVEPOINT / write / audit insert / RELEASE`), and fixtures
    dominating — `fleet.test.ts` does 67 creates in `beforeAll` alone, roughly
    268 round trips before a single assertion.

    So a green run may now stand in for a re-run, under four conditions that
    each close a specific hole: same commit, tree clean both when it ran and
    now, same endpoint, under an hour old. **The stamp is the FINISH of the
    run** — the owner's constraint, and obvious once said: timestamping the
    start of a 54-minute suite against a 60-minute window leaves six usable
    minutes.

    NOT COMMITTED, so a receipt cannot travel between machines or be reviewed
    into existence. `--skip-integration` earns none — there is deliberately no
    path from "I did not run it" to "it was run". One launcher
    (`scripts/integration-gate.mjs`) serves both `npm run test:integration` and
    the deploy, because two launchers would be two answers to "where does this
    write", which is the question the whole incident was about.

    PARKED BY THE OWNER: raw-SQL fixtures are the next session's lever, and
    file parallelism stays parked until production has the email pipeline.

55. **Twelve suites were running on Prisma's 5-second default, and one of them
    killed a gate run.** `claims.test.ts` set `maxWaitMs` and no `timeoutMs`:

    > Transaction API error: A commit cannot be executed on an expired
    > transaction. The timeout for this transaction was 5000 ms, however
    > 17923 ms passed since the start of the transaction.

    Not a regression and not collision — that run was alone. One audited write
    costs four round trips (SAVEPOINT, write, audit insert, RELEASE) and at
    ~200ms to us-east-2 a handful is past five seconds with nothing wrong.
    `LOAD_WRITE_TIMEOUT_MS` has carried that arithmetic since Phase 5: 5s is
    about 24 statements from here.

    SEVEN SUITES ALREADY HAD IT, which is the tell. Each had hit this and been
    fixed alone, so the rule lived in nobody's head and every new file started
    exposed again. All nineteen now point at the constant — including
    `relay-import.test.ts`, which was the one holdout hardcoding `30_000`, so
    its budget TIGHTENED from 30s to 20s as a side effect. Worth watching.

    `tests/transaction-budget.test.ts` is the rule written down: every suite
    with an `inOrg` helper must set `timeoutMs`, and must set it to the
    CONSTANT rather than to a number, because nineteen files holding `20_000`
    would be nineteen places to change when the link moves. Watched failing —
    removing one file's line fails two tests by that file's name.

56. **DEBT, for the raw-SQL fixtures session: nineteen copies of `inOrg`.**
    Every integration suite defines its own three-line helper wrapping
    `withOrg` with its own attribution string and its own `maxWaitMs` — which
    still varies (15s in loads, 20s everywhere else) for no recorded reason.
    That duplication is exactly why the timeout rule could be true in seven
    files and false in twelve.

    NOT CONSOLIDATED NOW, by the owner's instruction, and the instinct is
    right: a shared helper touching nineteen files belongs in the session that
    is already rewriting how fixtures talk to the database, not in a session
    whose job is to earn one green run.

57. **THE INTEGRATION GATE WAS SKIPPED ONCE, ON 2026-08-15, DELIBERATELY.**
    `npm run deploy:prod -- --skip-integration`, version `fd08dcc3`.

    REASON: the deployed code was byte-identical to `f46e048`, which had a
    405/405 integration run behind it that morning. The entire delta was one
    environment variable — `"INBOUND_EMAIL_ORG_ID": ""` becoming
    `"cmsbsc82y0000nsvsa6yffuyh"`:

    ```
    wrangler.jsonc | 2 +-
    1 file changed, 1 insertion(+), 1 deletion(-)
    ```

    The suite does not read that variable, so a 55-minute run would have
    re-proven the same code against the same database to authorise a value it
    never touches.

    THE OWNER RULED IT AND BOUNDED IT: the diff had to be shown before the
    deploy and had to touch `wrangler.jsonc` and nothing else, the exception
    had to be written here, and IT DOES NOT GENERALISE — the next change with
    code in it goes through the gate or a valid receipt. Recorded so that the
    next person to want a skip argues against a precedent that says "vars
    only, diff shown first" rather than against nothing.

    NO RECEIPT WAS WRITTEN, as designed: `--skip-integration` runs no suite
    and earns no proof. The receipt left on disk was the morning's, and it
    refuses itself — `wrong_commit: that run was f46e048; HEAD is b740bc5`.

    THE RULE HAD A BUG AND HAS BEEN RESTATED. As first written it required the
    diff against the last deployed commit to show `wrangler.jsonc` and nothing
    else — which collided with the requirement, one clause earlier, that the
    exception be logged in this file. Logging it put `PHASE-6-BRIEF.md` in the
    range and made the next skip unrunnable by its own terms. THE STANDING
    FORM:

    > The diff against the last deployed commit must contain no DEPLOYABLE
    > change beyond the stated config. Documentation and this brief are
    > excluded by name, because markdown does not ship.

    A SECOND EXCEPTION WAS TAKEN THE SAME DAY under that form, version
    `e80e2e9f`, moving `R2_ENDPOINT` and `R2_ACCOUNT_ID` from secrets to vars
    (flag 61):

    ```
    PHASE-6-BRIEF.md | 138 +++++++++++++++
    wrangler.jsonc   |  14 ++++
    2 files changed, 152 insertions(+)

    excluding markdown:
    wrangler.jsonc   |  14 ++++
    ```

    Twelve of those fourteen lines are comment; two are values. Still vars
    only, still no code, and STILL DOES NOT GENERALISE.

58. **THE BYTES CHANGE BETWEEN RETRIES. THE MESSAGE-ID DOES NOT.** Measured,
    not reasoned: one message, three deliveries, `wrangler tail` on both
    workers.

    ```
    attempt   time       gap        size
    1         10:32:50   —          59591
    2         10:39:18   6m 28s     59591
    3         11:00:06   20m 48s    59592
    ```

    ONE BYTE LARGER ON THE THIRD — the sender rewriting a trace header on its
    way back out. The Message-ID was identical every time.

    SO A CONTENT HASH WOULD BE A BROKEN IDEMPOTENCY KEY. Hashing the raw
    `.eml` is the obvious alternative to trusting a header anyone can forge,
    and it would have booked this message twice: once for the 59591-byte
    copies and once for the 59592-byte one. The bug would surface only on
    retry, which is to say only on the day the mail path is already
    struggling. `emailByMessageId` keys on the Message-ID and holds. Anything
    added later — including the persist-before-202 fix — keys on the same
    thing.

    THE RETRY IS THE SENDER'S, NOT OURS. A thrown `email()` handler hands the
    decision back up: Cloudflare returns a temporary failure and the sending
    MTA decides what happens next. The 6.5-then-21-then-27-minute curve is
    Gmail's; the message was accepted on attempt 4 after 54 minutes. A broker
    on another provider gets a different curve, and a badly configured one
    might give minutes. **Our retry budget is somebody else's policy** — which
    is the strongest argument for persisting before the 202 rather than
    relying on redelivery.

59. **THE DAY'S ONE FINDING, IN THREE COSTUMES: A PRODUCTION COMMAND THAT
    DEFAULTS TO DEV AND READS AS SUCCESS.** Three separate near-misses on
    2026-08-15, and they are the same bug:
    - `psql "$DIRECT_DATABASE_URL"` in the step 4 runbook. Run from this
      repository's own terminal it resolves to DEV, prints `UPDATE 1`, and
      leaves production untouched while dev quietly claims
      `loads@zebratms.com`.
    - Flag 50's migrate command, which is where the production-pointed test
      run came from. Same variable, same silence.
    - `npx wrangler secret put R2_ENDPOINT` without `--env production`, which
      writes to `zebra-dev` and prints success either way.

    EACH ONE SUCCEEDS LOUDLY WHILE DOING NOTHING. That is what makes this a
    class rather than three mistakes: the failure is indistinguishable from
    the fix, so the only way to learn the truth is to exercise production and
    read a log.

    THE RULE: a production-touching command must name its target explicitly,
    or be impossible to run against the wrong one. A variable a dev terminal
    already has is not a target — it is a coin flip that reports heads.

60. **DEBT, AND NOT COSMETIC: the receipt records no proof that anything
    ran.** `writeReceipt` accepts `{ tests, files }` and
    `integration-gate.mjs` calls it with neither, so every receipt carries
    `"tests": null, "files": null` — fields designed for exactly this and
    never wired.

    WHICH MEANS THE ONLY CONDITION FOR EARNING ONE IS `result.status === 0`.
    A vitest invocation matching ZERO test files also exits 0, in seconds,
    and would earn a full hour of deploy authority having proven nothing.
    That is the failure `tests/isolation-coverage.test.ts` exists to prevent
    one level down: "no failures" and "no tests" are indistinguishable from
    outside, and the comfortable reading is the wrong one.

    NOTICED BECAUSE A RECEIPT'S TIMESTAMP MOVED. The run finished `00:40:53Z`;
    the file later read `00:49:47Z` — same commit, same endpoint, nine minutes
    later, with no 55-minute suite between. `deploy.mjs` never calls
    `writeReceipt`. What earned that stamp is NOT ESTABLISHED. It is moot now
    (the receipt refuses itself on `wrong_commit`) but it is unexplained, and
    an unexplained receipt is the thing the mechanism exists to make
    impossible.

    The fix is to record counts and refuse a receipt below a floor. Not built
    in this session.

61. **R2 HAS NEVER WORKED ON PRODUCTION, AND A SECRET IS WHY IT TOOK THIS
    LONG TO SEE.** Both inbound messages recorded their rows and their
    readings and then failed identically:

    ```
    [zebra.inbound] could not keep the original for
      cmsuj4nt40000psp77ig13iwz: Invalid URL string.
    ```

    `new URL()` on the composed `${endpoint}/${bucket}/${key}`.
    `r2ConfigFromEnv()` did not throw its own "missing" error, so every value
    was present — one of them simply was not a URL.

    THE ROUTE DEGRADED EXACTLY AS WRITTEN: the mail was not lost, the row was
    kept, `rawR2Key` stayed null, and a named line went to `wrangler tail`
    instead of a 500 that Cloudflare would retry forever. That design held.

    BUT A SECRET'S VALUE CANNOT BE READ BACK, so a re-put could not be
    verified — the only way to tell a fixed value from an unfixed one was to
    send another email and read the log, which is what happened, and it was
    still broken. `R2_ENDPOINT` and `R2_ACCOUNT_ID` are therefore now VARS:
    the account id is printed by `wrangler whoami` and the endpoint is derived
    from it, so neither protects anything, while living in `wrangler.jsonc`
    makes both diffable, reviewable, deployed with the code, and immune to
    flag 59's missing `--env`. `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`
    stay secrets; they are the actual credentials.

    THE BLAST RADIUS IS EVERY R2 CALL, not just the email original.
    `r2ConfigFromEnv()` is the single door for document upload, download and
    presigned GET. A system whose job includes storing BOLs and PODs had no
    working object storage in production, and nothing said so until a mail
    worker started shouting into a log somebody was watching.

62. **DEBT, small and sharp: prettier is not idempotent on unfenced tabular
    data inside a list item.** A run-on line that wraps to column 0 terminates
    its list item; what follows is then read as an indented code block, and
    every `--write` pass indents it four spaces further. `npm run check` goes
    red and stays red, and the diff looks like the formatter is fighting
    itself rather than like a broken line above it.

    THE RULE: tabular data in this repository's markdown gets FENCED, not
    indented. It cost a commit that went in without `check` behind it —
    `663dbe8` — which is also the reminder that a docs-only commit is still a
    commit and still runs the gate.

63. **THE 202 IS NOW EARNED, AND IT COST A FIFTH TABLE WITHOUT A WALL.** The
    `no_tenant` path answered 202 and threw the message away with a
    `console.warn`. The 202 itself was right and stays — a 4xx makes Cloudflare
    retry mail that can never route, a bounce tells a stranger which addresses
    exist — but it is an ACKNOWLEDGEMENT: the sending server marks the message
    delivered and stops. "Delivered" and "exists nowhere" were true at once.
    Harmless while nothing could reach the endpoint; a way to lose freight from
    the moment Email Routing went live on 2026-08-15.

    `UnroutedEmail` holds it, keyed on the Message-ID because flag 58 measured
    the bytes moving. The row is required — a failure answers 503 so the worker
    throws and the sender keeps the message — while a failure to store the
    `.eml` is logged and survivable, because by then the row exists and asking
    a stranger's mail server to redeliver what we have kept would be worse.
    Redelivery creates nothing and retries an original an outage lost.

    THE PRICE, WRITTEN DOWN RATHER THAN BURIED: it is the fifth table outside
    row-level security, and the first that is not about authentication. It
    cannot carry a tenant — a row is there BECAUSE "whose is this?" was
    answered no, so `org_isolation` could never be satisfied by the connection
    that has to write it. Mail from strangers therefore sits in a table with no
    wall. It is write-only from one endpoint and no route reads it. WHEN FLAG
    44'S ROUTING TABLE ARRIVES this becomes tenant-scoped and leaves the exact
    list in `tests/structure.test.ts`.

64. **THE THREE-WAY PAYLOAD CORRESPONDENCE IS A CONTRACT NOW, NOT A MEMORY.**
    The mail worker built a bare object literal, the route declared its own
    interface, and `verify-inbound-email.mjs` — the only thing that ever proved
    the pipeline end to end — hand-copied "the payload the worker sends, field
    for field". Renaming a field passed `tsc`, passed the verify script, and
    failed only on real mail.

    One declaration in `src/lib/inbound-email-payload.ts`; the worker imports
    it type-only, so it is erased at build and the worker carries a contract
    and no runtime weight. The `.mjs` copy cannot be typed, so a field list
    covers it — and the list is PROVED against the interface by two conditional
    types rather than maintained beside it, because a list maintained beside a
    type is a fourth copy.

    WHAT IT STILL CANNOT CATCH: `zebra-email` and `zebra` are separate
    deployments. The source can be consistent while production runs two halves
    from different commits. Only deploying both catches that, which is why the
    runbook says to.

65. **A GUARD WITH NO ROOM IN IT GETS CUT OPEN UNDER DEADLINE.**
    `transaction-budget.test.ts` demanded exactly `LOAD_WRITE_TIMEOUT_MS`,
    which forbade a justified override — and the person who needs one at 2am
    will not add a hatch, they will delete the assertion. The rule is now "an
    imported identifier".

    THE IMPORT IS THE LOAD-BEARING HALF. `const SETTINGS_TIMEOUT_MS = 30_000`
    at the top of a suite satisfies "use a named constant" while being a bare
    literal wearing a name, and puts the number back in nineteen possible
    places. Requiring it to come from a shared module gives an override one
    home, one written reason, and one edit to change it.

66. **A SUSPECTED ENDPOINT COLLISION HALTED A RUNNING SUITE, AND THE HALT WAS
    RIGHT EVEN THOUGH THE SUSPICION WAS WRONG.** 2026-08-15: the owner saw
    `ep-little-lake` copies where production was expected and called a stop
    mid-run. It resolved to a Connect dialog left on the wrong branch —
    production is `ep-proud-union-ayxlcytw`, dev is `ep-little-lake-aydu7faj`,
    and the gate's own first line had said `ep-little-lake` all along. Sixty
    minutes of runtime and a swept fixture org is what the caution cost;
    flag 50 is what not calling it costs.

    THE RUN TIMES ARE NOT A CONTENTION SIGNAL, AND AN EARLIER VERSION OF THIS
    FLAG SAID THEY WERE. Corrected here rather than quietly deleted, because
    the wrong version was written with the same confidence as the right one.
    Four full runs of the same 405 tests, with what was actually alongside
    each — the last column known only after flag 72 was closed:

    ```
    3288.63s   green   nothing alongside it
    3313.85s   green   A FULL PARALLEL SUITE, for ~45 of its 55 minutes
    3839.86s   RED     one brief migrate-status connection
     (owner's) RED     the 3313.85s run, alongside it the whole time
    ```

    THE 3313.85s RUN WAS CONTENDED BY AN ENTIRE SECOND SUITE and finished 25
    seconds off the uncontended baseline, green. The 3839.86s run was
    contended by a single short connection and lost 551 seconds and two
    tests. Duration does not track contention, so "a run past ~55 minutes
    should have its failures suspected" — which this flag previously asserted
    — is unsupported and withdrawn.

    WHAT THE PAIR DOES SHOW is that damage from two parallel suites is
    ASYMMETRIC: of the two running together, one was green and on time while
    the other lost `companies.test.ts` to a dropped pooler socket. Whoever
    loses the connection loses the run, and neither is slowed predictably.
    The mechanism behind the 38-second stall remains unestablished, and now
    so does the slowdown itself.

    A GREEN RUN UNDER CONTENTION IS STILL GREEN. Contention manifests as
    dropped sockets, which fail tests; it does not invent passes. The receipt
    that authorised `d09f001` was earned during that parallel window and is
    not weakened by it.

67. **VISIBILITY BEFORE RETENTION — AN ORDERING, NOT A PREFERENCE.** The
    drift-script line — `N unrouted, oldest <date>`, silent at zero — ships
    BEFORE any purge is enabled. A purge running while the table has no reader
    shreds the only copy of something no human ever saw. **The invisible pile
    is recoverable; the invisible shredder is not.**

    IT INVERTS THE NATURAL BUILD ORDER, which is why it needs writing down.
    Retention is the tidier, more satisfying piece of work and the one anybody
    would reach for first. Only this sentence explains why it waits.

    THE SCRIPT, NOT THE DASHBOARD, FIRST. `UnroutedEmail` sits outside
    row-level security, so a dashboard count means deciding WHICH TENANT sees
    mail belonging to no tenant — a permission decision, which by standing
    rule can only be made in `src/lib/permissions.ts`, on a resource that does
    not exist. A drift-script line has no route, no permission surface and no
    RLS question. The dashboard count arrives with flag 44's screen, when
    there is a tenant to attribute it to.

68. **RETENTION: 90 DAYS, revisited when flag 44's screen makes unrouted mail
    visible and actionable.** The reasoning travels with the number, because a
    bare 90 gets "tuned" by whoever finds it: this is a safety net for
    misdirected bookings, and a booking nobody has missed in a quarter is
    dead.

    PURGE ORDER: object first, then row — or record what was deleted.
    `rawR2Key` exists ONLY on the row, so deleting rows first orphans bytes in
    R2 that nothing can ever name again. DELETION IS LOUD IN AGGREGATE
    (`purged 12 unrouted messages older than 90 days`) rather than a silent
    cron, or an invisible pile has merely been replaced by an invisible
    shredder.

69. **RATE LIMITING IS ABUSE CONTROL, NOT HOUSEKEEPING, and gets its own
    flag.** `UnroutedEmail` is the only table in this system whose write rate
    is set by the outside world: anyone who emails a routed address causes a
    row and an R2 object. `fmcsa-gate.ts`'s sliding window is the pattern when
    it is built.

    IT MATTERS MORE THE DAY THE ADDRESS IS PUBLISHED, because that is the day
    the write rate stops being ours. Today `loads@zebratms.com` is known to
    one carrier group and four test messages.

70. **A COMMIT TOUCHING THE SHARED PAYLOAD CONTRACT DEPLOYS BOTH WORKERS.**
    `zebra` and `zebra-email` ship from two different commands, so the source
    can agree with itself while production runs two halves from different
    commits — the one thing flag 64's contract cannot catch.

    TONIGHT QUALIFIED AND WAS ALSO THE EASY CASE: `c07e9e0` touched
    `workers/email/index.ts`, but only with an `import type` and an
    annotation, both erased at build, so the emitted bundle was unchanged and
    the deploy only aligned versions. THAT IS THE ARGUMENT FOR THE RULE RATHER
    THAN AGAINST IT — knowing the deploy was a no-op required knowing the
    change was type-only. The next contract edit will not be, and "deploy
    both" removes the need for anyone to make that judgment correctly under
    time pressure.

71. **A COMMIT NEVER CHAINS AFTER `check` WITH `;` — ONLY `&&`. IT BIT TWICE
    IN ONE NIGHT.** `663dbe8` went in without `check` behind it at all;
    `07f0501` went in while `check` was RED, because the command chained the
    commit after the gate with a semicolon. That runs the commit whatever the
    exit status, and the failure scrolls past above a successful-looking
    commit line.

    BOTH TIMES THE CONTENT WAS FINE, WHICH IS THE TRAP. `663dbe8`'s red was a
    markdown formatting break; `07f0501`'s was contention from a concurrent
    suite, and it certified green the moment dev was quiet. A rule that only
    bit when the code was also wrong would have been learned the first time;
    this one has to be followed while it is costing nothing.

    THE RULE: `&&`, always, between a gate and a commit. `;` is for commands
    whose failure genuinely does not matter, and a gate is never one of them.
    It proved itself on its first outing minutes later, when a prettier
    instability stopped the very commit that recorded it.

72. **AN INTEGRATION SUITE RAN ON DEV THAT NOBODY STARTED, AND THE CAUSE IS
    OPEN.** 2026-08-15, roughly 21:30 local: a bare `vitest` integration run
    appeared against `ep-little-lake` while the tree was being edited. It
    created and cleaned up its own fixtures — `iso-counter-6awlaz`, then
    `warnings-x8bedk` — and finished on its own.

    WHAT IT WAS NOT, established rather than assumed. It was not a deploy:
    `deploy.mjs --production` reaches production only through
    `runIntegrationSuite()`, which writes the receipt on success, and the
    receipt was untouched at `d09f001` / `21:25:19Z` throughout. It shipped
    nothing: the production deployment list shows `11c75a52` (`d09f001`,
    21:28Z) still live with nothing after it, so `07f0501` never reached
    production. And it was not the VS Code Vitest extension on auto-run,
    which is not installed — no `vitest`, `autoRun` or `watch` keys in user
    settings, and no `.vscode` in the repository.

    CLOSED, BY THE OWNER, AND IT WAS A DEPLOY AFTER ALL. A production deploy
    carrying the migrations-applied flag was run at 16:40:46, before any
    receipt existed. The flag satisfied the migration check, the missing
    receipt meant the gate started the suite itself, and the window was left
    unwatched. It ran ~45 minutes alongside the 16:30 run, finished RED at
    404/405 around 17:36 on `companies.test.ts` with a dropped socket to the
    pooler, refused to deploy, and wrote no receipt. Production was untouched
    throughout, exactly as the receipt and the deployment list said.

    THE INFERENCE WAS RIGHT AND THE REASONING WAS WRONG. "No deploy parent"
    was concluded from an untouched receipt and an unchanged deployment list.
    Both facts were true; the conclusion did not follow. A deploy whose gate
    goes red writes no receipt and ships nothing — which is
    indistinguishable, from those two records alone, from no deploy at all.
    The guard held; the diagnosis was luck.

    ITS PARALLEL PRESENCE ALSO EXPLAINS THE FIXTURES that a `npm run check`
    tripped on at 01:34Z: `iso-counter-6awlaz` and `warnings-x8bedk` were that
    suite's live working set, which is why they moved between two sweeps and
    why they were gone soon after without anyone deleting them.

    WHY IT MATTERS BEYOND THE MYSTERY: it cost a red `check` that looked like
    drift, and it nearly cost a sweep of a running suite's live fixtures —
    the read-only default is the only thing that stopped it. Anything that can
    start a suite unattended can also collide with the gate, which is flag
    66's 526 seconds.

73. **ONE DEPLOY COMMAND, ONE WINDOW, WATCHED TO ITS LAST LINE.** A deploy
    that starts its own 55-minute gate and is then left alone is a second
    runner nobody remembers starting. It cost a red `check` read as drift, a
    near-sweep of live fixtures, an hour spent diagnosing a failure that had
    an author, and a false conclusion recorded in flag 66.

    THE COMMAND IS NOT THE COMMITMENT — THE WINDOW IS. `deploy:prod` looks
    like it takes a second, and takes an hour whenever no valid receipt
    exists, which is precisely when nobody is expecting to wait. Either watch
    it to its last line, or earn a receipt first and deploy on that, which is
    the whole reason the receipt exists.

74. **DEDUPE IS PROVEN LIVE, AND SO IS EVERY OTHER BRANCH OF THE ROUTE.**
    2026-08-15, on production: a re-POST of test 3's Message-ID returned
    `200 {"accepted":true,"duplicate":true,"id":"cmsulfhoc0000psp7mhh24ddu"}`
    and both tails recorded ONE request line and ZERO `audit.gap` lines. No
    create, no update, nothing written. `emailByMessageId` returned before any
    write, on the key flag 58 measured to be the stable one.

    THE ABSENCE IS THE PROOF, not the 200. A second row would have announced
    itself as a `create` audit gap; silence is the only observation that
    distinguishes "deduplicated" from "wrote it again".

    AND THE FAILED ATTEMPTS WERE WORTH MORE THAN THE SUCCESS. Getting there
    walked the refusal ladder on production in order — `503 not_configured`,
    `401 unauthenticated`, `400 invalid_body`, then the `200`. Every branch of
    this route has now been observed on a real request against the real
    worker, which is a thing no test suite had established: the integration
    tests exercise the handler, not the deployed edge.

75. **TWO TOOLING TRAPS, BOTH OF WHICH CORRUPT SILENTLY.**

    `wrangler secret put` PROMPTS BLIND AND EATS THE NEXT LINE OF A MULTI-LINE
    PASTE. The value it stores cannot be read back, so a secret mangled this
    way is invisible until something authenticates with it and fails — and
    the failure surfaces as `503 not_configured` or `401`, neither of which
    points at the paste. SECRETS GO IN THROUGH THE DASHBOARD from now on.
    This is the same class as flag 61: a value that cannot be read back is a
    value that cannot be verified, only re-guessed.

    POWERSHELL STRIPS EMBEDDED QUOTES when passing inline JSON to a native
    executable, so `curl.exe -d '{"a":"b"}'` arrives as something the endpoint
    reports as `400 invalid_body` — a message about the payload, for a fault
    in the shell. Write the body to a FILE and use `--data-binary "@body.json"`.

    BOTH FAIL AS SOMETHING ELSE. A mangled secret reports as configuration, a
    mangled quote reports as a bad payload. Neither names the tool that did
    it, which is why they are written down here rather than remembered.

76. **STEP 3b's FIRST REAL DATA POINT: THE READER ABSTAINED ON A DOCUMENT
    THAT HAD EVERYTHING.** 2026-08-15, a real Relay booking forwarded to
    `loads@zebratms.com`. Transport was perfect and the reading was not.

    WHAT ARRIVED: delivery on attempt 1, 72,723 bytes, the nested parse
    intact, the row created, the original in R2, ocrStatus `COMPLETED`, state
    `REVIEW`, no error. WHAT THE MODEL RETURNED: every field null, no stops at
    all, and a single high-confidence brokerName of "RAM HAULAGE" — which is
    the CARRIER, taken from either the greeting or the signature block Gmail
    appended to the forward. Carrier-identity-as-artifact is the case the
    extraction contract forbids by name. The draft was not saved.

    THE FEED HYPOTHESIS WAS WRONG AND IS RECORDED AS WRONG. This assistant
    diagnosed the cause as the mail worker preferring the plain-text part over
    the HTML, reasoning that a Relay booking's lane and times live in table
    cells that a mail client's plain-text alternative would flatten past
    recognition. The owner's query falsified it outright: bodyText, which IS
    the extraction input verbatim, contained the entire booking, readable,
    with the lane, both zoned clocks and both money lines adjacent. That line
    is EXONERATED for this message.

    SO IT IS READER-VERSUS-WRAPPER, and which one is open. The reader may be
    failing on a document it can read; or Gmail's forward furniture — the
    banner, the quoted header block, the signature — may reframe the
    document's genre from rate confirmation to email thread, and an
    abstention plus one confidently-named party is exactly what that would
    look like.

    THE MODEL IS CONTROLLED, AND AN EARLIER VERSION OF THIS FLAG SAID IT WAS
    NOT. Corrected rather than deleted. The claim was that the extract route
    accepts a model parameter while the inbound-email route silently takes
    EXTRACTION_MODEL, so the two observations might have asked different
    models. Reading the source settles it: `verify-paste-text.mjs` is not an
    API script, it drives the real UI through Playwright — it opens the Paste
    text tab and fills the textarea — and the tab's own extract call sends no
    body at all, so no model and no cache flag reach the endpoint. Both paths
    fall through to the same default, today `gemini-3.6-flash`. THE 15/15
    STANDS as evidence about production's reader.

    THE HONEST CAVEAT IS THE OTHER ONE: the comparison was
    DOCUMENT-uncontrolled. The 15/15 ran on different texts from tonight's
    booking, so "paste reads well, email does not" has always carried two
    variables — the path and the words — and only one of them was ever in
    question.

    APART FROM THE BYTES, THE TWO PATHS ARE THE SAME PATH. Same endpoint, same
    `text/plain` type — the Paste tab mints a `.txt` file exactly as the mail
    route base64s its body — same model, same cache setting. That is what
    makes the experiment below a single-variable one, and it is why it needs
    no scripting: three pastes through the tab a dispatcher uses.

    THE EXPERIMENT RAN, AND IT WAS NOT THE WRAPPER. Three inputs on the
    default model, through the Paste tab a dispatcher uses: bodyText verbatim,
    bodyText with the forward furniture and signature removed, and the booking
    body alone. ALL THREE EXTRACTED, the full-furniture one included. The
    reader reads this genre, and Gmail's banner and signature do not stop it.
    (The per-field results were not captured into this flag; the ruling
    recorded here is that all three read, not what each field held.)

    IT TOOK TWO ATTEMPTS TO LEARN THAT, and the first attempt taught something
    else. Three pastes made earlier the same evening ALL returned "Could not
    read that one", which looked like the reader refusing three different
    documents identically — engine state rather than content. The tail said
    otherwise: zero calls reached the extract endpoint at all. Every one died
    at `upload-url`, one step earlier, on the database guard of flag 77. THOSE
    THREE REFUSALS ARE NOT EVIDENCE ABOUT THE READER and must not be read as
    such; they are an infrastructure outage wearing an extraction error's
    clothing.

    SO 3b's QUESTION IS NOT GENRE. It is REPRODUCIBILITY: the same reader, the
    same default model and the same bytes produced a full extraction by paste
    and every field null by mail, and engine-moment variance is the prime
    suspect. The email run's all-nulls is now the SOLE anomaly rather than a
    pattern, and one anomaly is a thing to reproduce, not to fix.

    AND THE SECOND HALF OF THE QUESTION IS WHAT THE PIPELINE SHOULD DO WITH AN
    EMPTY READ. Tonight's produced ocrStatus `COMPLETED`, state `REVIEW`, no
    error, and a draft carrying one confident field that was the carrier's own
    name. Nothing in that says "the reader returned nothing" — it looks like a
    document that had nothing in it. An abstention and a blank rate
    confirmation are indistinguishable on the queue, and they should not be.

77. **THE GUARD THAT REFUSED, WHICH IS FLAG 50 INVERTED.** During the same
    evening's secret work a `neondb_owner` connection string was pasted into
    production's `DATABASE_URL`. The owner role carries BYPASSRLS. Had the app
    accepted it, every tenant boundary in the system would have quietly
    stopped existing while every page kept rendering and every query kept
    returning rows — the failure that leaves no trace because nothing looks
    wrong.

    `src/lib/db.ts` refuses any connection string without `zebra_app` in it,
    by name, on every client construction. So instead of a silent bypass there
    was a loud outage: five `upload-url` requests in twelve minutes, each
    logging the sentence, and a paste flow that could not mint a document.

    THAT IS THE SHAPE FLAG 50 DID NOT HAVE. There, the production-branch
    check asked about a LABEL that nothing enforced, said nothing for an
    entire run, and let fixtures reach production. Here the check asks about
    THE THING THAT ACTS — the credential in the string that opens the
    connection — and it cannot be true while the danger is present. A guard
    that inspects what performs the action fails loudly by construction; a
    guard that inspects a description of it fails silently by construction.

    THE COST WAS TWELVE MINUTES AND A MISDIAGNOSIS, and it was worth it. The
    outage also made three paste results look like a reader failure, which is
    the one genuinely expensive part: a loud failure in the wrong vocabulary
    still misleads. "Could not read that one" was true of a request that never
    reached a reader.

78. **A CONFIG VERSION WAS SILENCING THE DRIFT CHECK, AND THE QUIET WINDOW WAS
    THE WORST POSSIBLE ONE.** Editing a secret in the Cloudflare dashboard
    creates a deployment that serves. Nobody deployed it from a commit, so it
    carries no commit message — production's carried NONE AT ALL, not merely a
    non-commit string, which resolved to `unstamped`. Unstamped is quiet.

    SO THE ONE LOUD SIGNAL IN THAT FILE WENT MISSING — production trailing a
    change to `src/` — for as long as the config version kept serving. That is
    the window right after somebody has been fixing secrets by hand, which is
    exactly when a half-finished deploy is most likely. Live, the fix turned
    `commit unknown` into `9 commit(s) behind HEAD, 5 file(s) under src/`.

    THE SCRIPT NOW RESOLVES THE LAST REAL DEPLOY UNDERNEATH and measures drift
    against it, saying `config version atop the last real deploy d09f001` so
    the line states what it is about rather than what it is.

79. **`versions list` RETURNS NO `created_on`, SO A SORT ON IT WAS A NO-OP.**
    Found while fixing flag 78. `check-deploy-drift.mjs` sorted versions by
    `created_on` to find the newest; the field is absent from that command's
    JSON, so the comparator compared `"undefined"` with itself and left
    whatever order wrangler returned — WHICH IS NOT NEWEST-FIRST. `d09f001`
    (21:28) comes back after `a230e61` (16:28).

    `deployments list` does carry `created_on`, and carries the message too,
    so ordering and stamping both come from there now. The lesson is smaller
    than the flag above and older than it: a sort that silently does nothing
    looks exactly like a sort that works, and the only reason this surfaced is
    that a bug elsewhere made the ordering matter.

80. **THE DEPLOY COULD NOT SEE THE VARIABLE THAT EXISTED TO INFORM IT.**
    `PROD_DIRECT_DATABASE_URL` was parked so the migration gate would VERIFY
    against `_prisma_migrations` instead of trusting a marker a human wrote.
    `check:unrouted` and `check:drift` run under `node -r dotenv/config`;
    `deploy:prod` does not. So the 2026-08-16 deploy read the marker while a
    live answer sat one line away in `.env`, and this assistant announced it
    as the first deploy that verifies rather than asserts. It was not.

    WORSE THAN A MISSED OPPORTUNITY: the marker had just been set to
    `verified: true`, so the deploy's output looked like a verification. A
    stale marker with that flag set would have looked identical.

    `deploy.mjs` now parses the single key out of `.env` when the environment
    does not already carry it — not `dotenv/config`, which would put the dev
    connection strings into the very process the integration gate is spawned
    from. Adding it as a reader failed `tests/prod-url-guard.test.ts` by name,
    which is the fence working: a third reader is a decision, and this is the
    record of making it.

81. **A HAND-WRITTEN CHANGE TO A SHARED DATABASE IS INVISIBLE TO EVERY
    INSTRUMENT WE HAVE.** On 2026-08-20 this assistant ran
    `REVOKE ALL ON TABLE public."_prisma_migrations" FROM zebra_app` against the
    dev branch by hand, to undo damage its own probing had caused. The revoke
    was correct and `structure.test.ts` went green again. That is not the
    point.

    THE POINT IS THAT NOTHING COULD HAVE TOLD ANYONE. `check:drift` compares
    commits, and a manual `REVOKE` leaves no commit. The migration checker
    compares `_prisma_migrations` against the migrations folder, and a grant is
    not a migration. `npm run check` asserts a handful of privileges it thought
    to name — it caught this one only because `structure.test.ts` happened to
    assert on the exact table that changed, and only on `SELECT`, which the
    blanket grant happened to include. A revoke on any table nobody asserts
    about would have been permanent and silent.

    SO THE BLIND SPOT IS: the schema is version-controlled and the GRANTS ARE
    NOT. Two databases can pass every check in this repository while disagreeing
    about who may read what. Dev and production are not compared to each other
    on privileges by anything, ever.

    Recorded as a standing blind spot rather than as an incident, because the
    incident is closed and the gap is not. The obvious closure is a check that
    reads the ACLs of every table on both databases and compares them to each
    other — not to a list somebody maintains, which would rot the same way.

82. **`zebratms.com` IS THE MAIL DOMAIN. THE APP IS
    `zebra.tajikcargollc.workers.dev`.** Cloudflare Email Routing serves
    `loads@zebratms.com`; no application is served there at all.

    This cost four dead probes on 2026-08-20 — `zebratms.com`, `www.`, `app.`
    and `zebra.` all returned `000`, which reads as "production is down" rather
    than "wrong host" — and it stalled an artifact-level check of what was
    actually deployed at the one moment that check mattered, during a dispute
    about which commit production was running.

    The app origin is now written into `scripts/check-deploy-drift.mjs` beside
    the probe that uses it, so the next person reads it from the code rather
    than guessing from the email address.

83. **THE INTEGRATION SUITE'S TRANSACTION MARGINS ARE THINNER THAN THE
    DATABASE'S VARIANCE.** Two runs died on transaction ceilings in two days,
    at different limits, and both passed in isolation immediately afterwards:
    - `documents.test.ts` — 10,260ms against a 5,000ms ceiling, on TWO expired
      mints. Diagnosed and fixed: the sweep held a transaction open across
      R2 calls (~350ms each), which no row count could survive.
    - `payments.test.ts` — 21,879ms against a 20,000ms ceiling, in
      `transitionOperational`, which makes FOUR queries. At the measured 202ms
      round trip that is ~800ms of work against a 25× margin. Nothing in the
      diff touched that path; the file passed 21/21 alone minutes later.

    THE FIRST WAS A DESIGN FAULT AND THE SECOND WAS WEATHER, and telling them
    apart took a measurement each time. What is recorded here is the pair: this
    database's latency varies enough that a 25× margin is not always enough,
    so a ceiling failure is not by itself evidence of a bug in the change under
    test. It is also not by itself evidence of weather — the first one was
    real, and calling it weather would have shipped a sweep that could never
    complete.

    `LOAD_WRITE_TIMEOUT_MS` WAS NOT RAISED, and should not be to quiet this.
    It is a production write budget; widening it so a test passes changes what
    the application promises in order to make an instrument agreeable.

    The parallel suite has not removed this — it removed the COST of finding
    out, from 56 minutes to 11.

84. **~~A GUARD ON ONE DOOR OF A ROOM WITH THREE.~~** — **CLOSED 2026-08-20.**
    The one-runner lock lived in `scripts/integration-gate.mjs`, so it guarded
    `npm run test:integration` and `deploy:prod` and nothing else. A bare
    `npx vitest --project integration` walked straight past it — and that is
    not hypothetical: it is the command typed to reproduce the payments
    failure, run beside a lock that was free only by luck.

    Moved into `tests/integration-lock.ts`, run by Vitest's `globalSetup`,
    which fires exactly once per run in the main process whatever invoked it.
    NOT into `tests/setup.ts` as first proposed: that is a `setupFiles` entry
    and executes once per test FILE in its own process — measured, three files
    gave three executions under three pids — so a session-scoped lock there
    would be taken and dropped twenty-seven times a run.

    Recorded rather than deleted because the SHAPE recurs: a guard attached to
    one entry point protects that entry point, and the entry point somebody
    uses while debugging is rarely the guarded one.

85. **THE FIELD-BY-FIELD MAPPING LOST THREE FIELD FAMILIES IN THE SAME TEN
    LINES, AND VIGILANCE WAS NEVER GOING TO FIX IT.** `createTripLoad` built
    its `StopInput` by restating each field; `enrichLoad`, ten lines below,
    spread the row whole. The restating branch lost:
    - `place` where the contract says `name` — every stop nameless, caught by
      an integration test written after the fact;
    - `legMiles` and `legEmpty` — the entire reason
      `20260817225524_load_stop_leg_miles` exists, dropped because `StopInput`
      had nowhere to put them and nobody noticed the silence;
    - all four clocks — planned and actual, arrival and departure — parsed,
      planned, and then not written.

    THE SPREADING BRANCH LOST NOTHING, EVER. Not because it was written more
    carefully but because it cannot: `{ ...row }` has no place for an omission
    to hide.

    So the create path spreads now, with the callback return annotation kept.
    Measured, because both halves matter: a SPREAD property is not
    excess-property-checked, so nothing can be forgotten — and an explicitly
    written unknown key still fails TS2353, so `place` could not come back.
    Both watched failing before the change was committed.

    TYPES STILL CANNOT SEE THE OTHER HALF. A spread that stops PRODUCING a
    field is invisible to the compiler — the row has one fewer key and
    everything fits. Only reading the column back catches that, which is why
    one read-back assertion per field family sits in
    `tests/integration/trips-import.test.ts`.

86. **THREE SILENT `str.replace` NO-OPS IN ONE SESSION, and the durable fix is
    the shape of the edit rather than more care.** Every one looked like a
    successful change and produced nothing:
    - a `sed` whose target prettier had reindented, so the "proof" that a guard
      caught a bug was a run against unmodified code;
    - a `python` replace of the stop mapping whose anchor prettier had
      reformatted — the clocks were never carried, found only when four
      integration tests read back null;
    - a `grep` filter over a background run that discarded the refusal banner
      AND reported `tail`'s exit code, turning a real 607-second failure into a
      four-second mystery.

    WHAT THEY SHARE is that the tool reports success for "matched nothing".
    `str.replace` returns the original string; `sed` exits 0; a filter that
    matches nothing prints nothing. Each was caught by something downstream
    reading a value back — never by the edit itself.

    THE RULE, alongside "never supply the baseline you are testing" and "read
    the exit code before anything touches the output": **assert the anchor
    before replacing on it.** A replace without an assertion is a wish. Where
    an assertion is awkward, splice by line number after printing the lines —
    which is what finally landed the deploy.mjs edit after two failed attempts
    at matching its text.

87. **THE RULE'S AUTHOR BROKE IT THE SAME DAY, ON THE SAME KIND OF COMMAND.**
    `AGENTS.md` gained "read the exit code before anything touches the output"
    on the morning of 2026-09-01, written up from three incidents where a
    filter had eaten the evidence. That evening the gate was launched as
    `npm run test:integration 2>&1 | tail -16`.

    It went red. `tail` kept the last sixteen lines — a stack frame and the
    summary — and discarded the error message naming which ceiling blew and
    where. The captured log was twenty lines long. The pipeline reported exit
    `0`, because that is `tail`'s exit code, so the only surviving signal that
    anything had failed was the ABSENCE of a receipt.

    The failure was then diagnosed by re-running the file alone, which passed,
    and reading the source — a slower and less certain route to an answer the
    original run had already produced and thrown away. The cause turned out to
    be an R2 call inside a Postgres transaction, and the evidence for WHICH
    ceiling it blew is simply gone.

    WHAT THIS SAYS ABOUT WRITTEN RULES: knowing the rule, having just written
    the rule, and having written the incident report attached to the rule were
    together not enough to stop the habit. The pipeline was typed the way it
    has been typed a hundred times. Rules that depend on recall at the moment
    of typing fail at exactly that moment.

    So the gate's output is captured to a FILE and the file is read — the same
    move as `assertOutsideTransaction`: replace the recollection with a shape
    that cannot forget.

88. **AMAZON RENAMED A COLUMN, TWO READERS OF THE SAME FILE DISAGREED ABOUT
    ITS NAME FOR TWO PHASES, AND THREE INSTRUMENTS IN A ROW MISSED IT BECAUSE
    EACH ONE MEASURED A SUPERSET OF THE THING BEING CLAIMED.** — 2026-09-02.

    Load 1010 was imported from a Completed export. The preview promised
    actual times, the confirm ran, and every stop still rendered `scheduled`.
    One query against the row settled what four rounds of reading the source
    had not: all four stops had been updated at `03:04:09`, each one carrying a
    real `departedAt` and `legMiles` beside a null `arrivedAt`. The stops were
    matched, the write happened, and the arrival half of every pair was null
    before it ever reached the database.

    THE CAUSE IS ONE COLUMN. Amazon renamed the arrival pair from
    `Stop N Actual Arrival Date/Time` to `Stop N Actual Check-In Date/Time`.
    Every export downloaded since 2026-08-17 carries the new name; the
    departure pair beside it never changed. So the reader kept finding half of
    each stop, and a delivered load recorded when the driver left every
    facility and nothing about when he arrived.

    AND THE OTHER READER HAD IT RIGHT ALL ALONG. `relay-csv.ts` — the board
    importer, written first — reads `Actual Check-In`. `trips-csv.ts`, written
    later against the swept archive, read `Actual Arrival`. One file, two
    readers, two answers about what a column is called, each blind exactly
    where the other could see, for two phases. Flag 23's correction said the
    two screens differ in the UNIT of their output and not in the file they
    take; nothing followed that through to the question of whether they agree
    about the file's columns, and they did not.

    THREE INSTRUMENTS MISSED IT, THE SAME WAY EVERY TIME — each one counted a
    population that could not contain the defect:
    - A corpus probe counted stops carrying an arrival across the whole sweep:
      `stops=1285 withArrival=1002`. This was used to RETRACT a correct
      diagnosis. It proves arrivals parse SOMEWHERE. The claim being made was
      about one pair on one stop in one file; the measurement was of a
      1,600-file archive in which the survivors carry the count.
    - The corpus was the second. Twenty-one post-rename exports sat unswept in
      a downloads folder while `corpus/relay-trips` held only files from before
      the rename — the newest of them from a run that predates the change. A
      corpus that stops where the archive stops is a record of what USED to
      arrive, and every assertion over it inherits that date.
    - The first version of the pairwise test then ran over the real renamed
      export and PASSED, because it asked for `stop n actual arrival date` —
      the name the parser believes in. Built independently of the parser, from
      the same belief. A test that names the column cannot see the column being
      renamed; it agrees with the bug in the parser's own words.

    THE REVERSALS ARE THE POINT. "Found it" was announced on the column names,
    retracted on the corpus aggregate, and then reinstated by the row. Both
    moves were made by reasoning ABOUT the data — an aggregate, then the source
    — and the row settled it in one query, as it would have at any point in the
    preceding hour. This is the twin of "check the thing that acts": **count
    the thing you are claiming, not a superset of it.** A superset answers a
    different question and answers it confidently.

    THE FIX IS A LIST, IN BOTH READERS. `clockAt` and `moment` take column
    names in order and return the first that yields a whole clock, so both
    spellings are read and the old one stays — files already on disk are
    re-imported, and the day the rename is "cleaned up" is the day those files
    start losing their times instead.

    THE GUARD IS THE HEADER, NOT A NAME. `tests/trips-csv.test.ts` discovers
    every `Stop N <label> Date` that has a `Time` beside it, classifies it by
    whether its own name says departure, and asserts the PAIR on the stop:
    where a file prints both halves, both readers must return both. It runs
    over the sweep — now 1,623 files, including all 21 post-rename exports —
    and a census assertion lists which actual-time labels the sweep contains,
    so a THIRD name fails by name rather than by a load quietly losing its
    check-ins. Three hand-written fixtures carry the same claim without the
    corpus, because the corpus is gitignored and every assertion over it skips
    on CI.

    BOTH GUARDS WERE WATCHED FAILING. Reverting `trips-csv.ts` to the old name
    alone fails the sweep and the fixture, naming load 1010's own times
    (`MEM4 07:17`, `HME9 08:08`); reverting `relay-csv.ts` to the new name
    alone fails the board half on 1,602 pre-rename files. Both restored, both
    green after.

    WHAT THIS COSTS TO REDISCOVER: load 1010 is repairable — `hasActuals` is
    "any stop with an `arrivedAt`", so re-importing the same export after this
    deploys fills all four. Any trips-imported load booked between 2026-08-17
    and this fix has the same hole and the same repair.

    THE ONE SENTENCE THAT COVERS ALL THREE: **every instrument failed by
    inheriting the belief it was meant to test.** The aggregate inherited the
    archive's date and counted a population that could not contain the defect.
    The corpus inherited the sweep's end date — a corpus that stops where the
    archive stops records what USED to arrive. The test inherited the parser's
    column name, and so agreed with the bug in the bug's own words. None of the
    three was careless; each was built from the same assumption as the thing it
    was checking, which makes disagreement impossible rather than unlikely.

    THIS IS THE DATA-SIDE TWIN OF "CHECK THE THING THAT ACTS". That rule says
    to measure the running system rather than a stand-in for it. This one says
    the measurement must not be constructed from the same assumption as the
    code: derive the instrument from the artefact — read the header, read the
    row, read the baseline off the thing being measured — and never from what
    the source believes about it. Where the instrument must name something the
    code also names, that name is the first thing to doubt when both agree.

89. **ONE BEHAVIOUR, TWO WRITE PATHS, AND ONLY ONE OF THEM READ THE STAGE.** —
    2026-09-02, found in live use within an hour of flag 88's deploy.

    Loads 1011, 1012 and 1013 were imported from a Completed export with no
    earlier pass behind them — the ordinary case for a carrier catching up on a
    week of finished trips. All three landed **Booked**, showing what looked
    like Amazon's appointment times for freight still to come. Re-importing the
    same file moved them to Delivered and the check-ins appeared, which read as
    "the second import added the times".

    IT DID NOT. The row says the check-ins were written by the FIRST import:
    the guard `and with every check-in the file printed, in one pass` passed
    against unfixed code, while `lands a finished trip Delivered on the first

        import`failed with`BOOKED`. `createTripLoad`wrote all four clocks

    correctly and never moved the status;`stop-actuals.ts` shows the PLAN on a
    booked load, so four real check-ins and no check-ins render identically.
    The screen could not distinguish the two, and neither could the report.

    THIS IS FLAG 88'S SHAPE IN THE WRITE PATH. There, one file had two readers
    that named a column differently and nothing compared them. Here, one
    behaviour — "a finished trip is a delivered load" — was written out inside
    `enrichLoad` and nowhere else, so the create path beside it could be
    complete in every other respect and silently lack it. Neither defect is a
    mistake in the code that was written; both are the absence of a single
    place where the rule lives.

    SO THE MOVE IS ONE FUNCTION. `deliverFinishedTrip` is called by both paths
    and owns the `trip.stage === 'finished'` test and the `occurredAt` choice
    (last departure, else last arrival, else nothing). `enrichLoad` keeps its
    own `isDelivered` check, because that one exists to keep the PREVIEW honest
    rather than to protect the write.

    AND THE PREVIEW MOVED WITH IT. The create row read "to book" for a trip
    that had already run — true of the old write, and false the moment the
    writer learned to read the stage. It now reads "to book, marks delivered",
    from the same `trip.stage` the writer uses. A preview that understates is
    the same defect as one that overstates; flag 88's cancelled-load lesson was
    that a preview must not announce a write that cannot happen, and this is
    its other half.

    WHAT THE GUARD LOOKS LIKE: four integration tests, and the split between
    the first two is the point — status and check-ins are asserted SEPARATELY,
    because the screen conflates them and "shows scheduled times" is therefore
    not evidence about what was written. Plus a re-import that must find
    nothing left to add, and an In-Progress trip that must stay booked.

90. **TWO IMPORTERS RESOLVED THE SAME CUSTOMER AND DISAGREED ABOUT WHETHER
    AMAZON PAYS BY INVOICE — AND WHICHEVER RAN FIRST IN AN ORGANISATION
    DECIDED IT FOR EVERY LOAD AFTERWARDS.** — 2026-09-03.

    `Load.directSettled` is copied from `Customer.settlesDirectly` when a load
    is booked. It decides the entire Amazon load-detail screen, it keeps the
    load out of ready-to-invoice, and since the same day's ruling it decides
    whether Delivered carries the POD — which is to say whether the driver is
    ever paid for the freight.

    THE BOARD IMPORTER creates `Amazon Relay` through `ensureRelayCustomer`,
    with `settlesDirectly: true` and `isFactorable: false`, both reasoned about
    in that function.

    THE TRIPS IMPORTER called `resolveBroker`, a generic helper that creates a
    customer with `{ organizationId, name }` and nothing else. `settlesDirectly`
    took its `false` default. So every load booked through it was
    `directSettled: false`: the broker screen, a Documents panel asking for
    paperwork that lives in Relay, and no POD on delivery — invisible to
    `settleableWhere`, in any period, for any driver.

    AND IT WAS ORDER-DEPENDENT, which is the part that would have made this
    hard to see. Both paths look the customer up by name before creating one,
    so the flag was decided by whichever importer ran first in an organisation
    and then silently inherited by everything after it. Dev and production could
    disagree; two organisations could disagree; nothing on any screen says
    which answer an office got.

    THE FIXTURE INHERITED THE DEFECT FROM THE CODE. The trips integration tests
    resolved their customer with `resolveBroker` too, so they booked
    non-direct-settled freight and asserted the behaviour of freight the
    importer does not actually create. Four tests passed on that basis,
    including two written the same day specifically to prove the POD ruling
    reached this path. Pointing the fixture at `ensureRelayCustomer` turned
    three of them red immediately.

    That is the flag-88 lesson arriving again by a different door: **an
    instrument built the way the code is built agrees with the code.** There it
    was a column name; here it is a factory function. The corpus rule says
    build the instrument from the artefact; the equivalent for a fixture is to
    book the load the way the ACTION books it, and the cheapest way to
    guarantee that is for both to call the same function — which is now what
    happens.

    THE THIRD OCCURRENCE OF ONE SHAPE IN TWO DAYS. Flag 88: one file, two
    readers, two answers about a column name. Flag 89: one behaviour, two write
    paths, one of them missing a step. This: one customer, two resolvers, two
    answers about a money flag. None of the three is a mistake in the code that
    was written; all three are the absence of a single place where the fact
    lives.

    WHAT IS NOT FIXED BY THE CODE CHANGE, and needs the owner:
    - **The existing customer row.** If `resolveBroker` created production's
      `Amazon Relay`, its `settlesDirectly` is `false` and no deploy changes
      that. One `SELECT` answers it; the fence means the owner runs it.
    - **Loads already delivered.** `transitionOperational` returns `unchanged`
      when `from === to`, before the POD follow-on — so an Amazon load already
      at DELIVERED can never gain its POD by being re-delivered, and
      re-importing is refused by the `isDelivered` guard. Every such load is
      unpayable until something backfills it. Loads 1010–1013 are in this set.

91. **"AT LEAST THIS ERROR IS VISIBLE" IS A CLAIM ABOUT SOMEBODY LOOKING, AND
    NOBODY WAS.** — 2026-09-03.

    `leg-purpose.ts` classifies a Relay leg as loaded or empty from its
    `Shipper Account`. `TrailerPoolAdjustment` — 112 legs across three variants
    — is deliberately unclassified, because whether repositioning a pool
    trailer is an empty move is a question about this business rather than
    about that string, and it is with the owner. Unmatched falls through to
    LOADED, and the comment beside it justifies the default:

    > Unmatched means LOADED, which overstates loaded miles VISIBLY rather than
    > understating them quietly.

    THE REASONING WAS SOUND AND ITS PRECONDITION WENT UNSTATED. "Visibly"
    is not a property of the default; it is a claim that something displays the
    number and somebody reads it. Nothing did. `Load.emptyMiles` had been on
    the schema since Phase 1 and nothing filled it; when the trips importer
    began filling it, nothing showed it. So for the whole life of that comment
    the error was not visible in any sense — it was as quiet as the
    understatement the trade-off was chosen to avoid, and the sentence read as
    if the choice had been safe all along.

    IT BECAME TRUE AND FALSE ON THE SAME DAY. The Datatruck round-2 work put a
    Loaded / Empty / Total panel on the load detail. At that moment 112 legs'
    miles started appearing on screen as LOADED MILES — a figure a rate gets
    judged against — and the trade-off's precondition was satisfied for the
    first time, which is also the moment it stopped being harmless. A pending
    classification in a source comment is a known unknown; the same thing
    printed as a number is an assertion.

    WHAT THE SHAPE IS, GENERALLY: a trade-off defended by the visibility of its
    failure mode depends on an observer that the trade-off itself does not
    provide. "Fails loudly", "obvious in the logs", "somebody would notice" are
    the same sentence. None of them is a property of the code; each is a
    prediction about attention, and attention is the thing least likely to be
    there at the moment it is needed. Adjacent to flag 88's family — an
    instrument that inherits the belief it is meant to test — with the
    inversion that here the instrument was never built at all, and its absence
    was what made the argument sound.

    THE FIX IS NOT A CLASSIFICATION. Nobody answered the question; the screen
    stopped pretending it had been answered. `isUnclassifiedLeg` reports that
    no rule matched, `LoadStop.legEmpty` finally carries the three states the
    schema documented and the writer had been collapsing — null for
    unclassified, false for classified-as-loaded — and a load whose split rests
    partly on a default says so where the number is shown.

    IT IS DERIVED, SO IT REMOVES ITSELF. The note comes from "no rule matched
    this account", not from a pattern for `TrailerPoolAdjustment`. The day a
    rule is added, legs carrying that account classify and the note stops
    appearing on freight imported afterwards — no edit at the call site, no
    second commit.

    AND IT DOES NOT REMOVE ITSELF RETROACTIVELY, which is correct rather than a
    limitation. `Load.emptyMiles` is summed at import time from the same rules;
    a note that vanished for already-imported loads while the stored number
    still reflected the old table would be the screen going quiet about a
    figure that was still provisional. Both update together, on re-import, or
    not at all.

    ─────────────────────────────────────────────────────────────────────────
    TWO MORE OF THE SAME SHAPE, 2026-09-04, found while measuring why the
    integration suite kept dying.

    **A LIMIT ASSERTED IN PROSE AND NEVER DERIVED FROM THE DATABASE.** Two
    scripts capped their pools at one connection because they ran "against a
    branch with a connection ceiling". Nobody had read one. `max_connections`
    on the dev branch is **901**, and the suite opens single digits. One of
    those comments was written that same morning, by the same author who had
    spent the previous day writing flag 88 about instruments that inherit the
    belief they are meant to test — here the belief was inherited from nothing
    at all, which is worse, because there was not even a stale measurement
    behind it.

    It is flag 88's family a third time: 88 was a corpus that could not contain
    the defect, 90 was a fixture that booked freight the importer does not
    create, and this is a constraint that was never measured in the first
    place. The cap itself was harmless — a script needing one connection should
    say one — and that is exactly why it survived review. **A correct decision
    resting on an invented reason is indistinguishable from a correct decision,
    until the reason is cited for something else.**

    **AND THE RIGHT WAY TO RETIRE A WRONG NUMBER.** `LOAD_WRITE_TIMEOUT_MS`
    carried an inference that the effective round trip reached "700–900ms under
    eight workers" — arithmetic performed on a symptom, never measured.
    Measurement put it at 193–203ms at 1, 4 and 8 workers, flat.

    The retraction was written INTO the comment that had justified the number,
    beside the original claim, dated, with the command that produced the new
    reading. Not deleted: a wrong figure that simply disappears takes its
    reasoning with it, and the next person to wonder about the ceiling starts
    from nothing. A number and its retraction sitting together tell a reader
    both what was believed and what is true, which is the only form in which
    "we were wrong about this" survives long enough to be useful.

    The rule this suggests: **when a measured number replaces an asserted one,
    the assertion stays visible next to it.** Deleting it is tidy and loses the
    only evidence that the question was ever settled.

92. **FOUR INSTRUMENTS IN ONE DAY, EACH BROKEN IN A DIFFERENT WAY, WHILE
    INVESTIGATING A FIFTH.** — 2026-09-04.

    Two gates lost in a row, neither to code. Everything below was found while
    fixing that, and every item is an instrument rather than a feature.

    **THE REPORTER THAT DESTROYED THE EVIDENCE IT KEPT.** Built the day before
    so a crashed run would still say which tests failed. It wrote nothing on
    the first red gate: `reporters` is a ROOT-level option and it had been
    declared in `vitest.integration.config.ts`, a PROJECT config, where vitest
    ignores it. It had been "proven" with `--reporter=<path>` on the command
    line — a configuration nothing uses. Flag 87 twice over: a fix for "the
    diagnosis was destroyed by how it was reported", verified in a
    configuration nobody runs.

    Then, moved to the root and working, it destroyed the evidence a second
    way. `onInit` cleared the log, and the path was a fixed filename, so a
    node-project run started while the gate was mid-flight wiped fourteen
    recorded failures and left one of its own — which the gate then printed as
    though it were the gate's. The fix is ownership: whoever OWNS a run clears
    the file, the reporter only appends, and each run writes a dated header so
    a stale line cannot pass as today's. **Destroy-on-init is the wrong instinct
    for a file whose entire purpose is outliving a process.**

    **THE SHELL CENSUS THAT MEASURED A DIFFERENT FILE.** `awk -F','` over the
    corpus reported 4,367 legs with no Shipper Account and 7,413 legs in total.
    The real parser says **zero** blank accounts and **3,046** legs. Every one
    of those 4,367 was a row split inside a quoted field — the giveaway was
    `Texas` appearing in the Load Execution Status column. A comma-splitter on
    a CSV containing quoted commas is not a measurement of that file; it is a
    measurement of a different file that resembles it.

    THIRD TIME THIS SHAPE HAS COST SOMETHING (see flag 88): the arrivals
    aggregate, the per-stop miles question, and now this. The rule already
    written — build the instrument from the artefact — has a corollary it was
    missing: **when a parser for the format exists in the repository, the shell
    is not a shortcut to it.** A number produced by `awk` over a CSV should be
    treated as a hypothesis until the parser agrees.

    Cost: a question was carried to the owner about freight that does not
    exist, and a percentage was promised for a population of zero.

    **A TRI-STATE ENDORSED ON A WRONG PREMISE, MINE AND THE OWNER'S BOTH.**
    `LoadStop.legEmpty` is documented as three-state — null means nobody
    classified it — and the writer collapsed it to two. Correcting that was
    approved on the understanding that the schema wanted three and the code was
    losing one. It was truer than that: **the rules table could only ever have
    produced two**, because it enumerated EMPTY patterns alone and everything
    unmatched fell through to LOADED. So `isUnclassifiedLeg` called all ordinary
    freight unclassified — `OutboundAmazonManaged`, 827 legs, the single most
    common account — and the provisional note would have appeared on every load,
    which is the same as appearing on none.

    The fix was to enumerate the LOADED families too, measured from the corpus,
    so unmatched finally means what it says. A three-state column needs a
    classifier that can produce three answers, and nobody checked that it could.

    **AND THE RETRY, WHICH IS SAFE FOR A REASON SOMEBODY ELSE BUILT.**
    Twelve of fourteen failures in the second lost gate were the compute, and
    all fifteen stack traces ended at `PrismaNeonAdapter.startTransaction` —
    none at `performIO`, `queryRaw` or a commit. A transaction that never opened
    wrote nothing, so retrying it is safe. Two things make that true, and only
    one of them is obvious:
    - Load and invoice numbers come from `UPDATE "Counter" SET value = value
      - 1 ... RETURNING` inside the transaction — a row update, deliberately
        not a sequence. Sequences do not roll back; this does. The series stays
        contiguous.

    - **`assertOutsideTransaction` is what makes the rest of it safe, and it
      was built for something else entirely.** It forbids R2 and other
      third-party calls inside a Postgres transaction, added after the
      reconciler held one open across an object-store round trip. Because no
      external side effect CAN be inside the transaction, re-running the
      transaction cannot repeat one. That guard is now load-bearing for a
      retry it was never designed for, and anybody simplifying it away would
      silently make the retry unsafe. It is not obvious from either file; it
      is written in both now.

    THE RESIDUAL, RECORDED RATHER THAN SOLVED: a drop between COMMIT and the
    client learning of it is indistinguishable, from the client, from a drop
    before the commit — and retrying that re-runs committed work. None of the
    fifteen traces was that shape. The scope is `startTransaction` only, and
    that narrowness is what keeps the retry inside what was measured rather
    than beside it. **If a future trace shows a commit-time drop, this must not
    be widened to cover it.**

93. **EVERY DEPLOY CHECK IN THIS REPOSITORY STOPPED SHORT OF THE RESPONSE, AND
    THE ONE THAT SAID SO LOUDEST WAS THE ONE BEING MISREAD.** — 2026-09-04.

    Four items shipped in `ddd4095` were not on the production screen. Three
    checks agreed nothing was wrong:
    - `check:drift` said production was on `8177a71`.
    - the artifact probe said `/loads/import/trips` returned 200.
    - grepping `.open-next` found `loads.stopN` and "No address on file" in
      the uploaded bundle, and no trace of the markup that had been deleted.

    All three were true and none of them was about the page anybody opened.
    `check:drift` reads the **version message `deploy.mjs` stamps with
    `--message`** — and the script says so itself, in a comment written the day
    it was created:

    > A version id tells you a deploy happened. It does not tell you what is in
    > it.

    That sentence had been sitting in the file the whole time. The drift line
    was still being read — by me, out loud, more than once this week — as
    "production is running this commit". It says a deploy labelled with this
    commit occurred. The artifact probe was added precisely because a version id
    is weak evidence, and it too stops one step short: a stale cached page
    returns 200 with perfect confidence.

    **WHAT WAS ACTUALLY HAPPENING was worse than staleness.** The owner found it
    by hand: a request for load 1010 came back with **load 1013's HTML**, twice,
    and only `?v=2` produced the right page. A cache that can serve one load's
    page for another is a cache whose key is not the URL — and the question
    immediately after that one is whether it can serve one ORGANISATION's load
    to another, which is the single thing this codebase spends the most effort
    on. That question is open and is not answered by this flag.

    THE SHAPE, GENERALLY: **a chain of checks can be individually correct and
    collectively miss the thing, when every link measures an input.** Source,
    commit, bundle, status code — each is upstream of the response, and the
    response is the only artefact a user ever meets. Flag 88's rule said build
    the instrument from the artefact rather than from what the code believes
    about it; this is the deployment-shaped instance, and the artefact is the
    body of the reply.

    `scripts/verify-response.mjs` is the first check here that logs in and reads
    what a deployed route RETURNS. It asserts two markers deliberately chosen to
    fail in opposite directions — one that `ddd4095` ADDED and one it DELETED —
    so a stale response is distinguishable from a feature gate that is simply
    off. And it asks the question nobody had asked: is this the page that was
    requested?

    A caution for whoever extends it: the temptation is to add a cache-buster
    and get a green run. The plain request is the subject. The busted request is
    a control, and the difference between them IS the finding.

    ── SECOND OCCURRENCE, 2026-09-06, AND THE CHEAP DISCRIMINATOR ────────────

    The New Driver form was reported unchanged on production **after a hard
    refresh**, at a commit that contains the change. Same shape as load 1010,
    and the hard refresh is what made it look like a server problem.

    **"HARD REFRESH DIDN'T FIX IT" IS NOT EVIDENCE ABOUT THE SERVER.** It
    defeats the browser's HTTP cache and leaves Next's client router cache
    alone, so a stale RSC payload survives it intact — and the person doing the
    refreshing reasonably concludes the deployment is wrong. Both times that
    conclusion sent somebody to check the deploy, and both times the deploy was
    fine.

    **INCOGNITO IS THE DISCRIMINATOR AND IT COSTS TEN SECONDS.** A fresh
    profile has no router cache, so: incognito correct + normal window stale
    means the client; both stale means the server or the build. Ask for that
    before reading a version id, because it separates the two cases faster than
    any tooling here can.

    WHAT THE TOOLING ADDED ANYWAY: `npm run verify:driver-form`, beside
    `verify:response`. Two occurrences make "what does the deployed page
    actually render" a recurring question, and the answer should not be
    rewritten from memory each time. It reads `input[name=...]` off the live
    page — the string the form will POST, which is also the string the field
    spec declares — rather than labels, which are translated, or screenshots,
    which are pictures.

94. **THE PROBE REPRODUCED THE BUG IT WAS BUILT TO INVESTIGATE, AND THE
    REPRODUCTION WAS ITS OWN DEFECT.** — 2026-09-04.

    `verify-response.mjs` was written to answer one question: does a request for
    load 1010 come back with load 1010's page, or with another load's? It was
    wrong three times before it was right, and the third wrong version printed:

        FAIL  the response is the load that was requested
              asked 1110, header says "1114"

    Which is the collision. Exactly the collision, in the exact words the real
    finding would have used. The cause was that the loads list filters on
    `?ref=` and the probe sent `?q=` — an ignored parameter, an unfiltered list,
    and `.first()` returning the newest load every time.

    THE OTHER TWO WERE THE SAME SHAPE. `a[href^="/loads/"]` matched the
    sidebar's `/loads/import`, so the probe read the loads LIST and reported
    that a load page lacked the new markup. And dev and production have separate
    databases, so production load numbers found nothing on dev and fell through
    to the same wrong row.

    Each version failed in a way that CORROBORATED the hypothesis. That is worse
    than a probe that simply breaks: a broken probe is discarded, a
    corroborating one is believed, and this one had a clean transcript, sensible
    labels and a plausible story. Had the investigation stopped one step earlier
    — and it nearly did — the report would have been "the cross-load collision
    reproduces on dev", with evidence.

    The corrected probe returns 7/7: the right load, the new markup present, the
    deleted markup absent, plain and cache-busted requests agreeing, a second
    load returning its own page, and a fresh session agreeing with the first.
    Nothing was wrong with the server.

    **THE RULE, WHICH IS THE POINT OF THIS ENTRY: when an instrument reproduces
    the bug you are looking for, verify the instrument before believing the
    reproduction.** Confirmation is the moment to slow down, not the moment to
    report. Flags 88, 90 and 92 are the same family from the other side —
    instruments that inherited the belief they were meant to test and therefore
    saw nothing. This one inherited the belief and therefore saw everything.

    The three specific traps are written at the selectors that caused them in
    `scripts/verify-response.mjs`, because "the search param is `ref`, not `q`"
    is cheap to state and expensive to rediscover.

    STILL UNTESTED, AND FLAGGED AS UNTESTED RATHER THAN SAFE: whether the
    response varies correctly across ORGANISATIONS. Two logins, two
    organisations, one URL. Production answers anonymous requests with a 307 to
    `/login` and `Cache-Control: private, no-cache, no-store`, and no
    `cf-cache-status` header appears, so a shared cache should not be holding
    these pages at all — but "should" is what three green checks said the day
    this started. The owner is creating a second production user; that is the
    run to make, and until it is made this line stays as it reads.

95. **TWO GUARDS THAT WORKED PERFECTLY AND WERE NOT THERE.** — 2026-09-05.

        A single test file was run alone to decide whether a gate's failures were
        environmental. It took three attempts to get an answer, and the first two
        were the finding.

        ── "IT WORKS" AND "IT IS THERE" ARE DIFFERENT CLAIMS ────────────────────

        `installSocketCrashGuard` contains the dropped-socket death that otherwise
        kills a run. It has a test that spawns a REAL process, throws a REAL socket
        error at it, watches it survive, and — paired — watches an ordinary error
        still kill it. As evidence that the mechanism works, that is about as good
        as it gets.

        It was installed in `tests/setup-integration.ts`, which vitest loads through
        `setupFiles`: **in the test workers only.** `globalSetup` runs in the main
        process, opens its own pools to take the run lock and copy the template, and
        was never armed. Two gates died there — before a test existed to fail —
        with the containment sitting one process away, and the child-process test
        passing all the while.

        THE REPORTER WAS THE SAME SHAPE A DAY EARLIER. `failure-reporter.ts` was
        proven by running it with `--reporter=<path>` on the command line, where it
        wrote its log correctly. It was DECLARED in `vitest.integration.config.ts`,
        a project config, where vitest ignores `reporters` — so on the first red
        gate it produced nothing. Working mechanism, absent from the configuration
        that runs.

        **So a guard needs two proofs and they are not the same proof.** That it
        does its job, and that it is present in every context where its job arises.
        The first is a test. The second is an assertion at startup, or an inventory,
        or a placement that cannot be forgotten — and "I put the call in the setup
        file" is not it, because setup files are per-process and processes multiply
        quietly.

        THE FIX WAS PLACEMENT, NOT ANOTHER CALL SITE. The guard now installs on
        import of `tests/worker-db.ts`, which both `integration-lock.ts` (globalSetup)
        and `setup-integration.ts` (workers) already import for worker database
        names. Anything that could drop one of these sockets needs a worker database
        name to have opened it, so anything that could drop one is armed —
        including contexts nobody has written yet.

        AND THE ABSENCE IS NOW LOUD. `assertSocketCrashGuard(context)` runs before
        the first pool in globalSetup and names what is unarmed and why it matters.
        Watched failing: with the install removed it says "the integration
        globalSetup is not armed against dropped sockets" and refuses, at the moment
        the import chain breaks rather than the next time a socket drops.

        ── A RETRY WITH NO DELAY IS THE FIRST ATTEMPT N TIMES ───────────────────

        The same investigation's first attempt died on `55006 — source database

    "zebra_template" is being accessed by other users`, from a session left by
    the previous gate.

        `awaitTemplateIdle` exists for exactly this and is careful: it terminates
        backends, polls `pg_stat_activity`, and waits up to 60 seconds. The copy
        around it retries twelve times on 55006. Neither was the problem.

        THE RETRY HAD NO DELAY BETWEEN ATTEMPTS. `awaitTemplateIdle` returns as
        soon as `pg_stat_activity` shows nobody — and the comment directly above
        that loop already said this is EARLIER than the database stops counting the
        session:

        > termination is asynchronous: the backend is asked to go away, and
        > `pg_stat_activity` stops listing it slightly before the database stops
        > counting it.

        So twelve retries fired within a few milliseconds of each other, all into
        the same unfinished teardown, and a budget sized for twenty seconds was
        spent in under one. The same command a minute later succeeded.

        **Twelve attempts with no wait is one attempt, repeated.** It is the same
        family as widening a timeout to fix a race: motion in the right area that
        never touches the mechanism, and it reads as diligence — a bounded retry
        with a named error code and a comment is exactly what careful code looks
        like. The comment explaining the asynchrony was six lines above the loop
        that ignored it.

        ── WHAT THE TWO HAVE IN COMMON, AND WHAT THEY DO NOT ────────────────────

        Different roots: one is a process boundary, the other a missing delay. The
        shape is the same and it is worth naming as its own thing — **the mechanism
        exists and the path does not reach it.** Flags 88, 90, 92 and 94 are about
        instruments that lie; this is about instruments that are simply not on the
        road being travelled. An instrument that is correct and absent produces the
        same output as no instrument at all, which is why neither of these was
        noticed until a socket dropped in the one place nobody had armed.

96. **INTERMITTENT RED IN THE THING PEOPLE RUN CONSTANTLY IS WORSE THAN AN
    OCCASIONALLY LOST GATE, BECAUSE IT DEGRADES JUDGMENT RATHER THAN COSTING
    TIME.** — 2026-09-05. **STANDING ITEM, NOT YET ADDRESSED.**

        `npm run check` now fails intermittently for reasons unrelated to whatever
        changed. Four of its files touch the database — `integrity`,
        `isolation-coverage`, `migration-checksums`, `structure` — and when the Neon
        dev compute stalls or drops a socket, they go red together. Observed twice
        on 2026-09-05: nine failures, all four files, every one a compute signature,
        with the same command green minutes earlier and minutes later.

        THE GATE HAS THE SAME CONDITION AND IT MATTERS LESS. A lost gate costs
        fourteen minutes and announces itself: no receipt, nothing deployed, and the
        failure log names what fell over. It is expensive and it is honest.

        `check` is different because of how it is used. It runs before every commit,
        dozens of times a day, and its answer is consulted rather than studied. A
        suite that is red for reasons unrelated to the change teaches exactly one
        lesson, and teaches it quickly: **run it again.** After that the next real
        failure gets the same treatment, and it gets it from someone who has been
        trained by their own tooling to believe the first red is noise.

        THAT IS THE ATTENTION FAILURE THESE FLAGS KEEP DESCRIBING, POINTED AT US.
        Flag 91 is about a trade-off defended by the visibility of its failure mode,
        where nobody was looking. Flag 87 is about a diagnosis destroyed by how it
        was reported. Both assume a reader who reads. This is the mechanism that
        stops them reading — and it does not announce itself, because a suite that
        passes on the second run looks like a suite that passes.

        WHAT IS NOT THE ANSWER, stated so it does not get tried: retrying the four
        files, marking them flaky, or excluding them from `check`. Each converts a
        visible intermittent failure into an invisible one, and these four are the
        backstops — RLS coverage, migration drift, tenant-fixture coverage,
        cross-table integrity. They are the last things that should learn to be
        quiet.

        WHAT MIGHT BE: routing them at a warm compute the way the gate does; giving
        them the same start-transaction retry the application path has, bought with
        the same trace census; or separating "structural audits that need a
        database" from "logic tests that need nothing" so the fast half stays
        trustworthy and the slow half is run deliberately. All three are
        speculation. None has been measured, and this entry exists to record the
        problem rather than to pick a fix — the last local fix to setup on a hunch
        was reverted within the hour by the numbers that should have preceded it.

        THIRD OCCURRENCE, 2026-09-05, AND THE FIRST ONE MEASURED PROPERLY. Four
        failures, all in `integrity.test.ts`, all `A commit cannot be executed on
        an expired transaction` against Prisma's 5s default — 5761ms and 8173ms
        against a ~200ms round trip. The change in the tree was comment-only.

        THE TEMPTING MOVE WAS TO RE-RUN AND CARRY ON, which is the exact reflex
        this flag exists to name. What was done instead cost one command: `git
        stash`, run the file WITHOUT the change, watch it fail anyway (1 of 6),
        restore, run it again (6 of 6). That is attribution rather than
        assumption — the same shape as reading the baseline from the thing being
        measured, and it turns "probably the compute" into a fact.

        THE PROCEDURE IS THE INTERIM ANSWER while the fix is unchosen: when
        `check` goes red in one of the four database-touching files, do not re-run
        it. Stash and run the same file on the tree WITHOUT the change. If it fails
        there too, the compute is the cause and it is recorded here; if it passes,
        the change is the cause and re-running would have buried it.

        ── A NUMBER FOR THE FIRST OPTION, AND A COUNTER-EXAMPLE ─────────────────

        The three candidate fixes above were speculation. One is no longer.

        Pointing the gate's readiness probe at the dev branch before a `check` run
        caught the window in the act: **142.8 seconds**, with outright ten-second
        connect timeouts interleaved with an 8462ms connect, on a compute that had
        suspended and been resumed by the probe itself. `check` has no readiness
        poll; the gate has one. That asymmetry is the finding — the two suites
        differ in exactly the mechanism that covers this condition, and it is the
        unprotected one that reads as flaky.

        AND THE COUNTER-EXAMPLE, recorded with it so the option is not oversold: a
        `check` run started immediately AFTER the probe reported ready still lost 26
        tests across all four files, with 112 socket errors and no logic failure.
        Readiness at the door does not survive a seven-minute run.

        So waiting for ready would remove the runs that BEGIN inside a resume
        window, which is some of the problem and demonstrably not all of it. The
        rest needs resilience inside the four files, or the third option — splitting
        audits that need a database from logic that needs nothing, so the fast half
        stays trustworthy and the slow half's flakiness is expected rather than
        confusing.

97. **A RULE INLINE IN A `'use server'` ACTION IS A RULE NO TEST CAN REACH,
    AND THAT HAS NOW BEEN THE REAL REASON THREE TIMES.** — 2026-09-05.

        THE THREE, as the owner counted them: `planSignature`, the inline
        create path, and `setStopAddress`. The fix has been identical every
        time — move the logic to `src/lib/`, let the action delegate — which is
        what makes it a rule about WHERE LOGIC LIVES rather than a reminder to
        write more tests. A reminder would have been given three times too.

        WHY THE ACTION IS UNREACHABLE, stated once so nobody re-derives it. A
        server action's body runs behind `withCurrentOrg`, which resolves the
        session, decides permission and opens the tenant transaction. A test
        that wants the RULE has to stand up the whole authentication context to
        get at it, so in practice nobody does, and the rule ships on a reading.
        Meanwhile the same logic in `lib/` takes a `tx` and is callable from an
        integration test in one line.

        THE CASE THAT MADE IT THE THIRD. `setStopAddress` decides whether
        filling a stop's address also teaches the facility book: missing fills
        it, present does not, and emptiness is read from the Location row
        rather than the submitted form. Correct since 2026-09-03, never once
        watched working, and a fan-out that reaches every future load at that
        facility. Moving it to `lib/loads.ts` cost four lines of delegation and
        bought three tests, each of which was then watched failing ALONE —
        inverting the emptiness source fails two and leaves one green;
        removing the fan-out fails the other one only.

        THIS IS FLAG 95'S FAMILY, one level up. That flag was about a
        mechanism that existed and a path that never reached it. This is about
        a rule that exists in a place no INSTRUMENT can reach — same shape,
        except the thing failing to arrive is the test rather than the guard.

        THE ENFORCEMENT QUESTION IS OPEN, and there is precedent for answering
        it mechanically rather than by discipline: Phase 2 flag 13 banned value
        exports from `'use server'` files with an ESLint selector after that
        mistake shipped three times, and it has not recurred. The analogous
        selector here — an action body may call and may branch on its result,
        but may not contain domain logic — is harder to express and might not
        be expressible at all. Nobody has tried. Until somebody does, this
        entry is the rule and a reviewer is the enforcement, which is exactly
        the arrangement that failed three times.

98. **A TEST THAT CLICKS BY ACCESSIBLE NAME CANNOT SEE WHETHER ANYTHING IS
    VISIBLE, AND EVERY BEHAVIOURAL TEST WE WRITE CLICKS BY ACCESSIBLE
    NAME.** — 2026-09-05.

        Production load 1011 showed "TOTAL 231" to an owner holding
        `load:update`, and it was reported as an editor that had gone missing.
        The editor was rendering. `MilesField`'s resting state carried only
        `hover:text-accent`, so until a mouse touched it, it was pixel-identical
        to the static figure beside it.

        FIVE TESTS COVERED THAT COMPONENT AND ALL FIVE PASSED. They commit on
        blur, commit on Enter, abandon on Escape, skip the no-op save, and keep
        the typed value when the server refuses — genuinely good tests, written
        after a real defect, in a real DOM. Every one of them begins
        `getByRole('button', { name: /Edit: Miles/ })`.

        THAT QUERY IS THE BLIND SPOT. It finds the element through the
        accessibility tree, which is exactly right for asserting behaviour and
        says NOTHING about whether a human looking at the screen could tell the
        element was there. A button styled as plain text has a perfect
        accessible name. So does a button styled as nothing at all.

        WHAT MADE IT SURFACE was a layout change, not a styling one: the editor
        used to sit as its own element under a labelled figure, where POSITION
        carried the affordance — "this one is yours" — and merging it into the
        total slot to fix a duplicate removed that signal without touching a
        line of MilesField. The component that broke was not the component that
        changed, which is why review found nothing.

        SO "CAN THE USER SEE IT" IS ITS OWN ASSERTION and now has one:
        `looks editable before anyone touches it`, watched failing with the
        underline removed — load 1011's exact state. It is a class assertion,
        which is ordinarily a smell; here the class IS the affordance, and the
        alternative is a screenshot test this project does not have.

        THE GENERAL FORM, for anything else with an interactive resting state:
        behaviour and visibility are separate claims and take separate tests.
        Flag 95 said a working mechanism and a present mechanism are different
        claims; this is the third member of that family — a mechanism that is
        working, present, and invisible.

99. **A PARENTHESISED `'use client'` SILENTLY TURNS A CLIENT COMPONENT INTO A
    SERVER ONE, AND EVERY GATE WE HAVE PASSES IT.** — 2026-09-05. **NOT
    FIXED.**

        Adding an import above the directive in `TripsImportForm.tsx` left
        `'use client'` as the second statement, which makes it an ordinary
        expression rather than a directive. Prettier then formatted that
        expression the way it formats any leading string expression:

            ;('use client')

        The file stopped being a client component. `useActionState`, `useRef`
        and `useState` were still imported and called, and nothing said a word.

        WHAT PASSED. `tsc --noEmit` — clean, because it is valid TypeScript.
        `npm run lint` — **exit code 0**, because the only complaint is
        `@typescript-eslint/no-unused-expressions` at severity **warning**,
        inherited from `next/typescript`. `prettier --check` — clean; prettier
        WROTE the broken form. The unit suite — clean, because no test renders
        this component. `npm run check` — clean, all of it.

        THE ONE-LINE CHANGE, so nobody has to go looking: in
        `eslint.config.mjs`, the first `rules` block (beside
        `@typescript-eslint/no-explicit-any`), add

            '@typescript-eslint/no-unused-expressions': 'error',

        That is broader than the directive case and would need a sweep of
        whatever else it catches, which is why it is written down rather than
        done — a rule turned to `error` in the same commit as a feature is a
        rule that gets turned back off.

        THE CASE FOR IT GOT MADE BY ACCIDENT, ONE COMMIT LATER. Removing the
        import radios orphaned two `ImportMode` imports, and lint caught them
        as **errors** — `@typescript-eslint/no-unused-vars` is configured at
        `error` in this repo's first rules block, four lines above where the
        one-line change goes. The build failed, the names were printed, the fix
        took a minute.

        SAME LINTER, SAME RUN, SAME KIND OF DEAD CODE. One class fails the
        build and one class scrolls past in a stream that exits 0, and the only
        difference between them is a word in a config file. That is a sharper
        argument than the original entry made: the severity IS the difference
        between a caught bug and a shipped one, and here both outcomes were
        observed the same evening on the same command.

        THIS IS FLAG 87'S TWIN, AND THE DIFFERENCE IS THE POINT. There the
        diagnosis was DESTROYED by how it was reported — the reporter never
        ran, so the evidence did not exist. Here the evidence was PRODUCED,
        correctly, naming the right file and the right line, and then
        discarded: a warning in a stream of output whose exit code says
        everything is fine. A signal nobody reads and a signal nobody wrote
        are the same signal.

        AND IT IS WHY `npm run lint` EXITING 0 IS NOT THE SAME CLAIM AS "lint
        found nothing". The exit-code rule in AGENTS.md says read the status
        before anything filters the output; this is the case where the status
        itself is the filter.

100.  **A FACT NOBODY RENDERS IS A FACT NOBODY CORRECTS.** — 2026-09-06.

      The topbar's account control read `OW` on every screen. Not the role, not
      initials — `userInitials="OW"`, a literal in the layout, the same two
      letters for everyone who had ever logged in. Replacing it with the real
      name was a two-line change, and the moment it shipped it printed
      **"Owner"**.

      THAT WAS NOT A BUG IN THE REPLACEMENT. `User.name` for the owner said
      `Owner`, straight from `prisma/seed.ts`. Reading production properly
      showed four of five users named after their jobs — `Owner`, `Dispatch`,
      `Accounting`, and `Disptach`, which is a TYPO OF A JOB TITLE. That last
      one is the whole flag in one row: somebody mistyped a placeholder at
      account creation and it survived for weeks, because no screen displayed a
      name and no screen edited one.

      SO THE FAILURE WAS NOT THE WRONG DATA. It was that the data had no
      reader. A value nobody sees is a value nobody can notice is wrong, and a
      value nobody can edit is one nobody can fix once they do. Both halves are
      required, and this had neither.

      IT IS FLAG 98'S SIBLING, one layer out. There the mechanism was present
      and invisible — a button styled as text, working perfectly, uncheckable by
      any test that finds it through the accessibility tree. Here the DATA was
      present and invisible, uncheckable by any human because nothing put it on
      a screen. In both cases everything passed, because "renders correctly" and
      "renders something true" are different claims and only the first has a
      test shape.

      WHAT IT COST TO FIND: nothing, and that is the uncomfortable part. It
      surfaced as a side effect of a cosmetic change nobody made for this
      reason. Had Daler not asked for the name in the corner, those rows would
      still say `Disptach`.

      WHAT WAS DONE: `setOwnName` and a field on /account, so the fact now has
      both a reader and an editor. Deliberately NOT a migration rewriting the
      names — they belong to real people and only they know what they should
      say. And the topbar has tests about IDENTITY now rather than layout,
      watched failing by putting the literal back.

101.  **A GUARD PLACED BEHIND A STRICTER GUARD IT DOES NOT KNOW ABOUT CAN NEVER
      FIRE.** — 2026-09-06.

      `/drivers/new` sent the dropped CDL as base64 in a hidden field to a
      server action. Inside that action, before anything else:

          if (base64.length > MAX_DOCUMENT_BASE64_BYTES) return tooLarge

      10MB, matching the extraction cap, with a comment explaining the choice.
      It never once executed. Next rejects a server-action body at **1MB** by
      default, and base64 inflates by 4/3 — so the real ceiling on a dropped
      file was **~750KB**, enforced by a framework that had never heard of this
      check, and the refusal arrived as the generic error boundary with
      `Error: Body exceeded 1 MB limit.` visible only in `wrangler tail`.

      THE GUARD WAS CORRECT, PRESENT, AND UNREACHABLE. Flag 95 is about a
      mechanism that works and a path that never reaches it; this is that one
      layer down — the path reaches the guard, but only after something stricter
      upstream has already refused. A limit is only a limit where nothing
      rejects first, and "first" is a fact about the whole stack rather than
      about the function.

      IT LOOKED LIKE DILIGENCE, which is what made it invisible in review: a
      named constant, a bound check, a comment citing the reason for the number.
      Everything a careful size check has except effect.

      WHAT MADE IT SHIP: nothing walked the path. `tests/cdl.test.ts` called
      `cdlPrefill` and `readCdl` directly — both pure, both passing — while the
      commit message said "dropping a card walks the whole path". The claim and
      the evidence were about different things. A 67KB corpus PDF worked when
      tried by hand, which is exactly the size that hides this.

      AND WHY NO ROUTE HANDLER HAD EVER BEEN TESTED HERE: `server-only` throws
      when anything but a server bundler resolves it, so every handler reachable
      from `auth-context` was unimportable under vitest. A build-time marker had
      been quietly deciding what was testable. The node project now aliases it to
      an empty module — the real package still guards the build.

      THE FIX WAS A SHAPE, NOT A NUMBER. Raising `serverActions.bodySizeLimit`
      would have worked and was refused for being GLOBAL: every action in the
      application accepting multi-megabyte bodies to solve one upload's problem.
      A file upload that cannot use a presigned URL — because no driver exists
      to mint one against — is still a file upload, and a route handler is the
      honest shape for one, with the limit stated on the path it governs.
      Multipart rather than base64 removed the 4/3 inflation entirely, and the
      browser now downscales images to 1600px, which is the fix at the source.

102.  **A BRIEF CAN ASK FOR A ROW SHAPE THE SCHEMA HAS NO COLUMN FOR.** —
      2026-09-07.

            Two of them, in one ruling, and both were found by building rather than
            by reading — which is the argument for previewing before writing.

            **`Truck.companyId` is `NOT NULL`, so a truck cannot "seed unassigned."**
            The ruling said the Midwest Global truck and the two with a blank MC
            "seed unassigned, three unassigned total". There is no such row: a truck
            belongs to an operating authority in this schema, which is the whole
            mechanism behind "which authority ran unit 105 in Q2". The seed HOLDS
            those three and names them with year, make, VIN and plate. Parking them
            under a default authority would have been this system inventing which
            carrier is legally responsible for a vehicle.

            **`Driver ID` — the stated idempotency key — has nowhere to live.** The
            ruling named it correctly and for the right reason: it is stable where
            names are not. `Driver` has no `externalId`, and neither does any other
            model — the string does not appear in `schema.prisma`. So the drivers
            seed is the trucks seed minus a key, and it is not written.

            THE SCHEMA WINS AND THE CONTRADICTION GETS FLAGGED, per AGENTS.md,
            rather than being resolved by matching on `(companyId, firstName,

      lastName)` — which happens to be unique across all 54 rows TODAY and is
      therefore the most comfortable way to be wrong. It works until somebody
      marries, or until two Ivanovs are hired.

103.  **A BACKSTOP SIZED FOR DEMO DATA IS NOT KNOWN TO WORK ON THE REAL
      FLEET.** — 2026-09-07.

      `findAuthorityDrift` called `currentAuthority` once per asset, serially,
      inside the 5-second interactive transaction `runInOrg` opens. Against the
      three trucks dev had, ~1s. Against the 49 real ones, 5542ms — and the
      failure was not "drift found" but

          A query cannot be executed on an expired transaction

      a backstop reporting an infrastructure error where an answer belongs. It
      is now one query for every open period plus an in-memory lookup; the
      assets, the comparison and the definition of drift are unchanged.
      `currentAuthority` is untouched, being the right shape for one asset on
      one screen.

      IT WAS FOUND BY SEEDING, NOT BY REVIEW. Nothing was wrong with the check
      until the database held a realistic number of rows, and no test would have
      said so, because every test that exercised it ran against fixtures. The
      54 drivers would have made it worse.

      THE SAME SEED ALSO PROVED THE CHECK STILL BITES: its first run created 46
      trucks with a bare `truck.create` and no open `AssetAssignment`, which is
      drift by that function's own definition — "a missing period means somebody
      wrote a row around the service layer", and a seed is exactly that. All 46
      were caught. The seed now opens the period, dated `2026-08-01` rather than
      the moment the script ran, and repairs a missing one on re-run.

104.  **TESTING A GUARD BY EDITING THE CONSTANT IT GUARDS, WITH `--write` STILL
      ON THE COMMAND LINE.** — 2026-09-07.

      The drivers seed refuses to write if any load picks up before its stated
      `effectiveFrom`. To watch that refusal fire, the constant was moved from
      `2026-08-01` to `2026-09-01` — and the command that had been used all
      session, `--write`, was run unchanged. The date was not late enough to
      trip the guard, so nothing refused: the seed proceeded and wrote **54 pay
      rules dated 2026-09-01**, a month wrong, on the one table whose whole
      purpose is to be correct about dates.

      It was caught immediately, the 54 rules and 54 asset periods were deleted
      by a scoped statement that counted what must SURVIVE before deleting
      anything, and the seed re-ran clean. Nothing reached production.

      TWO SEPARATE LESSONS AND THE SECOND IS THE REAL ONE:

      A guard test changes the input, never the constant, whenever the constant
      is also what gets written. Here the same value does both jobs, so an
      edit meant to probe the check silently re-dated the data.

      And a guard test runs in the mode that CANNOT write. `--write` was left on
      out of habit from the previous command. The seed already had the right
      shape — preview by default, writing behind a flag — and the flag was
      typed anyway.

      THE FIRST ATTEMPT ALSO PROVED NOTHING, which is how the mistake surfaced:
      `2026-09-01` did not fire because dev's earliest pickup is
      `2026-09-01T09:00`, and `lt` midnight correctly matched nothing. A guard
      that stays silent has not been shown to work — it has been shown to be
      silent. Re-tested at `2026-09-05`: refused, named 6 stops and load 1113
      by number and exact time, wrote nothing.

105.  **THE PREVIEW MEASURED A SUPERSET OF WHAT THE WRITE MATCHED ON.** —
      2026-09-07.

      The drivers seed links a driver to a truck on `(authority, unitNumber)`,
      because that is what `truck_unit_per_company` makes unique. Its preview
      asked a different question — does this unit number exist ANYWHERE — and
      so reported **3** drivers whose truck was missing. The write then linked
      **32 of 47**.

      The 12 in between are drivers whose row names one carrier and whose truck
      belongs to the other. Real, interesting, and exactly the sort of thing a
      preview exists to surface before anybody presses the button; instead the
      preview gave the comfortable number and the discrepancy showed up in a
      count afterwards.

      Twin of "count the thing you are claiming, not a superset of it", one
      layer along: the instrument and the action must share a key, not merely
      resemble each other. The preview now derives from the same composite key
      the write uses and the two agree by construction — and the cross-authority
      12 are printed as their own section, unresolved, because choosing a
      carrier for them is the question the record exists to answer.

106.  **`--record` WRITES THE LOCAL FOLDER LISTING UNDER A PRODUCTION LABEL,
      AND ITS `verified` FLAG MEASURES A CREDENTIAL RATHER THAN A READ.** —
      2026-09-07.

      Reported by the owner after the `driver_external_id` migration: the
      record step printed `UNVERIFIED — on report`. It is worse than that
      sentence suggests, and the failure is the cardinal instrument rule.

          const local = localMigrations()
          const verified = Boolean(process.env.PROD_DIRECT_DATABASE_URL)

      `record()` writes `local` — a listing of `prisma/migrations/` on this
      machine — into a file named `production-migrations.json`, describing it as
      `applied`. Production is never asked. The check half of the same script
      DOES query production when the URL is present and prints
      `source: production database`; `record()` reuses none of it.

      SO THE DANGEROUS CASE IS NOT THE ONE THAT WAS SEEN. `verified: false` was
      correct here by accident — the owner ran `--record` in a fresh window
      without the production URL in it. Had that variable been present, the
      script would have written `verified: true` having still never read a row
      from production: the marker would assert that production holds whatever
      this checkout's folder holds, and carry a flag claiming it was confirmed.
      "Never supply the baseline you are testing", with the baseline written to
      disk and stamped verified.

      THE CONTENT IS NONETHELESS CORRECT THIS TIME, and that distinction
      matters: the check immediately before it read production directly and
      reported 32/32, no gap. What is untrustworthy is the mechanism, not this
      file. It also revealed the marker had been stale since 2026-08-16 —
      `--record` added three migrations applied weeks ago
      (`location_facility_code`, `load_stop_leg_miles`,
      `settlement_line_stop_dates`) alongside the new one, because nobody had
      run it since.

      NOT FIXED IN THIS COMMIT, deliberately: the fix changes the script the
      owner's deploy ritual is mid-way through using. `record()` should take the
      applied list from the same production query the check performs, refuse to
      write when it has not read production, and set `verified` from whether
      that read happened rather than from whether a string exists in the
      environment.

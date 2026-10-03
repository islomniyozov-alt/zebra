# ZEBRA — PHASE 5 BRIEF: SMART LOAD CREATION

**Version 1** — 2026-08-07
**For:** Claude Code, working in the zebra repo
**Reads with:** the four closed briefs, `TMS-DESIGN-SYSTEM.md`, `prisma/schema.prisma`. All standing rules carry — 9-money especially: extracted dollars are parsed into integer cents through `money.ts` or they are not parsed at all.

> Transcribed into the repository at Step 1, per the rule Phase 3 earned the
> hard way and Phase 4 kept: a brief that lives only in a chat log cannot be
> cited in review and its acceptance criteria cannot be checked. The text is the
> brief **as issued**; **§7 records what has been flagged against it**, in the
> Phase 1 style — contradictions get flagged, not silently resolved.

The goal, stated honestly: the win is the **first-time load from an unfamiliar rate confirmation** — the five-minute typing job of new addresses, reference numbers, and accessorials — collapsed to under a minute. The repeat load is already 6.4 s by keyboard; extraction does not compete with that and must never slow it: the typing path stays exactly as it is, upload-first is an _offer_, not a gate.

## 1. Architecture — decided, do not reopen

1. **Extraction prefills the existing Create Load form. There is no new review screen.** The "review step" the dream-spec wants already exists: it is the form, with every validation, conflict check, counter rule, and permission Phase 2 earned. Confirm = the same Save that has been tested since then. Extraction that auto-saves is forbidden.
2. **The engine is the Claude API** (model string a named constant, not scattered), called from the Worker with the document; `ANTHROPIC_API_KEY` as a secret on both workers (the owner sets it by the proven ritual). Structured output: a strict JSON shape, per-field values **with per-field confidence**; a response that doesn't parse is a failed extraction, never a half-filled form. Token cap per document; the walkthrough prints what one document costs, so the per-load cents are a measured fact, not a hope.
3. **Money fields obey the permission system, not the extraction.** A DISPATCHER's prefill contains no money — extracted rate figures land on the Document's OCR columns (carried since init, finally written) and surface on the **existing rate-entry panel** (P3 S1) for OWNER/ACCOUNTING as "extracted: accept / edit". The dispatcher books the freight; accounting accepts the money; nobody's wall moves. Pair-asserted in the dispatcher walkthrough.
4. **"Learning" is data, not ML.** Broker-name aliases and facility memory, written on dispatcher correction, applied on the next upload. No fine-tuning, no models trained, and the brief says so wherever the word "learn" appears.
5. **Extraction happens before the load exists**, so the document rides the `PendingUpload` path and attaches to the load at save — the pipeline's real shape (P4 S2's lesson), not worked around. An abandoned extraction leaves a pending row that expires; it never leaves an orphan load.

## 2. The owner owes this phase its corpus

Extraction is tuned against **real rate confirmations** — Werner's format, Relay's, the small brokers'. The owner supplies 8–12 real documents (redaction unnecessary; they stay in the dev bucket) with hand-checked truth for each field. That golden set is the acceptance instrument for §5, and it grows from the parallel run: every real load booked is a future test case. No golden set, no accuracy claim — the phase can build to Step 2 without it, not past.

## 3. Order of work

| Step | Work                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Deploy-day-one; extraction service: document → strict JSON (broker, stops w/ full addresses, dates/times, BOL/PO/reference, commodity, weight, pieces/pallets, trailer type, temp, seal, instructions, and the money fields; confidence per field); OCR columns written; token cap; unit tests on the parser incl. money-to-cents and malformed-response refusal |
| 2    | Upload-first create: the offer slot on `/loads/new`, PendingUpload ride, prefilled form with low-confidence fields visibly marked, provenance kept (extracted vs typed), document attached on save as RATE_CONFIRMATION; role-split money handling per §1.3                                                                                                      |
| 3    | Correction memory: broker aliases (extracted string → Customer, learned when the dispatcher corrects the match, applied next time); `ExtractionCorrection` log per field — the raw material for §5's accuracy numbers and nothing more                                                                                                                           |
| 4    | Facility memory: `Location` gains gate code, dock notes, hours, check-in instructions, contact, internal notes; extracted addresses matched to known Locations (normalized), matches prefill the memory alongside the address; unknown facilities offered for saving at confirm                                                                                  |
| 5    | Validation additions, warn-not-block per the P4 dispatch-warning precedent: duplicate BOL, duplicate PO, probable-duplicate load (broker+date+lane), missing-required flags, pickup-after-delivery already refused — each warning in words naming the conflicting record                                                                                         |
| 6    | Acceptance: the golden set run — per-field accuracy table against hand-checked truth, printed; cost per document, printed; dispatcher walkthrough grown and green; RU/RTL on the new surfaces; drift matching HEAD; brief closed with flags in the Phase 3/4 style                                                                                               |

## 4. Parked, with names

- **Email-in** (broker emails a rate con → draft load appears): requires inbound email routing, which requires **the domain** — its third dependent. The parked runbook block gains this line.
- **AI truck/driver recommendation**: needs HOS and live truck locations — ELD integration territory, a later phase; not promised anywhere in this one.
- **Anything called "continuous learning" beyond §1.4's data**: out, by architecture.

## 5. Acceptance excerpt

- [ ] Golden set: per-field accuracy printed as a table; every money figure that reached cents did so through `money.ts`
- [ ] A dispatcher's prefill carries no money key and no money label; the same document's figures reach OWNER/ACCOUNTING on the rate panel as extracted values — pair-asserted
- [ ] A corrected broker match is applied on the next upload of the same string; the correction row records both
- [ ] A known facility's gate code prefills; an unknown one is offered for save and appears on the Location afterwards
- [ ] Duplicate BOL warns in words, names the load, and proceeds only on confirm
- [ ] An abandoned extraction expires with the pending row; no orphan loads, no orphan documents
- [ ] One document's cost printed in the walkthrough output; the token cap proven by a document that exceeds it failing cleanly
- [ ] Typing path untouched: the repeat-load walkthrough still passes at its Phase 2 timing

---

## 6. Standing rules carried

One step per session; stop and report; deploy both workers at every step
boundary; "I measured X" is pasted output; negative checks are paired; the whole
suite runs every step. Phase 4 adds one: an applied migration file is closed to
edits, including its comments — `tests/migration-checksums.test.ts` enforces it.

---

## 7. Flagged against this brief

Recorded rather than resolved, per Phase 1's discipline.

1.  **The strict shape is enforced on OUR side, not by the API's structured
    output.** §1.2 says "Structured output: a strict JSON shape". The Messages
    API can be made to emit guaranteed-shaped JSON via tool use; this step
    instead sends the JSON Schema in the prompt and parses the answer with a
    parser that refuses everything the schema forbids.

    The choice is deliberate and worth stating because it looks like the weaker
    one. A tool-use guarantee binds the model to a shape; it does not bind it to
    a MEANING — `{"value": "42,000"}` where a number belongs, or a confidence of
    `0.82`, are both schema-valid in the shapes an API will accept and both are
    wrong here. The parser refuses them by name and says where. And a refusal on
    our side keeps working if the API's guarantee changes, is testable without a
    network, and is the same code path whichever model answers.

    The cost: the model can spend output tokens on an answer we then throw away.
    Measured in Step 6 against the golden set — if unparsable answers are common
    rather than rare, tool use is the fix and this flag is where to start.

2.  **The token cap is a BYTE cap, because input tokens cannot be counted before
    sending them.** §1.2 asks for a "token cap per document". The output side is
    a real token cap (`MAX_OUTPUT_TOKENS`). The input side is
    `MAX_DOCUMENT_BASE64_BYTES` — 10MB of base64, roughly 7.5MB of PDF — because
    counting a PDF's tokens requires the tokenizer, and the tokenizer requires
    sending it, which is the thing the cap exists to avoid.

    It is a proxy and it is enforced BEFORE the call, which is the half that
    matters: §5's box asks for "a document that exceeds it failing cleanly", and
    clean means the fetch never happens. `tests/claude.test.ts` asserts exactly
    that — the refusal, and an empty call log.

3.  **The price list is a copied constant and will go stale.**
    `PRICE_CENTS_PER_MTOK` in `claude.ts` is what the walkthrough multiplies by
    to print §5's cost-per-document. Nothing checks it against Anthropic's
    published prices, and nothing can without a network call on every run. When
    the figure is printed it should be printed as what it is — a computation from
    a constant recorded on a date — rather than as a measurement of a bill.

4.  **§2's corpus is owed before Step 3, and the phase should stop at Step 2
    without it.** The brief is explicit: "No golden set, no accuracy claim — the
    phase can build to Step 2 without it, not past." Recorded here at Step 1 so
    the reminder arrives before the work does rather than after: **8–12 real rate
    confirmations with hand-checked truth per field**, dropped in the dev bucket.

    Step 3 is correction memory, which is measured by the accuracy it moves;
    without a golden set there is nothing to move and nothing to report.

5.  **`ANTHROPIC_API_KEY` is not set on either worker.** The same shape as Phase
    2's flag 18 about `RESEND_API_KEY`: the code is built, deployed and tested,
    and the secret is an account-level act the owner performs. Until then the
    service throws `no_api_key` by name — which is why it is a named failure and
    not an empty result. **Owed:** two `wrangler secret put`, one per worker; the
    README carries the exact commands.

6.  **Phase 3's rate-entry wall had a gap on the create form, and wiring the
    prefill is what found it.** `createLoadAction` wrote `linehaulCents` from
    whatever was posted, with no permission check — so a DISPATCHER's create
    form could set a rate, on the one screen every load enters through.
    `load.financials:update` has been OWNER/ADMIN/ACCOUNTING since Phase 3 §1
    and the rate panel honoured it; this screen never asked.

    Closed on both sides: the action IGNORES a rate it may not accept (refusing
    would strand a load somebody just typed, and a dispatcher's load having no
    rate is what it looks like anyway), and the form renders no rate input at
    all for that role — §5 asks for no money LABEL, and a greyed box still
    announces one. Neither half is sufficient alone, which is why both are
    asserted in `verify-dispatcher`.

7.  **A server-rendered form accepts a file before React can hear about it, and
    that is what made the upload-first walkthrough flake.** Not a race between
    reads, which is what it looked like: `setInputFiles` succeeds on an
    unhydrated page, the file lands in the input, no `change` handler exists
    yet, and the offer sits at idle while the script waits for fields that were
    never going to fill. Fast runs hydrated first and passed; slow ones scored
    2/14 on a feature that was working.

    The walkthrough now gates on hydration by typing into a CONTROLLED input and
    reading the value back — a controlled input holds a typed value only once
    React is listening, so it is a direct question rather than a sleep that hopes
    — and re-sends the file once if the offer has not moved off idle. Four
    consecutive 16/16 runs.

    Worth carrying beyond this script: any walkthrough that drives a React form
    on a server-rendered page has the same hole, and a passing one may simply be
    fast enough today.

8.  **Reading a form field at a time is reading several different moments.** The
    same script polled one field until it filled and then read six more, one
    round trip each; a re-render between any two produced a report where the rate
    was "(empty)" on a form that then saved 245,000 cents. It takes ONE
    `page.evaluate` snapshot now, and waits for two consecutive snapshots to
    agree before asserting — which is what "the form has settled" means and what
    the first version assumed without checking. The save side had the same shape:
    two independent polls, one query now.

9.  **The truth sheets are gitignored with the corpus, and the accuracy run is
    therefore not reproducible from a clean checkout.** §2 says the documents
    "stay in the dev bucket"; the sheets derived from them carry the same
    content — `brokerName: ITS Logistics LLC, linehaulCents: 400000` is the
    customer's information in a form that is easier to read than the PDF, not
    less sensitive than it.

    The first draft of the ignore rule committed them, on the reasoning that
    they hold "field values rather than documents". That reasoning was wrong and
    is recorded here rather than quietly corrected: whose information it is does
    not change because it was retyped.

    The cost is real — §5's per-field accuracy table has to be pasted from a run
    on the owner's machine rather than re-derived by a reviewer from the
    repository. That is the owner's trade to reverse.

10. **The first draft of the golden set already shows three things worth
    deciding before the accuracy run, not after.** All 13 documents were read;
    none was refused. 478 fields, 151 of them null, and only 3 marked
    low-confidence — which is itself a finding, because the confidence signal
    is what Step 2's form marks and a model that is almost never unsure gives
    the marking nothing to do.
    - **Zero is being returned where null was asked for.** `werner-1` has
      `weightLbs: 0`, `pieces: 0` and `pallets: 0`, all at HIGH confidence, on
      a document that plainly does not print them. The system prompt says "a
      field the document does not carry is null. Never guess, never default" —
      and 0 at high confidence is the most dangerous available answer, because
      it prefills a form with a weight.
    - **Two documents extracted a $0.00 linehaul** (`semail (4) (5)`,
      `semail (58)`), and a third from the same broker read $1,150.00. A zero
      rate is not a rate.
    - **Three documents produced no rate at all.** Whether those pages carry
      one is exactly what the owner's review answers, and it is the difference
      between a prompt problem and a corpus fact.

    None of these is fixed yet, deliberately: the corrections are the evidence
    for whether the prompt changes, and changing it first would mean tuning
    against the model's own answer.

11. **The sheets are marked verified in conversation but not in the files, and
    the accuracy run must keep refusing them.** Step 3 was authorised with
    "Sheets verified"; all 13 still read `"verified": false`, and not one of
    478 `truth` values differs from `extracted`. So the golden set is currently
    the model grading its own homework, which is the one thing §2 exists to
    prevent.

    This blocks §5's accuracy claim at Step 6, not Step 3 — correction memory
    is measured by behaviour a walkthrough can assert without it. Recorded
    here rather than worked around: the run refuses an unverified sheet, that
    refusal stays, and flag 10's three findings are the specific lines most
    worth a pen.

12. **Normalising a broker name harder than case, space and punctuation would
    merge two of this carrier's real customers.** `ITS Logistics LLC` and
    `ITS National LLC` are both in the corpus and are different companies. The
    obvious next step for a matcher — strip the legal suffix, compare the
    leading token — folds them into one, and the failure is silent: the screen
    shows a name that looks right and the invoice goes to the wrong company.

    So `normalizeAlias` folds case, collapses whitespace and drops `.` and `,`
    (because "Big M II, Inc." and "Big M II Inc" are one broker on two
    documents) and stops. `resolveBroker` returns null rather than a best
    guess. The restraint is asserted in both directions, in a unit test and
    against real Postgres, because a later "improvement" is exactly what would
    undo it.

13. **The correction diff was comparing a field against half of itself, and the
    walkthrough is what found it.** The create form has ONE input per stop
    holding `Salem, OR`; the diff compared it against the extracted `city`
    alone, so every upload where nobody touched the stops logged two
    corrections. The first walkthrough run wrote 3 correction rows for 1
    correction — and had the assertion been a range rather than an exact count,
    it would have passed and §5's accuracy table would have counted unedited
    loads as mistakes.

    Fixed with a `stops[n].place` path that assembles the value the way the
    form does. The general shape is worth carrying: **a correction log has to
    compare against what the person SAW, and what they saw is the form's
    fields, not the extraction's.**

14. **Memory substituting a name silently is a false statement on the screen,
    so it now discloses.** The offer replaced the extracted broker with the
    remembered customer and left the hint reading "From the document" — under a
    name the document does not contain, on the single field where being quietly
    wrong sends an invoice to the wrong company.

    The hint now reads "From a past correction — the document says X", naming
    the printed string so the substitution can be seen and undone. The
    document's own words stay in `extracted`, untouched, so the correction log
    still compares against what the model said rather than against what memory
    put there.

15. **The correction log is written by a path that swallows its own failures,
    and that is deliberate.** `createLoadAction` records corrections and learns
    the alias inside a `try {} catch {}` that does nothing. Memory is a
    convenience; failing to learn must never fail a save that a dispatcher has
    already made and watched succeed.

    The cost is that a persistent write failure here is invisible — the feature
    would quietly stop learning and nothing would say so. Named because the
    honest fix is a counter on the accuracy run ("N loads created from an
    upload, M with a correction row"), which Step 6 is the place for.

16. **Four of §3 step 4's six columns already existed, so this step added two
    and a key.** The step reads "`Location` gains gate code, dock notes, hours,
    check-in instructions, contact, internal notes"; `hours`, `instructions`,
    `contactName`/`contactPhone` and `notes` have been on the model since
    Phase 2. Added: `gateCode`, `dockNotes`, and `normalizedAddress` — the
    match key, which the step's second clause needs and its first does not
    name.

    `instructions` is what §3 calls check-in instructions and `notes` is what
    it calls internal notes; both keep their older names, with a comment
    saying so, rather than a rename migration that would touch every read of
    them for a word.

17. **The match key was wrong in a way only the second document could show,
    and the integration test is what showed it.** The first version put the
    postal code in the key when the document printed one and the city when it
    did not — so the same dock got two keys depending on which broker's
    template printed it, and never recognised itself. Every unit test passed:
    each of them folded two addresses that both had zips.

    The key is now the coarse part — street line and state — and the rest is
    compared in `placeAgrees`, where a value counts against a match only if
    BOTH documents printed it. The weakest match it makes is named in its own
    comment: two documents that each omit the city and the zip, with street
    lines that fold identically, are taken to be one dock.

    Worth carrying: **a fold is not tested by folding two things that are
    alike.** It is tested by the pair that differ in the way real documents
    differ, which here was "one of them has a zip".

18. **A street suffix can be canonicalised where a company suffix cannot, and
    the two folds sit ten files apart.** `Turner Road` and `Turner Rd` are one
    street; `ITS Logistics LLC` and `ITS National LLC` are two brokers. So
    `facility-memory.ts` has a street-word table and `correction-memory.ts`
    deliberately has nothing of the kind — an asymmetry that looks like an
    inconsistency until the failure modes are named, which is why both files
    say why in the code rather than here.

    Directionals and suite numbers stay: "100 Main St N" and "100 Main St S"
    are a mile apart, and Ste 3's gate code does not open Ste 4.

19. **Facility memory is gated on `location.manage:read`, separately from the
    `document:create` that pays for the extraction.** ACCOUNTING holds the
    second and not the first — it uploads paperwork at billing time — so it is
    the exact role a payload built on "whoever can extract can see everything
    extracted" would have leaked a gate code and a dock contact to. The
    `facilities` key is absent from its answer rather than present and empty,
    and `verify-facility-memory` asserts the pair: 200 on the extraction, no
    key in the body.

20. **A saved facility takes the stop away from create-on-miss, and that is a
    behaviour change on the create form.** Before this step every stop resolved
    through `resolveLocation`, which creates a Location named after whatever
    was typed — "Salem, OR". A stop whose dock is known or was just saved now
    points at the FACILITY instead, and the stop's name is the facility's.

    Guarded by an agreement check: the facility is used only if the place field
    still reads what the extraction said. A dispatcher who typed "Portland, OR"
    over "Salem, OR" has changed where the freight goes, and attaching a Salem
    dock with a Salem gate code to it would be the extraction overruling the
    person. The same comparison the correction log makes, for the same reason.

21. **Nothing backfills `normalizedAddress`, so every Location that existed
    before this migration is unmatchable.** Not a defect today — every one of
    them is a lane endpoint with no street address, which would get a null key
    anyway — but it will be one the moment a facility is created by any path
    that does not go through `saveFacility`. There is no Locations screen yet;
    when Phase 6 builds one, writing the key on save is the whole of the fix,
    and this flag is the reminder that it is not automatic.

22. **§3 step 5 asks for a duplicate-BOL warning against a number the schema
    never kept.** The extraction has read `bolNumber` and `poNumber` since step
    1 and dropped both at save: `Load` had `referenceNumber` — the broker's
    load number — and nothing for the shipper's. A warning about a repeated BOL
    cannot be written against a column that does not exist, so this step added
    `Load.bolNumber` and `Load.poNumber`.

    Neither is unique, deliberately. Two loads legitimately carry one BOL when
    a shipment is split, which is the case the whole warn-not-block posture
    exists for: the office is told and decides.

23. **The BOL and PO fields appear only when a document brought them, because
    §5's last box is the typing path.** "Typing path untouched: the repeat-load
    walkthrough still passes at its Phase 2 timing" — and two more tab stops on
    the hot path is exactly how that stops being true. A typed load has no BOL
    at booking anyway; it is known at pickup.

    The cost is real and is the flag: **a load booked by typing can never be
    given a BOL**, because there is no edit screen for one either. Until there
    is, the duplicate-BOL warning only protects freight that arrived as a
    document. Phase 6's load-edit work is where that closes.

24. **The warnings are thrown, not returned, and that is what keeps the
    create-on-miss litter out.** By the time the checks run, `resolveBroker`
    and `resolveLocation` have already made a Customer and two Locations inside
    the transaction. Returning the warnings normally would COMMIT them — a
    broker and two places for a load nobody booked, one set per press of a
    button somebody is about to think better of. `LoadWarningsError` rolls the
    transaction back; the walkthrough asserts one customer after a warned
    attempt, not one per attempt.

25. **A confirmation confirms THESE warnings, not "warnings in general".** The
    form posts back a signature of the exact set it was shown — kinds and
    values, sorted — and the action recomputes it. Change the BOL after being
    warned about it and the set changes, the signature does not match, and the
    new conflict is shown rather than waved through by a tick from a moment
    ago. A confirmation keyed on the warning KIND alone would wave it through,
    which is the version this nearly was.

26. **"Missing rate" is a money label, so a DISPATCHER is never told it.**
    §1.3 keeps money off that screen entirely; a warning saying the rate is
    empty announces that the load has one. `WarningInput.linehaulCents` is
    `null` for a role with no rate field and `0` for a role that left it blank,
    and the two must not collapse — a check written as `!linehaulCents` would
    have told every dispatcher about the money they are not allowed to see.

27. **What counts as "missing-required" is this step's own ruling, not the
    brief's.** §3 step 5 says "missing-required flags" without saying which
    fields. Chosen: pickup date, delivery date, and rate — the three that make
    a load invisible on a screen that sorts by them or un-invoiceable. NOT
    chosen: truck, driver, weight, commodity. A load is routinely booked before
    it has a truck, and warning about that on every booking is how an office
    learns to click through warnings without reading them.

    The probable-duplicate rule is the same kind of ruling: broker + pickup day
    - lane, and deliberately not the rate. Two loads for one broker down one
      lane on one day at different rates are still probably one load booked
      twice — and comparing rates would suppress the warning exactly when the
      second booking has a typo in it.

28. **The integration suite cannot share the dev database with a browser
    walkthrough, and I proved it the expensive way.** Four Playwright
    walkthroughs were run against the deployed dev worker while the suite was
    running — same Neon branch — and the suite came back **22 failed across 3
    files**, every failure a dropped WebSocket or an expired transaction
    (30516 ms against a 20 s budget). All of them in `auth.test.ts` and
    `settlements.test.ts`, none in anything this step touched. The run took
    3768 s against a usual ~1800.

    Re-run alone: **24 files, 363 tests, 0 failed, 2982 s.**

    Phase 4 already learned this for the integrity check and put the reason in
    that check's failure message. The rule is wider than the check: **nothing
    else may touch the dev branch while the integration suite runs** — not
    another suite, not a walkthrough, not a seed. Worth a guard rather than a
    paragraph, and one was not built here.

    The near-miss worth naming: a red suite whose failures are all in files the
    change never touched is the shape of an environment problem, and it is also
    exactly the shape of a real bug in something shared. Being right about
    which one it was required re-running it alone, not reasoning about it.

29. **Making a date warn meant taking `required` off it, which reverses a
    Phase 2 decision.** §3 step 5 asks for "missing-required flags,
    warn-not-block". The two date inputs carried HTML `required`, so the
    browser refused the submit and the warning sentence could never be printed:
    a block and a warning for one field are a contradiction, and the step's own
    posture picks the warning. Found by the dispatcher walkthrough, which
    reported zero warnings for both roles on a form that was working exactly as
    Phase 2 built it.

    The case this now serves is the dispatcher taking a call who does not have
    the appointment time yet. The cost is that a load can be booked with no
    dates at all — said out loud on the screen, in a sentence that names what it
    costs, rather than prevented.

30. **The RTL pass found the Phase 4 bidi bug again, in a place the Phase 4 fix
    could not reach.** A facility's gate code of `#4417` rendered as `4417#` in
    Farsi. The design-system rule was written against the field that found it —
    an invoice-number INPUT — and said "any input whose value is a Latin
    identifier"; a gate code in a read-only panel is not an input.

    The rule is about the VALUE, not the control. Amended in its own commit
    before the code, per AGENTS.md, and gate codes and phone numbers are now
    named in it. The failure is worth keeping in view: a driver reads a gate
    code off this screen and punches it into a keypad, and the reversed one does
    not open the gate — the value is right in the database and wrong where
    somebody acts on it.

31. **§5's "typing path untouched at its Phase 2 timing" is NOT met, and the
    measurement says how much of that is this phase.** Phase 2 recorded a
    repeat load at **6.4 s**. Today, on the deployed dev worker:

    |                                          | repeat load, keyboard only |
    | ---------------------------------------- | -------------------------- |
    | Phase 2 (recorded)                       | 6.4 s                      |
    | HEAD                                     | 12.34 s / 12.47 s          |
    | HEAD with Step 5's warning query removed | 11.64 s / 11.80 s          |

    So Phase 5 costs the typed path about **0.7 s** — one duplicate-load lookup,
    the only Phase 5 query a typed load reaches (the facility and correction
    paths need a `pendingUploadId` and skip entirely). The other **~5 s** was
    already there before this phase opened.

    `wrangler tail` on one save: **CPU 477 ms, wall 21.8 s.** It is not
    computation, it is round trips — which is Phase 2 §16 flag 20 exactly
    ("~300 ms of CPU against ~18 s of wall … the fix is fewer statements inside
    the lock, not a longer timeout"), now costing the single-user case rather
    than only the concurrent one.

    Under the forty-second target by a wide margin, and roughly double the
    number the brief holds it to. Not fixed here: the fix is a statement count,
    which is a Phase 6 job with its own measurement, and doing it during an
    acceptance run would mean changing the thing being accepted.

32. **The acceptance instrument has its own tests, because it is code that
    certifies code.** `scripts/_accuracy-score.mjs` is separated from the run so
    `tests/accuracy-score.test.ts` can exercise it without a network, a browser
    or a corpus. Those tests immediately found a real defect in it: `normalize`
    stripped any trailing `:00`, which turned a stop time of `07:00` into `07` —
    so two documents scheduled an hour apart would have scored as agreeing, on
    the field most likely to be wrong.

    An instrument whose only evidence is that the code looked right measures
    nothing twice.

33. **Item 12 asked for `Truck.plateExpiresAt` and it was NOT added.** The
    brief of 2026-09-21 lists it among the columns, and "plate expiry joins the
    item 9 warnings" as the behaviour. The behaviour was already true and the
    column would have been a second copy of the date that makes it true.

    THE DATE ALREADY HAS A HOME THAT WARNS. Datatruck's trucks export carries
    `Registration expiry date`; `src/lib/datatruck/trucks.ts` writes it as a
    `ComplianceItem` of type `REGISTRATION`; `REQUIRED_TRUCK_DOCUMENTS` lists
    REGISTRATION, so item 9 already raises `compliance_expired`,
    `compliance_expiring` and `document_missing` against it. A plate and its
    registration expire on one date — Datatruck has one column for the pair,
    and so does the physical cab card.

    THIS IS THE `Driver.cdlExpiresAt` DECISION, SECOND TIME. That field is on
    the driver form and deliberately not on the driver row, and the comment
    says why: "a second copy of the same date, free to disagree with the one
    that raises the warning." AGENTS.md says the schema wins over a brief and
    the contradiction gets flagged rather than silently resolved. This is the
    flag.

    WHAT WOULD CHANGE THE ANSWER: if a plate expiry and a registration expiry
    are genuinely two dates in this fleet's paperwork — some states do issue
    the tag and the cab card on different cycles — then they are two facts and
    the column is right. Nobody has been asked. The corpus cannot settle it:
    it has one date column, which is consistent with both answers.

    Reversing this is a migration and one field spec; nothing has been built
    that would have to be unbuilt.

34. **`Truck.insurancePolicyNumber` was not added either, and this one is
    weaker.** `ComplianceItem.identifier` is documented in the schema as
    "policy number, permit number, CDL number", and `createDriver` already
    writes the CDL number into it beside the CDL expiry. So the policy number
    has a home.

    WHAT MAKES IT WEAKER THAN FLAG 10: `ComplianceItem.expiresAt` is NOT NULL,
    so a policy number cannot be recorded there without an expiry date. A
    carrier who knows the policy number and not the renewal date has nowhere
    to put it, and "enter a date you do not have" is how a column fills with
    invented dates. Unlike the plate expiry, nothing here is being duplicated
    and nothing raises an alarm off it.

    NOT ADDED ANYWAY, for now, because adding it would make two homes for a
    policy number rather than one — and the Datatruck export does not carry the
    column, so nothing is waiting to be imported into it. The 33 policy numbers
    that exist live on a customer-pasted fleet board, not a Datatruck export
    (see the import report). If the owner wants it on the row, it is one
    migration.

35. **Datatruck's `Fleet Status` column is not this `fleetStatus` and must
    not be imported into it.** The brief says "In service, Out of service, In
    shop". The export's `Fleet Status` holds `available`, `inactive` and
    `in_transit` — a dispatch-availability vocabulary, not a shop condition —
    and it DISAGREES with the export's own `Status` column on 28 of 113 rows.

    Mapping `available` to "In service" would be inventing a meaning the
    artefact does not carry, on a column whose two copies already contradict
    each other. Nothing was imported. The column ships empty and is filled by
    whoever is looking at the truck.

36. **Item 13 authorised new `ComplianceType` values; three new `DocumentType`
    values were added as well.** The brief says "No new stored fields except
    any ComplianceType the list needs and doesn’t exist". Five of the eight
    391.51 requirements needed a word that did not exist, and only two of
    those five fit `ComplianceType`.

    WHY THE OTHER THREE COULD NOT. `ComplianceItem.expiresAt` is NOT NULL. An
    employment application, a prior-employer inquiry and a road-test
    certificate do not expire, so filing them as compliance records would mean
    inventing an expiry for each — and an invented date eventually raises or
    suppresses an alarm about nothing. They are documents, which is what they
    are in the physical file too, so `EMPLOYMENT_APPLICATION`,
    `EMPLOYMENT_VERIFICATION` and `ROAD_TEST_CERTIFICATE` were added to
    `DocumentType`.

    Without them, five of eight requirements have nowhere to point and the
    definition cannot be written down at all — which is the one thing item 13
    is for. Nothing else was widened: no column, no table, and the checklist
    itself is computed on every read.

37. **The `dqf_incomplete` warning and item 9’s `document_missing` overlap on
    purpose, and it is worth a ruling.** With the required list now derived,
    a driver missing an MVR gets `document_missing: MVR` AND
    `dqf_incomplete: 1` on the same list row.

    They are not redundant: one names WHICH record is absent, the other says
    the file is not audit-ready and by how much — and only the second can see
    the three requirements evidenced by documents rather than dates, because
    `complianceWarnings` walks compliance records alone.

    They are still two chips saying one thing on a narrow column. The
    alternative is to stop emitting `document_missing` for drivers and let the
    DQF warning speak for the whole file, which loses “which one” from the
    list view. Left as it is, flagged rather than decided unilaterally.

38. **The workbench brief asks for eleven trip columns and §7.1 allows nine.**
    Owner's brief, 2026-09-29: "trips grid — trip, load, unit, total pay,
    driver gross, status, dates, pickup, delivery, miles". Counted out that is
    eleven columns, and `Table` THROWS above nine — the limit has been enforced
    in code since Phase 1, not merely written down.

    It was found the way it should be: the page 500'd on dev, the screenshot
    run refused to report a pass, and the stack named §7.1's own error. Nothing
    subtle — the guard did exactly what it exists for, on the first render.

    `AGENTS.md` says the design system wins and the contradiction gets flagged
    rather than silently resolved, so: **eleven columns behind a chooser, nine
    shown by default.** Hidden by default are `Load ID` — the broker's own
    reference, which is a lookup key rather than something read down a column —
    and `Unit`, because Zebra freezes ONE truck per settlement and that column
    repeats the same number on every row. Unit returns to the header box, which
    is where `ST-005562.pdf` prints it.

    THE ALTERNATIVE WAS TO RAISE THE LIMIT, and it is worth saying why not. The
    number nine is a claim about a 1080p screen, which is what the office uses;
    eleven columns fit only by truncating two places into uselessness. Datatruck
    shows eleven AND ships a `Columns` control in the same toolbar, so the
    artefact is not actually arguing for a wider table — it is arguing for a
    chooser, which §7.1.4 already specifies.

39. **§6.2.4 names two scopes for a standing charge; the schema's vocabulary has
    three, so `LEASED` would have been unreachable.** The section asks for
    "applies to (company drivers / owner-operators / all)".
    `Driver.employmentType` is an `OwnershipType`, and that enum is `OWNED`,
    `LEASED`, `OWNER_OPERATOR`.

    Under the two §6.2.4 names, a leased driver matches `ALL` and nothing else.
    An `Admin Fee` aimed at company drivers would skip every leased driver in
    the group, silently and indefinitely — and the only symptom is a deduction
    MISSING from a cheque, which nobody audits upward. An overcharge gets a
    phone call; this would not.

    `AGENTS.md` says the schema wins and the contradiction gets flagged, so:
    **four scope values — `ALL`, `OWNED`, `LEASED`, `OWNER_OPERATOR`.**
    `TMS-DESIGN-SYSTEM.md` was amended in its own commit (v10.11) to say the
    same thing and to say why, and `scopeCovers('OWNED', 'LEASED')` is false
    with a test on it.

    THE ALTERNATIVE WAS TO MAP `LEASED` ONTO `OWNED`, and it is worth saying why
    not. "Company drivers" plausibly means "everybody who is not an
    owner-operator", which is how the brief's two values could have been read.
    But a lease-purchase driver's deduction schedule is precisely what differs
    from a company driver's in this fleet — it is why the column has three
    values rather than two — so folding them would encode away the one
    distinction the data exists to make.

40. **Two standing charges of one type cannot both be live, so "everyone pays
    $20, owner-operators pay $35" has no representation.** `saveStandingCharge`
    refuses `Ifta`/`ALL` beside `Ifta`/`OWNER_OPERATOR`, because `ALL` reaches
    the owner-operators too and both rules firing charges them $55.

    The refusal is right: the alternative is two rules with a precedence nobody
    has specified, and `computeDeductions` would silently sum them. But it means
    a tiered charge — a real thing an office asks for — must be written as three
    rules with disjoint scopes (`OWNED` $20, `LEASED` $20, `OWNER_OPERATOR` $35)
    rather than a base plus an override.

    NOT BUILT, AND NOT A DEFECT TO FIX QUIETLY. "The narrowest scope wins" is a
    decision about somebody's pay and belongs to the owner, not to whoever next
    notices the gap. Recorded so the workaround is written down and the refusal
    is not mistaken for an oversight.

41. **A `StandingCharge` has no `companyId`, so Payroll → Charges → Standing has
    no company filter and shows every authority's rules to a reader scoped to
    one.** Not a divergence from a brief — a consequence of §6.2.4's own model,
    recorded because it is the kind of thing that reads as a tenancy bug on
    first sight.

    `listCharges` scopes THROUGH the driver, because a recurring deduction
    belongs to one. A standing charge belongs to the ORGANIZATION; there is no
    company to narrow to, so row-level security is the whole fence and the
    `CompanyChips` control is absent from that tab rather than present and
    inert.

    WHAT IT MEANS IN PRACTICE: somebody scoped to Dolphins sees the group's
    standing charges, including ones that reach drivers they cannot see. That is
    the honest rendering of an org-level rule, and it is the trade §6.2.4 took
    when it put these on the organization rather than fanning them out per
    authority. If it ever needs narrowing, the fix is a scope column and a
    migration, not a filter over a field nobody set.

42. **The dashboard brief named a design-system version that was eleven
    revisions behind, and `TMS-DESIGN-SYSTEM.md` has been citing this flag
    number for it since v10.14.** Part 1's brief said "Design system v10.2"; the
    file was already at v10.13, so the dashboard section landed as v10.14 and
    the status line recorded the discrepancy with a pointer to "§7 flag 42".

    THE FLAG IT POINTED AT DID NOT EXIST. §7 ended at 41 for a day, and the
    next thing written here would have silently become the referent — which is
    what nearly happened, and is why this entry is the version discrepancy
    rather than the statement budget that was drafted into the slot first.
    AGENTS.md's reason for transcribing briefs is that a rule nobody can cite
    cannot be used in review; a citation pointing at the wrong rule is worse
    than one pointing at nothing, because it reads as settled.

    NOTHING IS WRONG WITH THE VERSION ITSELF. v10.14 is the honest number for a
    file at v10.13, and the brief's "v10.2" was a stale reading rather than an
    instruction. Recorded so the pointer resolves.

43. **The dashboard's statement budget was computed from a count nobody had
    measured, and the page cannot reach it without breaking an accepted
    ruling.** Part 3's brief says "page ≤ 10 statements total (7 now)". The
    seven was wrong, the ten was derived from it, and the measured answer is
    fourteen.

    WHERE THE SEVEN CAME FROM. `dashboard-counts.ts` says the page is
    "4 + 1 + 1 + 1 = SEVEN", which was arithmetic over the reads as written.
    `complianceCount` is not one statement: it calls `complianceQueue`, which
    BUILDS rows out of three reads. So the page was NINE before part 3 ever
    touched it. Nobody had asked the driver — the exact failure AGENTS.md names
    as supplying the baseline you are testing.

    WHAT PART 3 ADDS, measured by a `$on('query')` census on dev at w13
    (`scripts/measure-dashboard-page.ts`):

    | read                | who        | stmts |   ms |
    | ------------------- | ---------- | ----: | ---: |
    | `dashboardFor`      | money      |     4 | 1138 |
    | `actionQueue`       | both       |     4 |  994 |
    | `panelFigures`      | money      |     1 |  255 |
    | `panelFigures`      | dispatcher |     1 |  251 |
    | `topDriversByGross` | money      |     1 |  244 |
    | `dqfSplit`          | both       |     3 |  758 |
    | `company.findMany`  | both       |     1 |  240 |
    | **money role**      | 6 reads    |    14 | 3831 |
    | **dispatcher**      | 4 reads    |     9 | 2243 |

    TWO TOTALS, BECAUSE THE PAGE IS NOT ONE PAGE. A dispatcher runs neither the
    KPI series nor the gross bars, and gets the panel statement without its cash
    columns — nine. Adding the two variants of `panelFigures` together is how
    this census first printed 15 for a page nobody loads.

    THE MILLISECONDS MOVE AND THE COUNTS DO NOT. A second run minutes later gave
    `dqfSplit` 2245ms against 758ms and `actionQueue` 1827ms against 994ms on
    identical data — evening variance on the same connection the socket note in
    AGENTS.md records. Quote the counts; treat any single timing as an order of
    magnitude.

    THE ONLY ROUTE FROM 14 TO 10 IS THROUGH A RULING. Three of the four over
    budget are `dqfSplit`, and the one-statement version of it is the DQF
    checklist rewritten in SQL — which the owner ruled against for the Needs-you
    compliance row on 2026-10-01 ("compliance keeps its own statement") and
    which §6.1.1 records. The fourth would be folding `topDriversByGross` into
    `panelFigures` with a `json_agg`, worth exactly one statement and coupling
    two unrelated readers into one unreadable query. So the panels ship at 14
    and the number is in the report rather than rounded down.

    AND THE UNIT IS PROBABLY WRONG ANYWAY, which is the part worth carrying
    forward. The budget exists because of flag 31: this screen expired a
    transaction in production at 6034ms with EIGHTEEN statements inside ONE
    lock. Fourteen statements spread across six concurrent transactions is not
    that shape — the largest transaction on the page is four statements, and the
    wall clock is the slowest of the six rather than the 3831ms serial sum. A
    budget on statements-per-page counts something the incident was not about.
    If this is re-litigated, the number to bound is statements per transaction.

44. **"Top drivers by gross" had two readings and the schema picked one.** Part
    3 asks the Fleet panel for "top drivers by gross for the window". On a
    settlement, a driver's line carries BOTH `grossCents` — the freight the
    percentage was taken of — and `amountCents`, what the driver was paid. The
    first draft of `topDriversByGross` summed the second one under the first
    one's name.

    THE SCHEMA SETTLES IT, which is why this is recorded rather than asked.
    `Settlement.grossCents` is documented as "what the percentage was taken OF"
    and `earningsCents` as the pay, so Zebra's own vocabulary already fixes what
    gross means on a driver's statement — and the dashboard's KPI strip uses the
    same word for freight revenue eight inches above this chart. Summing pay
    there would have put two meanings for one word on one screen. AGENTS.md:
    where a brief and the schema disagree, the schema wins.

    WHAT IT COSTS, SAID ON SCREEN: a team load credits its FULL gross to both
    seats, so this column sums above the window's gross wherever teams ran. The
    panel carries a line saying so, the integration test pins it (both seats at
    100,000 on one 100,000 load, not 60/40), and a guard was watched failing on
    the substitution.

    IF THE OWNER MEANT PAY, it is one line — `line."amountCents"` in the SELECT
    and the ORDER BY — plus a label that is not the word "gross", and §6.1.1
    would want a sentence spelling the definition out. Not done on a guess.

45. **Accounting → Reports loses its `from`/`to` range and its weekly/monthly
    toggle, and that is a working control being removed.** The brief for
    accounting polish part 1 asks for "the same rolling picker as the
    dashboard" on this screen. It does not say what happens to the two window
    controls already there, and all three cannot coexist: v10.16 revoked the
    two-window arrangement, so a screen with a picker AND a range is one screen
    answering for two periods with nothing looking broken.

    MONTHLY GROUPING GOES WITH IT, which is the part worth an owner's eye. The
    presets are settlement-week aligned and a calendar month is not a whole
    number of settlement weeks, so "monthly" cannot be drawn on this axis
    without either overlapping buckets or a second window rule. v10.17 already
    settled the general case — grain is a property of the preset, not a control
    — and this is that rule meeting an existing feature.

    WHAT IS LOST, PLAINLY: somebody who wanted "January to March by month" now
    gets thirteen weeks ending today. A month cut is a real question and the
    answer is not "use weeks"; if it comes back, it comes back as its own
    preset with its own alignment rule, not as a toggle beside a rolling
    window.

46. **The dashboard's aging buckets were off by one against the authoritative
    aging rule, for a day, and nothing could have noticed.** `agingBucketFor`
    in `factoring.ts` is where the aging boundary is decided —
    `daysPastDue <= 30` is current — and `directAging` is the reader the
    invoices screen's chips and totals come from. Part 3's `panelFigures`
    expressed the same rule again in SQL, as a 30-day interval compared with
    `>` rather than `>=`, which is `daysPastDue < 30`: an invoice exactly thirty
    days past due was current on one screen and 31–60 on the other.

    IT IS THE SAME TRADE `by-company.ts` TOOK AND DOCUMENTED, and it is kept
    for the same reason: the dashboard's budget is one statement for every
    panel figure, and calling `directAging` would add a round trip to the first
    screen of the day — and a reader capped at 500 invoices, which is wrong
    exactly when the business is busy. So the duplication stays and the
    mitigation is a test rather than a promise: boundary invoices at 29, 30,
    31, 60, 61, 90 and 91 days past due, asserted to land in the same bucket
    under both expressions, with a guard watched failing on the comparison.

    THE OFF-BY-ONE ITSELF IS FIXED. What is flagged is that a money rule is now
    written twice on purpose, in two languages, and that the only thing holding
    them together is a test somebody could delete.

47. **The login fix was briefed as "one commit, doc-first", and AGENTS.md says a
    doc amendment is its own commit. It is two.** Not a disagreement about
    substance — "doc-first" and "amend the design system in its own commit,
    with the reason, BEFORE changing code to match it" want the same thing in
    the same order. They differ only on whether the doc change travels with the
    code, and the standing rule is the specific one.

    WHY IT MATTERS ENOUGH TO SPLIT: the reason the rule exists is that a doc
    change buried in a code commit is invisible in review and unrevertable on
    its own. §7.5.1 is a rule about every form in the product, not only about
    sign-in; somebody disagreeing with it should be able to revert the rule
    without reverting a fix to a login people use.

    So: `TMS-DESIGN-SYSTEM.md` v10.20 plus the `zebra_session` rule in
    `AGENTS.md` in one commit, the code and its tests in the next, and the
    brief's "one commit" is the thing being flagged rather than obeyed.

48. **Clearing failed login attempts on success erases the signature of a guess
    that worked.** Owner's ruling, 2026-10-04: a successful login deletes that
    email's failed rows inside the rate-limit window, because nothing cleared
    them and five wrong tries therefore left a CORRECT password refused for the
    rest of fifteen minutes. That defect is real and the fix is right.

    THE COST IS AN AUDIT TRAIL, and it is the most interesting part of the trail.
    "Five failures then a success, one address, one window" is exactly what a
    brute force that succeeded looks like, and after this it reads as a single
    clean sign-in. `tests/integration/auth.test.ts` had an assertion that both
    rows survive — `[false, true]` — and the ruling made it false; it now asserts
    the clearing, with this flag named in it.

    TWO SMALLER CONSEQUENCES, stated so neither is a surprise. The deleted rows
    carried an `ip`, so clearing five of one email's failures also removes five
    from that address's thirty — a guesser who lands one password buys a little
    room against the per-ip limit, which is six times the per-email one precisely
    because it is the coarse fence. And `deleteMany` is scoped to the window, so
    failures older than fifteen minutes survive and the long-range history is
    intact.

    THE ALTERNATIVE IS A COLUMN, NOT AN ARGUMENT: a `clearedAt` on
    `LoginAttempt`, set instead of deleting, with the counter ignoring cleared
    rows. That keeps the trail and costs a migration, which is why it is a flag
    rather than a silent substitution for what was ruled.

---

## 8. How each acceptance box closed

The §5 excerpt, box by box, with what proves it. Two are unmet and say so.

- [x] **Golden set: per-field accuracy printed as a table; every money figure
      that reached cents did so through `money.ts`.** **MET, after the owner
      verified all 13 sheets field by field.** This box read NOT MET at the
      close of Step 6 and is corrected here rather than rewritten: the
      instrument was built and refused the corpus, the owner then verified it
      in an interview session, and the run produced a number.

      **First run, against the prompt as Step 1 wrote it: 86.0%** — 283 right
      of 329 scored field-instances, 13 of 13 documents read, 5.659¢ per
      document. **After the contract's rules were baked into the prompt:
      96.6%** — 285 right of 295, 6.728¢ per document.

      | outcome | before | after |
      | --- | --- | --- |
      | **made up** — a value where the truth is absence | **35** | **1** |
      | wrong — read the wrong thing | 6 | 5 |
      | missed — left a printed value out | 5 | 4 |

      **Three quarters of every original failure was invention, not
      misreading**, and that is the part the rules removed: 35 fabricated
      values became 1. Misreadings barely moved — 6 to 5 — which is the honest
      shape of the result. The reader could always read these documents; it
      could not leave a field alone.

      **The denominator shrinks from 329 to 295 and that is not a trick.** An
      agreed absence is not scored, so every slot the reader now correctly
      leaves empty stops being a scored instance. The rate is over the fields
      where somebody had an answer.

      Cost of the longer prompt: **+1.07¢ per document**, +19%, for 10.6
      points.

      **The invoice-making fields, broken out** (owner's ruling, from a real
      Datatruck invoice): **95.0% — 171 right of 180**, over the 19 fields that
      decide whether a load can be billed at all — who to bill, their load
      number, the rate, and both stops with their dates and reference numbers.
      Every table from here carries this row first: a reader that scores
      `pallets` perfectly and `stops[1].referenceNumber` badly is worse at the
      only job the extraction has.

      What is left, all of it in that row: `stops[1].referenceNumber` 0/2,
      `stops[0].referenceNumber` 3/5, `brokerName` 11/13, one stop name and two
      stop dates. Reference numbers are the least stable fields in the corpus.

      **A regression the runs found, and it was the instrument's fault as much
      as the reader's.** After the prompt grew, one or two of thirteen
      documents began refusing per run with `unparsable: not_json` —
      intermittently, a different document each time. The answers were not
      malformed: they were **truncated at the 4,096-token output cap**, which a
      long instructions block and a 128-character commodity string overrun.
      `stop_reason` was read into the response type and never checked, so a cut
      -off answer was reported three layers later as broken JSON. The cap is now
      8,192, truncation is its own named failure, and the accuracy run prints
      the reason beside a refusal instead of the word REFUSED alone. A refusal
      counts every field on its sheet as missed, so an unexplained one moves
      the headline by six points.

      **Two caveats that travel with the number.**

      1. **Each figure is ONE RUN, and the reader is not deterministic.**
         `brokerName` scored 11/13 in BOTH runs, against truth taken from the
         drafting run — so either two names drift between runs or the drafting
         run read them differently, and **the table cannot say which, because
         it prints that a field was wrong and not what it said.** Printing the
         disagreeing values is the instrument's next improvement and it is not
         built. A single percentage quoted without this line is a stronger
         claim than the run can make.
      2. **The corpus is 13 documents and 12 loads.** `semail (4) (5)` and
         `semail (58)` are one order before and after a layover was added, so
         Big M's template is weighted twice in every per-field rate.

      The 45 hand-corrections and the rules they produced are in
      `EXTRACTION-CONTRACT.md`, which is the tuning list §9 item 7 asked for.

- [x] **A dispatcher's prefill carries no money key and no money label; the
      same document's figures reach OWNER/ACCOUNTING on the rate panel as
      extracted values — pair-asserted.** `verify-dispatcher` 48/48: no
      `"money"` and no `linehaul` on the dispatcher's wire, no `name="rate"` on
      their form, `245000` cents stored from the same document, and the owner's
      form does have the field. §1.3 removes the key rather than emptying it.

- [x] **A corrected broker match is applied on the next upload of the same
      string; the correction row records both.** `verify-correction-memory`
      15/15 — same document twice with a correction between, second upload
      arrives carrying the corrected customer, correction row holding both
      sides plus the confidence the model claimed when it was wrong.

- [x] **A known facility's gate code prefills; an unknown one is offered for
      save and appears on the `Location` afterwards.** `verify-facility-memory`
      11/11 — one dock printed two ways ("Road" with a zip, "Rd" without),
      offered unticked, saved on confirm, gate code written down between the
      two uploads and on the screen at the end.

- [x] **Duplicate BOL warns in words, names the load, and proceeds only on
      confirm.** `verify-load-warnings` 13/13, including the half a screenshot
      cannot show: **one** load after the warning, **two** after the confirm,
      and one customer rather than one per attempt.

- [x] **An abandoned extraction expires with the pending row; no orphan loads,
      no orphan documents.** `tests/integration/documents.test.ts` — a mint
      carrying a COMPLETED extraction, swept after expiry: pending row gone,
      R2 object gone, no `Document` ever made from it.

- [x] **One document's cost printed in the walkthrough output; the token cap
      proven by a document that exceeds it failing cleanly.** `verify-extraction`
      prints the per-document cost line; `tests/claude.test.ts` asserts the
      refusal AND an empty call log — the fetch never happens, which is what
      "cleanly" has to mean for a cap that exists to avoid sending the bytes.

- [ ] **Typing path untouched: the repeat-load walkthrough still passes at its
      Phase 2 timing.** **NOT MET.** 12.34 s against Phase 2's 6.4 s; Phase 5's
      share of that is ~0.7 s, measured by removing its query and re-deploying.
      Under the forty-second target throughout. Flag 31 carries the numbers and
      the `wrangler tail` decomposition (CPU 477 ms, wall 21.8 s).

- [x] **RU/RTL on the new surfaces.** `scripts/screenshots-phase5.mjs` — six
      shots, three locales, of the two states that only exist after something
      happens: the prefilled form with its provenance hints and facility panel,
      and the warning list. The Farsi pass found flag 30.

---

## 9. What Phase 6 inherits

0. **THE ACCESSORIAL GAP, PROMOTED TO THE TOP BY THE CORPUS ITSELF.**
   `EXTRACTION_SCHEMA` has no room for charge lines, and `LoadAccessorial` has
   held them since Phase 3. Three documents show the cost: a TONU where the
   accessorial IS the entire pay; the same load re-issued with a $150 layover
   added, where **that line is the only difference between the two documents
   and the only thing the reader cannot see**; and `werner-1`, where
   `Capacity Surcharge $152.60` and `Deadhead Miles Charge $202.50` are exactly
   the $355.10 between the money extracted and the money owed.

1. ~~**The golden set is still owed**~~ — **DONE.** All 13 sheets verified by
   the owner, field by field, in an interview session; the accuracy table is in
   §8 and flag 10 is fully closed. What it produced instead is
   `EXTRACTION-CONTRACT.md`: eight rules, one of them overturned by the corpus
   after being made, plus the dialect table, the instability findings and the
   gaps below.

2. **The create transaction is roughly twice Phase 2's statement count**, and
   that is now the single-user cost, not just the concurrent one. Flag 31 has
   the measurement; Phase 2 §16 flag 20 has the remedy — fewer statements
   inside the lock. It is a measurable job with a number to beat: 6.4 s.

3. **A typed load can never be given a BOL or a PO**, because the fields only
   render from an extraction and there is no load-edit screen. Flag 23.

4. **`Location.normalizedAddress` is written only by `saveFacility`.** Any
   other path that creates a facility must write the key or the dock is
   unmatchable. There is no Locations screen yet; when one is built, that is
   the whole of the fix. Flag 21.

5. **Correction memory learns silently and fails silently.** The learn-and-log
   path is wrapped in a bare `catch` so a save is never lost to it, which means
   a persistent write failure would stop the learning with nothing saying so.
   The honest fix is a counter on the accuracy run. Flag 15.

6. **Three defects the verification session filed, in the state it filed
   them.** All three are recorded with evidence in `EXTRACTION-CONTRACT.md`;
   the first two are fixed in the session that followed, the third is item 0
   above.
   - **A decimal weight cannot be saved.** `ratecon-tk-25120034` prints
     `44,857.46 LBS`, the reader returns it faithfully, and `wholeNumber()` in
     `src/lib/loads.ts` refuses any non-integer — so a prefilled form carrying
     a correct reading fails to save. Every gross weight on a drayage ratecon
     is a decimal. Owner's fix: floor it at prefill, and leave the sheet's
     truth as the decimal the page prints.
   - **Nothing refuses a window that ends before it starts.**
     `rateconfirmation-2-3` produced `windowStart 08:00, windowEnd 06:00` from
     a malformed `0800-600`, and the parser, the prefill and `createLoad` all
     accepted it. Phase 2 §8 refuses a load whose delivery precedes its pickup;
     a single stop whose own window inverts had no such check.
   - **Accessorial charge lines are not extracted at all** — item 0 of this
     list, not a code defect so much as a hole the shape was never given.

7. **Nothing enforces that the integration suite runs alone.** Flag 28 is the
   evidence that it must — 22 failures, none of them in code that had changed.
   A guard is cheap and was not built here.

8. **The prompt has not been tuned against anything.** Every extraction result
   in this phase came from the first prompt written in Step 1, deliberately:
   changing it before the corpus is verified would be tuning against the
   model's own answers. Flag 10's findings are the list to start from once
   there is truth to tune against.

9. **The Load Tracker's word tells a role without `load.financials` one thing
   it could not otherwise read, and that is a ruling rather than a
   preference.** — 2026-09-05.

   `pipelineStage` separates _Delivered_ from _Invoiced_ on direct-settled
   freight by `totalRevenueCents > 0`. No money crosses to the client — the
   strip is handed one of five words — but on an Amazon load at POD_RECEIVED
   those two words differ **only** by whether a rate exists. A dispatcher who
   cannot open the rate panel can now infer that the load has one.

   IT WAS BUILT THIS WAY DELIBERATELY, because the alternative is worse in the
   direction the owner already ruled against. Gating the last two stages behind
   `load.financials` would give the strip two vocabularies — the same load
   reading _Delivered_ to a dispatcher and _Invoiced_ to a manager — and the
   instruction on item 9 was explicit: **ONE story, identical on every load.**
   A tracker whose story depends on who is looking is not a tracker.

   WHAT MAKES IT ARGUABLY FINE: the billing StatusBadge beside the load number
   is already ungated, so billing state is not secret today. What makes it
   worth a ruling anyway: the badge does not distinguish these two cases on
   direct-settled freight, so this is genuinely a new bit and it is derived
   from money. "Money is only the amount" is a defensible line and it has never
   been stated as one.

   The three options, none of them taken unilaterally: leave it (the story stays
   one story), gate the last two stages (two vocabularies), or state in
   `permissions.ts` that `load.financials` governs amounts rather than the
   existence of a rate — which is the honest version of what the code now does,
   and the only one of the three that ends with a rule somebody can cite.

   **RULED 2026-09-05: the third.** `load.financials` governs **amounts**, not
   the existence of a rate, and the rule is stated at the resource's
   declaration in `src/lib/permissions.ts` with the tracker named as the case
   that forced it — so the next reader knows it was written against a real
   question rather than in the abstract.

   The statement carries its own limit, which is the part that matters more
   than the ruling: "it is only a boolean" is not a general licence. A derived
   value is acceptable when it is something the role may act on anyway; it is
   not acceptable when the boolean reconstructs the figure — a badge above
   $5,000, a sort by margin, a "high value" flag. Those leak the amount through
   a side channel, and the amount is the thing being protected.

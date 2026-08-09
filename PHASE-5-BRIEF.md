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

1. **The strict shape is enforced on OUR side, not by the API's structured
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

2. **The token cap is a BYTE cap, because input tokens cannot be counted before
   sending them.** §1.2 asks for a "token cap per document". The output side is
   a real token cap (`MAX_OUTPUT_TOKENS`). The input side is
   `MAX_DOCUMENT_BASE64_BYTES` — 10MB of base64, roughly 7.5MB of PDF — because
   counting a PDF's tokens requires the tokenizer, and the tokenizer requires
   sending it, which is the thing the cap exists to avoid.

   It is a proxy and it is enforced BEFORE the call, which is the half that
   matters: §5's box asks for "a document that exceeds it failing cleanly", and
   clean means the fetch never happens. `tests/claude.test.ts` asserts exactly
   that — the refusal, and an empty call log.

3. **The price list is a copied constant and will go stale.**
   `PRICE_CENTS_PER_MTOK` in `claude.ts` is what the walkthrough multiplies by
   to print §5's cost-per-document. Nothing checks it against Anthropic's
   published prices, and nothing can without a network call on every run. When
   the figure is printed it should be printed as what it is — a computation from
   a constant recorded on a date — rather than as a measurement of a bill.

4. **§2's corpus is owed before Step 3, and the phase should stop at Step 2
   without it.** The brief is explicit: "No golden set, no accuracy claim — the
   phase can build to Step 2 without it, not past." Recorded here at Step 1 so
   the reminder arrives before the work does rather than after: **8–12 real rate
   confirmations with hand-checked truth per field**, dropped in the dev bucket.

   Step 3 is correction memory, which is measured by the accuracy it moves;
   without a golden set there is nothing to move and nothing to report.

5. **`ANTHROPIC_API_KEY` is not set on either worker.** The same shape as Phase
   2's flag 18 about `RESEND_API_KEY`: the code is built, deployed and tested,
   and the secret is an account-level act the owner performs. Until then the
   service throws `no_api_key` by name — which is why it is a named failure and
   not an empty result. **Owed:** two `wrangler secret put`, one per worker; the
   README carries the exact commands.

6. **Phase 3's rate-entry wall had a gap on the create form, and wiring the
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

7. **A server-rendered form accepts a file before React can hear about it, and
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

8. **Reading a form field at a time is reading several different moments.** The
   same script polled one field until it filled and then read six more, one
   round trip each; a re-render between any two produced a report where the rate
   was "(empty)" on a form that then saved 245,000 cents. It takes ONE
   `page.evaluate` snapshot now, and waits for two consecutive snapshots to
   agree before asserting — which is what "the form has settled" means and what
   the first version assumed without checking. The save side had the same shape:
   two independent polls, one query now.

9. **The truth sheets are gitignored with the corpus, and the accuracy run is
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
    running — same Neon branch — and the suite came back **22 failed, 3 files**,
    every failure a dropped WebSocket or `A query cannot be executed on an
expired transaction … 30516 ms passed` against a 20 s budget. All of them in
    `auth.test.ts` and `settlements.test.ts`, none in anything this step
    touched. The run took 3768 s against a usual ~1800.

    Re-run alone: **24 files, 363 tests, 0 failed, 2982 s.**

    Phase 4 already learned this for the integrity check and put the reason in
    that check's failure message. The rule is wider than the check: **nothing
    else may touch the dev branch while the integration suite runs** — not
    another suite, not a walkthrough, not a seed. Worth a guard rather than a
    paragraph, which is Step 6's ride-along if there is room for one.

    The near-miss worth naming: a red suite whose failures are all in files the
    change never touched is the shape of an environment problem, and it is also
    exactly the shape of a real bug in something shared. Being right about which
    one it was required re-running it alone, not reasoning about it.

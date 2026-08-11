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
| 3    | **Excel ingestion + Amazon profile**: .xlsx parsing server-side into the extraction pipeline; Amazon Load Information sheets extracted to multi-stop loads; golden mini-set from the owner's samples with truth interview; manual upload of the Excel works end to end — this alone kills the Datatruck download-upload ritual's worst half |
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

1. ~~**The brief cites a spec this repository does not contain.**~~ —
   **CLOSED.** The owner's spec is transcribed verbatim as `PHASE-6-SPEC.md`
   and every citation in this brief now links into it. Step 1 was built against
   the brief's words alone; flag 2 records what the spec turned out to say when
   it arrived, and what was reconciled.

2. **§8 arrived after Step 1 shipped, and it asks for three things the
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

3. **The stop type is a real control in the tab order, and it costs two tab
   stops per stop.** The alternative was `tabIndex={-1}`, which would keep §9's
   keyboard path exactly as it was and make the type unreachable without a
   mouse — a control a keyboard-only dispatcher cannot get to is not a saving.

   Measured rather than argued: typing went **101 ms → 101–125 ms** across
   runs, which is two extra tab stops and nothing else. The save round trip is
   unchanged within its own noise — 12.11/12.21 s before, 12.22/12.17 s after,
   with one outlier run at 8.4 s that was a quiet network rather than a
   speed-up, and is reported because dropping it would have flattered the
   result.

4. **Eleven walkthrough scripts were repointed at indexed field names.**
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

5. **A stop's identity is its key, not its index.** Reordering with index keys
   would make React reuse the moved row's uncontrolled place input, so dragging
   stop 3 above stop 2 would leave the text behind. The rows carry a minted
   key; the fields are keyed by it.

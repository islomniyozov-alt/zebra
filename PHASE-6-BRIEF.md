# ZEBRA — PHASE 6 BRIEF: CREATE LOAD v2 & THE AMAZON PIPELINE

**Version 1** — 2026-08-11
**For:** Claude Code, working in the zebra repo
**Reads with:** the five closed briefs, `EXTRACTION-CONTRACT.md`,
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
- **Learning (§17 of the spec) exists**: CustomerAlias + facility memory.
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

Email-in (spec §1, §13–15) requires receiving mail at an address you own —
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
| 1    | **Create Load v2, part 1 — multi-stop**: the form gains add/remove/reorder stops over the existing schema; stop timeline rendering (§8 of the spec) in Zebra's design language; manually-modified indicators; the typed single-stop path keeps its current speed, measured before/after                                                     |
| 2    | **Create Load v2, part 2 — the chooser**: method tabs (Manual · Upload document · Paste text · Amazon), MC-first, recent-customers quick-pick, dropzone on the same surface; paste-text runs the same extraction contract on raw text                                                                                                       |
| 3    | **Excel ingestion + Amazon profile**: .xlsx parsing server-side into the extraction pipeline; Amazon Load Information sheets extracted to multi-stop loads; golden mini-set from the owner's samples with truth interview; manual upload of the Excel works end to end — this alone kills the Datatruck download-upload ritual's worst half |
| 4    | **Email-in** (domain-gated): Cloudflare Email Routing → worker → same pipeline → Draft Load; the Incoming Loads inbox (ready / review / conflict states from real validation results, not vibes); forward-to-address works identically (§15)                                                                                                |
| 5    | **Thread matching + update detection**: same Amazon load number arriving again diffs against the existing draft/load, shows the change ("14:00 → 16:00"), applies on confirm; never a silent second load                                                                                                                                    |
| 6    | Polish + acceptance: RU/RTL on new surfaces, dispatcher walkthrough grown, stop-sequence validations (time-order; travel-time feasibility is PARKED — it needs mileage data Zebra doesn't have), accuracy table extended with an Amazon column, drift clean, brief closed with flags                                                        |

## 5. Parked, with names

- **Travel-time feasibility warnings** (spec §6's "1h20m estimated") — requires
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

1. **The brief cites a spec this repository does not contain.** Step 1 asks for
   "stop timeline rendering (§8 of the spec)"; §0 cites the spec's §17, §19,
   §6; §4 cites §15. The owner's full feature spec is named as the source dream
   and has not been transcribed here — so those section numbers cannot be
   cited in review, which is the exact failure `AGENTS.md` records against
   Phase 3 ("a rule that lives only in a chat log cannot be cited in review").

   Built from the brief's own words plus `TMS-DESIGN-SYSTEM.md` where the spec
   is silent, and the places where that judgment was exercised are named in the
   step reports. **Owed:** the spec transcribed, or its §6, §8, §15, §17 and
   §19 quoted into this brief.

2. **The stop TIMELINE is a numbered list with a rule down its leading edge,
   not a graphic.** Step 1 asks for "stop timeline rendering (§8 of the spec)"
   and §8 is not in this repository (flag 1). `TMS-DESIGN-SYSTEM.md` has no
   timeline component, and inventing one during a form step would be a new
   pattern with no rule behind it.

   So: each stop is a numbered row against a `border-s-2` rule. It reads the
   same mirrored in Farsi, it prints, and a screen reader gets a list. If §8
   asks for something else, this is the paragraph to argue with.

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

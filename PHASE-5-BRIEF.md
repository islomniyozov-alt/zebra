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

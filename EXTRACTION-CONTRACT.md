# What the extraction is asked for

Rules established while the owner verified the golden set, one document at a
time, against the paper. They are the tuning list for the next revision of
`EXTRACTION_SYSTEM` in `src/lib/rate-confirmation.ts` — Phase 5 §9 item 7 is
the reason there was no earlier one: changing the prompt before there was
verified truth would have been tuning against the model's own answers.

Each rule below is a rule the corpus produced, not one somebody imagined. The
verification session is where each was ruled on, and the flag or sheet named
beside it is the evidence.

> **Read this before the accuracy table: the corpus is 13 documents and 12
> loads.** `semail (4) (5)` and `semail (58)` are the same order, `30192825`,
> re-issued after a $150 layover was added — same stops, same BOL, same times.
> Big M's template is therefore weighted twice in every per-field rate, and two
> of the thirteen documents cannot disagree with each other.

---

## What happened when these rules were baked in

The session after the verification wrote every rule below into
`EXTRACTION_SYSTEM` and re-ran the same 13 documents:

|                                        | before | after     |
| -------------------------------------- | ------ | --------- |
| per-field accuracy                     | 86.0%  | **96.6%** |
| values INVENTED where truth is absence | 35     | **1**     |
| values misread                         | 6      | 5         |
| values missed                          | 5      | 4         |
| cost per document                      | 5.659¢ | 6.728¢    |

The rules are worth what they cost, and the shape of the gain says what they
are: **misreadings barely moved.** The reader could always read these
documents. What it could not do was leave a field alone, and that is what a
corpus with hand-checked absences teaches that no amount of prompt-writing
from imagination would have.

What did NOT move: `brokerName`, wrong on 2 of 13 in both runs, and the
per-stop reference numbers, which remain the least stable fields in the set.

---

## The cost experiment — three ways over the same 13 documents

Run on 2026-08-11, invoice-making fields first per the owner's ruling.

|                     | invoice fields | all fields | cost / document | refused     |
| ------------------- | -------------- | ---------- | --------------- | ----------- |
| Sonnet, no caching  | **96.1%**      | 96.9%      | 6.958¢          | 0 of 13     |
| Sonnet + caching    | 95.0%          | 96.6%      | **6.082¢**      | 0 of 13     |
| Haiku 4.5 + caching | 74.3%          | 76.3%      | **1.446¢**      | **2 of 13** |

**Caching is free accuracy-wise and 12.6% cheaper.** The difference between
the first two rows is run-to-run noise and nothing else — caching does not
change a single token the model sees, so a 1.1-point gap between them is the
measurement's own variance, and a useful calibration of how much to trust any
single figure in this table.

Cache behaviour after the breakpoint was fixed: **5,208 tokens written, 62,496
read** across the corpus. Before it, the same run wrote 115,582 and read
21,660 — because a `cache_control` marker caches everything up to and including
its block, and the first version put one after the document. Every unique PDF
was being written into the cache at 1.25x and never read.

**Haiku is not 74% — it is about 88% when it answers, and it fails to answer.**
Two of thirteen documents came back unparseable (`bad_value_type at
$.bolNumber`, `not_json at $`), and a refusal scores every field on its sheet
as missed, which is 31 of its 40 invoice-field failures. Excluding the two it
refused, its invoice-field rate is roughly 88.5%. Both readings matter and
neither is the whole story: a reader that is cheap and right most of the time
but silently produces nothing on one document in seven is a different
proposition from one that is dearer and always answers.

What it costs to know: **five corpus runs, about $3.67.**

Caveats unchanged: each figure is ONE run, the reader is not deterministic, and
13 documents are 12 loads.

---

## The engine experiment — five columns over the same 13 documents

Run on 2026-08-11. Invoice-making fields first, per the owner's ruling.

|                    | Sonnet + caching | Gemini 3.6 Flash | Gemini 3.5 Flash-Lite | Haiku 4.5 + caching |
| ------------------ | ---------------- | ---------------- | --------------------- | ------------------- |
| **invoice fields** | **96.6%**        | 94.5%            | 84.0%                 | 74.3%               |
| all fields         | 97.3%            | 95.6%            | 87.3%                 | 76.3%               |
| cost / document    | 5.847¢           | **1.496¢**       | **0.366¢**            | 1.446¢              |
| refused            | 0 / 13           | 0 / 13           | 0 / 13                | **2 / 13**          |
| tokens in / out    | 69,616 / 34,203  | 59,706 / 13,986  | 59,706 / 11,886       | —                   |

**The Gemini cost cells are CORRECTED.** They were first computed from assumed
rates and read 0.407¢ and 0.083¢; the owner supplied the list rates
($1.50/$7.50 per Mtok for 3.6 Flash, $0.30/$2.50 for 3.5 Flash-Lite) and the
same measured tokens now give 1.496¢ and 0.366¢ — **the assumption understated
by 3.7x.** It changed the ratio the ruling was made on — Flash is about 3.9x
cheaper than Sonnet, not 14x — and did not change the ruling.

It also puts Flash and Haiku within 3% of each other on price, 1.496¢ against
1.446¢, which is the cleanest way to read this table: at the same money, Flash
scores 94.5% on the invoice fields against Haiku's 74.3% and refuses nothing
where Haiku refuses two documents in thirteen.

**The model names were not what anybody assumed.** `gemini-2.5-flash-lite`
answers 404: _"no longer available to new users"_. The list this key can
actually call runs to `gemini-3.6-flash` and `gemini-3.5-flash-lite`, and both
were pinned rather than using the `-latest` aliases, which would make every
future run a different measurement.

**What each engine gets wrong is nearly the same list**, which is the finding
under the numbers. Reference numbers lead every column: `stops[1].referenceNumber`
is 0/2 on Sonnet AND on Flash. Sonnet then loses one broker name and one
equipment type; Flash loses three broker names and invents two stop references;
Flash-Lite starts inventing windows and missing BOLs, and on one document —
`broker-x-1`, three stops — it is 10 fields off where Flash is 1.

**Haiku is the only engine that fails to answer at all** (2 of 13 unparseable),
and that is a different kind of defect from being wrong: a dispatcher gets
nothing back and types the load by hand.

Caveats unchanged: each figure is ONE run, no reader is deterministic, and 13
documents are 12 loads.

### What the switch to Gemini then found

- **No free caching on this path.** Gemini has no `cache_control`; it caches a
  leading PREFIX implicitly. The adapter now sends the stable prompt text
  before the unique document so the prefix can repeat — and three identical
  extractions in a row still reported `cachedContentTokenCount: 0`. The reorder
  is kept because it is correct in principle and costs nothing, but **no saving
  was measured and none is claimed.** The remaining option is Google's explicit
  `cachedContents` API: a second object with its own lifetime to maintain, for
  a prefix worth about 2,600 tokens.

- **THE KEY'S QUOTA IS A PRODUCTION RISK, and it stopped this session.**
  `verify-facility-memory` failed its second upload with HTTP 429 — _"You
  exceeded your current quota, please check your plan and billing details"_ —
  and the quota had not recovered 90 seconds later, so it is a project quota
  rather than a burst limit. Five Anthropic corpus runs never hit one.

  The application behaves correctly: a 429 becomes `call_failed` with the
  message on the offer slot, a named failure rather than an empty extraction.
  But with Gemini as the shipped default, an exhausted quota means **a
  dispatcher's upload stops working**, and the fallback is a constant a
  developer edits rather than anything the running system can do. Worth
  settling the billing tier before production, and worth deciding whether
  `askModel` should fall back to Sonnet on a 429 rather than surfacing it.

---

## The standard every field is judged against

> **Truth is what a careful dispatcher would enter in the form from this
> paper.**

Owner's ruling, verification session, sheet 1. It settles the question that
comes up on almost every disputed field: not "what characters are printed
there", and not "what is true about the freight in the world", but what a
person doing the job would put in the box while holding this document.

The three consequences below all follow from it.

---

## 1. Identical early and late times are an APPOINTMENT, not a window

McLeod-style confirmations print the date twice against a stop:

```
Date:   12/08/2025 2100
        12/08/2025 2100
```

The second line is the late time. When it equals the early time there is no
window — there is an appointment, and a dispatcher enters one time.

**Contract:** `scheduledAt` carries the time. `windowStart` and `windowEnd` are
**null** unless the two printed times DIFFER. A window whose start equals its
end is not a window and must not be emitted as one.

The same rule, second shape. Scotlynn's template prints:

```
Arrive Between: 01/22/2026 1200
And:
```

One time, and the "And" empty. The label says window; the paper gives an
appointment.

**Contract, stated once for both shapes:** a window needs **two different
ends**. One printed time — whether it is printed once, printed twice
identically, or printed under a label that says "between" — is `scheduledAt`
with both window fields **null**.

Cost of getting it wrong: the create form prefers `windowStart` over
`scheduledAt` when both are present (`typedDateFrom`), so a fabricated window
is not inert — it is what the form fills the date from.

_Ruled on sheet `broker-x-1` (identical early/late, six fields wrong) and sheet
`order-confirmation-1321718` (one-sided "Arrive Between", six more)._

## 2. ~~`FACILITY - NUMBER` in the instructions is that stop's pickup number~~ — **OVERTURNED**

Kept, struck through, because a rule that was made and then refuted by the
corpus is the most useful thing on this page: it is what a golden set is for.

**The original ruling** (sheet 1, `broker-x-1`): an instruction line reading
`MEMSW - 10002539: If driver departs earlier than appointment time…` names the
facility and then the number it will ask for at the gate, so `10002539` is
`stops[0].referenceNumber`.

**The evidence that killed it** (sheet 10, `semail-4-5`): the same Big M
template, the same instruction sentence, **the same number 10002539** — against
a different facility (`FEDEX` there, `MEMSW` here) on a different load. One
number cannot be the pickup number of two facilities. It is a Big M instruction
or template id.

`broker-x-1`'s sheet has been revised back to null with the reason recorded on
it. Nothing else in this corpus depended on the rule.

**What it becomes:** a clause of rule 4 — _labels attach, patterns in prose
don't._ A value under a label naming a stop-level role attaches to that stop
(`Customer Pickup #: 4301`, sheet 8). A value matched out of a sentence by
shape does not, however plausible the shape looks on one document.

_Made on sheet `broker-x-1`, overturned on sheet `semail-4-5`._

## 3. Equipment in the commodity field is NOT a commodity

Confirmations routinely print `Commodity: VAN` beside `Trailer: Power Only`.
`VAN` is the trailer type leaking into a field the template calls commodity;
the document names no freight at all.

**Contract:** `commodity` is what is being hauled. A value that is an equipment
type — VAN, REEFER, FLATBED, POWER ONLY, and the rest of the `equipmentType`
enum — is **null** as a commodity, whatever label the template puts above it.
`equipmentType` is where that word belongs and it is already being read
correctly.

_Ruled on sheet `broker-x-1`._

## 4. A value that names itself something else IS that something else

`Reference: LOAD ID 538581-104` and `BOL: LOAD ID 538581-104` — the same string
in two fields, one of which is labelled BOL. It is not a BOL. The value says
what it is: a load id, printed twice because the broker's template fills both
slots from one column.

**Contract:** read the VALUE, not only the label above it. A string that
self-labels — `LOAD ID …`, `PRO …`, `TRL #…`, `ORDER …` — is that thing,
whatever field the template printed it in, and a field whose only candidate is
a value belonging to something else is **null**.

Owner's ruling, verification session, sheet 2, stated generally: _"a value that
names itself something else is that something else."_

Same rule, second shape: an ADDRESS in the Name slot is an address.
Scotlynn's template prints `Name: 103 Prospector Dr` above `Address: 103
Prospector Dr` — the facility has no name on that paper, and repeating the
street into `name` invents one. `name` is **null** when the only candidate is
the address.

**PLACEMENT DECIDES, and it is the other half of this rule.** `TRL #260924` in
a pickup's _Contact_ slot is a leak and becomes null (sheet 2). A VIN printed on
a pickup line as `Ref # 1DW1A5326VBC23695` is the document's own assignment and
stays — on a power-only move the trailer's VIN is exactly what the gate asks
for, whatever else the dispatch notes call it (sheet 5). The question is not
"does this value look like something else", it is **"did the document put it in
that field on purpose"**.

**LABELS ATTACH; PATTERNS IN PROSE DO NOT.** This is what overturned rule 2
above. A value under a label naming a stop-level role attaches to that stop. A
value pulled out of an instruction SENTENCE by its shape — `FACILITY - NUMBER`
— does not, because the same shape carried the same number against two
different facilities on two Big M loads. Prose is where a broker writes
whatever it likes; a labelled field is where it commits.

**The test guards against UNLABELLED LEAKS, not against LABELLED FACTS.**
`Customer Pickup #: 4301` is printed in a header row rather than against a stop
— and it attaches to the pickup anyway, because the label names a stop-level
role and the load has exactly one stop of that kind (sheet 8). A header is
where this template puts stop facts; the placement test exists to catch a
trailer number landing in a Contact slot, not to strand a value that says what
it is and has exactly one place to go.

Where a load has TWO pickups and one header-level pickup number, it attaches to
neither — the document has not said which, and rule 5 forbids working it out.

_Ruled on sheet `order-confirmation-0149043`, where `bolNumber` was the load id
and the document carries no BOL at all; on sheet `order-confirmation-1321718`,
where both stop names were their own addresses; and on sheet
`rateconfirmation-2-3`, where a VIN in a labelled `Ref #` slot was kept._

## 5. A COMPUTED value is a fabricated value

`Temp: 33.0 to 38.0` came back as `tempF: 35.5` — the average of the two ends,
at medium confidence. That number is not printed anywhere on the page. It is
arithmetic presented as a reading, on the field a driver keys into a reefer
carrying cheese.

**Contract:** every value is a value the page PRINTS. No averages, no midpoints,
no unit conversions, no sums the document did not do itself, no inference from
one field to another. Where the page carries something the schema cannot hold,
the answer is **null** — never a number derived to fill the slot.

Owner's ruling, verification session, sheet 3: _"a computed value is a
fabricated value — only what the page prints, never averages or derivations."_

This is the most dangerous class of error the corpus has produced, and the
reason is the confidence: a fabricated 35.5 arrives looking exactly like a read
35.5, and the form marks only LOW confidence for a person to check.

**A MALFORMED value is reported, not repaired.** `Hours : 0800-600` on sheet 5
is a broken range — the model turned it into a window ending at 06:00, two
hours before its own 08:00 start. The end is unreadable, so the end is null.
Guessing 1600 or 1800 would be the same fabrication as averaging a temperature,
with a delivery appointment riding on it instead of a reefer setpoint.

**A PRINTED negative is a read; an EMPTY SLOT is not.** `Hazmat? No` is the
document saying no, and `isHazmat: false` is correct (sheet 3). A `Driver 2`
line left blank is the document saying nothing, and `isTeam: false` inferred
from it is fabrication wearing a boolean (sheet 6). The test is the same one:
did the page print the answer, or did the reader work it out.

_Ruled on sheets `order-confirmation-1321718` (the averaged temperature),
`rateconfirmation-2-3` (the malformed hours) and `rc-ca-to-il` (the empty
Driver 2 slot)._

## 6. A single ALL-IN rate is the linehaul

`CONFIRMED RATE - $950.00 ALL-IN`, with no freight-pay line, no fuel line and
no accessorial line anywhere on the page. The model read it as a total and left
the linehaul null.

**Contract:** where a document prints ONE rate and no components, that rate is
the linehaul and the total, and fuel is null. Components never printed means
there is nothing to split — not that the linehaul is unknown.

Owner's ruling, verification session, sheet 4: _"a single all-in rate is the
linehaul — components never printed means nothing to split."_

**BOUNDED BY RULE 4: a single UNNAMED rate is the linehaul; a single rate that
NAMES ITSELF an accessorial is that accessorial.** `shipment-4358621` prints one
charge line and one total, and the line is labelled `TRUCK ORDERED & NOT USED
$150.00`. No freight moved, so the linehaul is null and the $150 is an
accessorial the shape cannot hold. `CONFIRMED RATE - $950.00 ALL-IN` names
nothing and is the linehaul; this names itself and is not.

**The TONU trio, and the distinction between them:**

| sheet              | freight line printed         | linehaul truth             |
| ------------------ | ---------------------------- | -------------------------- |
| `semail (4) (5)`   | `Carrier Freight Pay: $0.00` | **0** — a read fact        |
| `semail (58)`      | `Carrier Freight Pay: $0.00` | **0** — a read fact        |
| `shipment-4358621` | none at all                  | **null** — nothing to read |

A printed `$0.00` is the document stating that the freight pay is zero, and zero
is kept. An absent freight line is the document not saying, and absence is null.
The two must not be collapsed: a load with `linehaulCents: 0` was tendered and
cancelled, a load with `null` was never priced for freight at all, and only one
of those is a document somebody should go looking for.

Note the distinction from the sheet-2 miss below: there, a freight-pay line WAS
printed and was not read. Here nothing was printed and the answer was still
wrong. Both end as a load with no linehaul, and a load with no linehaul cannot
be invoiced.

_Ruled on sheet `ratecon-tk-25120034`._

---

## 7. A CARRIER-IDENTITY value in a cargo field is a template artifact

`Seal # 6307163311`, printed against both stops on sheet 5 — which is Dolphins'
own phone number, `(630) 716-3311`, with the punctuation stripped. No seal: an
artifact of the broker's template pulling from the wrong column.

**Contract:** our own identifiers — the carrier's phone, MC number, DOT number,
truck and trailer numbers — are never cargo data. A cargo field whose only
candidate is one of them is **null**, however the template labels it. The
carrier block at the top of every confirmation is where those numbers live, and
they mean nothing anywhere else.

Owner's ruling, verification session, sheet 5: _"a carrier-identity value (our
phone, MC, DOT) in a cargo field is a template artifact."_

_Ruled on sheet `rateconfirmation-2-3`._

## 8. A PLACEHOLDER is an absent value

`Bill of Lading #: 0000000`. The field is filled and says nothing — seven
zeros, printed because the template requires a value, not because a bill of
lading exists.

**Contract:** all-zero values, repeated filler (`000000`, `N/A`, `TBD`, `XXX`,
`-`) and other obvious placeholders are **null**. A field that is present but
empty of meaning is an absent field, and recording the filler puts a fake BOL
on a load where the duplicate-BOL warning will later compare it against every
other document that printed the same zeros.

**A NONSENSE QUANTITY is a placeholder too.** `Weight (lbs): 01` on a 241-mile
power-only Walmart run. One pound is not a light load, it is a template default
nobody replaced.

**Anchor it to IMPOSSIBILITY, not to "unusually low"** — owner's ruling, and the
distinction is the whole safety of this rule. A value no careful dispatcher
would file as fact is a placeholder: 1 lb of full-truckload freight, a rate of
$0.00, a date in 1900. A value that is merely surprising is a value: a 3,000 lb
load of empty pallets is real, and a reader that treats "low" as "wrong" starts
dropping true readings, which is the more dangerous failure of the two — a
missing weight is visible on the form, a silently dropped one is not.

Owner's rulings, verification session, sheets 6 and 7: _"a placeholder (all
zeros or obvious filler) is an absent value"_ and _"a placeholder includes a
nonsense quantity — a value no careful dispatcher would file as fact."_

**AND THE ZEROS WERE PRINTED, WHICH RECLASSIFIES FLAG 10.** `werner-1` returned
`weightLbs: 0`, `pieces: 0` and `pallets: 0` at HIGH confidence, and
`PHASE-5-BRIEF.md` §7 flag 10 recorded that as the reader defaulting where null
was asked for. It was not. Werner's template prints every one of them —
`Pallet Count: 0`, `Total HU: 0`, `Total Pcs: 0`, `Total Wgt: 0 lb` — as
structural filler for a no-touch drop-and-hook.

**The reader was faithful; the fix is placeholder recognition, not honesty.**
That is a materially different repair: "stop defaulting" would have been aimed
at a behaviour that does not exist, and the actual work is teaching this rule.
Worth remembering as the shape of the mistake: a wrong value at high confidence
looked like a fabrication and was a faithful reading of a fabricated document.

_Ruled on sheets `rc-ca-to-il` (`0000000` as a BOL), `rc-nv-to-ca` (`01` as a
weight) and `werner-1` (three printed structural zeros)._

---

## The broker on the rate con is not always the broker on the invoice

**Werner tenders as `Werner Logistics` and bills as `Werner Enterprises`.**
Owner's note, from a real Datatruck invoice for Werner freight. The rate
confirmation this corpus carries (`werner-1`) prints `Werner Logistics` in its
footer and `Werner Enterprises, Inc.` in the terms on page 3 — one company, two
names, and the invoice has to carry the billing one.

**The two must map to ONE Customer**, or the same freight books against two
broker records: aging split across both, a credit limit that means nothing, and
a duplicate-load warning that never fires because the two loads are against
different customers.

`normalizeAlias` deliberately does NOT fold them — `tests/correction-memory.test.ts`
asserts `Werner Logistics` and `Werner Enterprises` stay distinct, and that is
right: they are different strings and no automatic rule should merge two
companies on a shared first word. **The alias table is the mechanism**: a
dispatcher types the billing entity over the tendering one once, and every
later `Werner Logistics` resolves to that Customer.

So this is not a bug to fix; it is a correction somebody must make once per
broker, and the reason the alias table exists. Worth knowing that it has not
been made yet on this data.

---

## Broker dialect — mappings worth learning rather than prompting

Phrases that mean something specific to one broker and nothing in general.
Recorded because they are the shape correction memory is FOR: learned from what
a dispatcher types over, applied next time, no prompt change.

- **`53 ITS Asset` + a `Hook Event` = POWER_ONLY** (ITS Logistics on
  `rc-ca-to-il`; ITS National on `rc-nv-to-ca`, where the event is spelled
  `Pickup Drop/Hook Event`). The
  page never says power-only; it says the trailer is ITS's asset and the event
  is a hook. A dispatcher reads that instantly and the model answered `OTHER`
  at low confidence, which is the honest wrong answer rather than a guess.

  **The gap this exposes:** correction memory learns BROKER NAMES only
  (`CustomerAlias`). There is no path by which "this broker's `ITS Asset` means
  POWER_ONLY" is learned from the dispatcher fixing it, so the same low answer
  comes back on every ITS load until somebody edits a prompt. `ExtractionCorrection`
  already records the field and both values — the raw material is being
  collected and nothing reads it.

---

## Observed inconsistencies — evidence, not yet rules

Things the model did differently on two documents that are the same. These are
the argument for making something explicit in the prompt; they are recorded
with both sides so the next revision is aimed rather than guessed.

### One string, three answers — the case for learned dialect

`53 ITS Asset` appears on THREE documents in this corpus, on the identical ITS
template, beside an identical `Hook Event` heading:

| sheet         | answer    | confidence |
| ------------- | --------- | ---------- |
| `rc-ca-to-il` | `OTHER`   | low        |
| `rc-nv-to-ca` | `OTHER`   | low        |
| `rc-tn-to-nv` | `DRY_VAN` | medium     |

All three are POWER_ONLY. Three readings of one phrase, and the one that was
most confident was the one that was wrong in the way that matters — `DRY_VAN`
prefills an equipment type a dispatcher may not notice, where `OTHER` at low
confidence is marked on the form and asks to be checked.

### The same field, three behaviours — `Customer Ref #`

The identical ITS template, the identical labelled field:

| sheet             | `Customer Ref #` printed | answer              | confidence |
| ----------------- | ------------------------ | ------------------- | ---------- |
| `rc-ca-to-il`     | SC31869116               | taken as `poNumber` | medium     |
| `rc-tn-to-nv`     | 92351717                 | taken as `poNumber` | medium     |
| `rc-tnto-ca-3800` | 11901013                 | **null** — correct  | —          |

A customer reference is not a PO (rule 4's placement test), so the third
reading is right and the first two are wrong. Note where the confidence sits:
both errors came back MEDIUM, and the correct answer came back as an absence
with no confidence at all. **The reader is least stable exactly where a
broker's template differs from the common case — and that instability is
invisible without a golden set**, because each answer looks reasonable alone.

**This is the argument for dialect as learned memory rather than prompt prose.**
A prompt line saying "ITS Asset means power only" fixes these three documents
and nothing else; the next broker's private phrase needs another line, and the
prompt becomes a glossary that only its author can maintain. The dispatcher
correcting the field is already the signal — `ExtractionCorrection` records the
field, both values and the confidence — and nothing reads it back. See the
broker-dialect section above.

### The linehaul line, read once and missed once

Both `broker-x-1` and `order-confirmation-0149043` are McLeod-style payment
blocks with the identical two lines:

```
Carrier Freight Pay:  $1,150.00      Carrier Freight Pay:  $2,600.00
Total Carrier Pay:    $1,150.00      Total Carrier Pay:    $2,600.00
```

On the first, `linehaul` was read as `$1,150.00`. On the second, `linehaul`
came back **null** and only the total was read. Same layout, same labels, two
different answers — so this is not the document being ambiguous, it is the
extraction being unstable on a field that decides what the load is worth.

**Implied contract, once confirmed across more sheets:** `Carrier Freight Pay`
IS the linehaul line. A total with no linehaul, where a freight-pay line is
printed, is a miss rather than a document that lacks one.

_Ruled on sheet `order-confirmation-0149043`; flag 10 in `PHASE-5-BRIEF.md` §7
already records two documents that returned a $0.00 linehaul, which may be the
same instability with a different symptom._

---

## Extraction-shape gaps found while verifying

The schema can hold these; `EXTRACTION_SCHEMA` in `src/lib/extraction-shape.ts`
has nowhere to put them, so they are read and dropped.

- **THE FIRST THING PHASE 6 SHOULD FIX. Accessorial charge lines are not
  extracted at all — and on one document the accessorial IS the entire pay.**

  The clinching evidence is the pair: `semail (58)` is `semail (4) (5)`
  re-issued with `Carrier Layover 150.00` added, taking the total from $150 to
  $300. **That added line is the only difference between the two documents, and
  it is the one thing the extraction cannot see.** A dispatcher who uploads the
  revision gets a load that looks identical to the one already booked, with a
  total that changed for no reason the system can name.

  And a third document has TWO of them: `werner-1` prints `Capacity Surcharge
$152.60` and `Deadhead Miles Charge $202.50` — **$355.10, exactly the gap**
  between the linehaul plus fuel that IS extracted and the total. Every one of
  the three money figures on that sheet is right and the load still cannot be
  invoiced for what it is worth.

  The original case, still true: `semail-4-5` is a TONU:

  ```
  Carrier Freight Pay:      $0.00
  Truck Order Not Used     150.00
  Total Carrier Pay:       $150.00
  ```

  The extraction returns linehaul 0 and total 15000, both correct, and cannot
  say what the $150 is. A load booked from this document has a zero rate, a
  $150 total it cannot explain, and no way to invoice the only money on the
  page. `LoadAccessorial` has a type and a billable flag and would hold it
  exactly.

- **Accessorial charge lines are not extracted at all.** Sheet 5 prints
  `LINE HAUL RATE 1100.00`, `MACROPOINT ACCEPTANCE 100.00`, `TOTAL RATE
1200.00` — and that $100 is exactly the gap between the linehaul and the total
  the extraction does return. `LoadAccessorial` has existed since Phase 3 with a
  billable flag, so the destination is built; the reader was never asked for the
  lines. Until it is, `moneyAgrees` is false on every confirmation that itemises
  anything — for the correct reason, with no way to say what the difference was.

---

## Schema-coverage gaps found while verifying

Not extraction problems. Places where the document carries a fact the system
has nowhere to put, found because a value had to be ruled null for want of a
home.

- **A printed temperature RANGE has nowhere to land.** `Temp: 33.0 to 38.0`,
  `Reefer Mode: Continuous Required`, on `order-confirmation-1321718`.
  `Load.tempF` is a single integer, so a range can only be stored by picking an
  end or by averaging — and averaging is rule 5's fabrication. Until there is
  `tempMin`/`tempMax`, the range is instructions material and `tempF` is null.
  The freight is cheese; the range is the reason the load is refrigerated at
  all, and it is currently dropped.

- **A drayage move has nowhere to put any of its own facts.**
  `ratecon-tk-25120034` is a container move and carries a container number
  (`WHSU5335908`), a container type (`40HC`), a master bill
  (`WHLC027F796635`) beside the house bill, vessel (`HMM TOPAZ 0009E`), port of
  discharge (`LONG BEACH, CA`), an ETA (`12-29-2025`) and an **L.F.D** column.
  `equipmentType: CONTAINER` is the only one of these the schema can hold.

  **L.F.D — last free day — is a money deadline**, not a note: past it the
  terminal charges per-diem and demurrage daily, against this carrier. A field
  the system cannot store is a charge nobody is warned about, which is the same
  shape as the Phase 4 compliance warning and probably wants the same
  treatment.

- **A `FactoringCompany` has no postal address.** It carries `name`,
  `contactName`, `phone`, `email` and the commercial terms — so the invoice's
  REMIT TO block can print who to contact and where to send paperwork, and
  cannot print a street address to mail a cheque to. Most factors are paid
  electronically and the portal address is what matters, which is why this was
  not noticed; it is still a hole in a block whose entire job is telling
  somebody where to send money.

- **A facility's own location code has nowhere to land.** `Location Code #:
B106091-1` and `AVP1` on `werner-1`. It is the code the facility uses for
  itself, printed on the stop — which is exactly the key facility memory would
  want beside `normalizedAddress`, since a broker prints the same code every
  time and spells the address differently.

- **A customer reference number has nowhere to land.** `Customer Ref #:
SC31869116` on `rc-ca-to-il`. It is not the broker's PRO (that is `4425076`,
  and it is in `referenceNumber`), and it is not a PO — it is the number the
  broker's own customer uses, which appears on the BOL and gets quoted in
  disputes. Instructions material for now.

- **A power-only trailer number has nowhere to land.** `TRL #260924`, printed
  in the pickup's Contact slot on `order-confirmation-0149043`. On a power-only
  move the trailer belongs to the shipper and its number is what the driver
  hooks; `LoadStop.referenceNumber` is the facility's pickup number and is the
  wrong home, so the truth sheet records null and the fact is lost. `Load` has
  `trailerId` for OUR trailers and no field for somebody else's.

## What the corpus said about decisions already made

- **Step 5's warn-not-block posture, validated by the corpus itself.** Sheets 10
  and 11 are one load and two documents. Uploading the revision second fires
  duplicate BOL (`WA229` is on the load already booked), duplicate
  broker+day+lane, and books only on confirm — which is exactly right. A system
  that REFUSED the second document would have made the ordinary act of
  recording an amended rate confirmation impossible, and the office would have
  worked around it by not recording the amendment at all. `PHASE-5-BRIEF.md`
  §7 flag 27 chose broker + day + lane on reasoning; this is the corpus
  agreeing.

---

## Code defects found while verifying

Filed, not fixed — these are application bugs rather than extraction or schema
questions, and each is recorded with the fix the owner named.

- **A decimal weight cannot be saved, and extraction reads decimals correctly.**
  `ratecon-tk-25120034` prints `44,857.46 LBS` and the extraction returns
  exactly that. `wholeNumber()` in `src/lib/loads.ts` refuses any non-integer
  outright (`ReferenceError('invalid_year')`), so a prefilled create form
  carrying a faithfully-read weight **fails to save**. Every gross weight on a
  drayage ratecon is a decimal, so this is the common case for that document
  class, not an edge.

  **Fix named by the owner: floor it at prefill.** The sheet keeps `44857.46`
  because the page prints it and the read is right — rounding is the form's
  job, and the accuracy table should not score a correct read as wrong.

  _Not applied: filed during the verification session, one line in
  `CreateLoadForm`._

- **Nothing refuses a window that ends before it starts.** Sheet 5's delivery
  came back `windowStart 08:00, windowEnd 06:00` from a malformed `0800-600`,
  and every layer accepted it: the parser (both are valid ISO local times), the
  prefill, and `createLoad`. Phase 2 §8 already refuses a load whose DELIVERY is
  before its PICKUP; a single stop whose own window inverts has no such check.

  It is a cheap guard — the stop is being written anyway — and it belongs beside
  the existing one rather than in the extraction, because a person can type it
  too.

  _Not applied: filed during the verification session._

---

## Still open, from the drafting pass

`PHASE-5-BRIEF.md` §7 flag 10 recorded three findings from the first draft of
the golden set that the verification session has not reached yet:

- ~~**zeros returned where null was asked for**~~ — **RESOLVED, and
  reclassified.** The document PRINTS all three zeros; the reader copied them
  correctly. Not a prompt-obedience problem — a placeholder-recognition
  problem, now rule 8. See rule 8 for why the distinction changes the repair;
- ~~**two documents extracted a $0.00 linehaul**~~ — **RESOLVED, corpus fact.**
  `semail (4) (5)` and `semail (58)` are the same TONU before and after a
  layover was added: the load was cancelled at the shipper and paid
  truck-order-not-used, so `Carrier Freight Pay: $0.00` is printed, true, and
  correctly read;
- ~~**three documents produced no rate at all**~~ — **RESOLVED, corpus fact.**
  All three are TONUs. Two print `$0.00` explicitly; the third
  (`shipment-4358621`) prints no freight line at all, only `TRUCK ORDERED & NOT
USED $150.00`. None is a prompt problem — each is a document about a load
  that did not run.

**All three are now closed. Flag 10 is fully resolved:** one was a
placeholder-recognition rule, two were corpus facts about loads that did not
run. None of the three was the prompt disobeying its instructions, which is
what the drafting pass assumed and what a golden set is for.

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

- ~~**THE KEY'S QUOTA IS A PRODUCTION RISK**~~ — **RESOLVED, and it left a
  feature behind.** `verify-facility-memory` failed its second upload with HTTP
  429 — _"You exceeded your current quota"_ — and had not recovered 90 seconds
  later. It was the free tier; the project is on the paid tier and the
  walkthrough passes 11/11 on Gemini.

  The owner ruled that the answer is not a bigger quota but a fallback:
  **`askModel` retries on Sonnet when the default engine cannot answer**, and
  the swap is recorded rather than silent. `AskResult.fellBackFrom` carries who
  was asked, why they failed and with what status; it is persisted into
  `extractedJson` beside the model that did answer, returned on the wire, and
  counted by the accuracy run — because a default-model column could otherwise
  report Gemini while Sonnet read half of it.

  **The rule is outage versus bad answer**, and it is the whole of it. A quota,
  a 5xx, or a fetch that never arrived mean nobody read the document: retrying
  elsewhere beats telling a dispatcher to try again. A refusal, a truncation,
  or JSON the parser rejects mean the engine DID read it and produced something
  wrong — paying a second engine to disagree is not a fallback. A 404 is
  configuration, and falling back would hide a broken deployment behind a
  working system and a larger bill.

  Two further restraints: an explicitly NAMED model never falls back, so a
  measurement column cannot secretly become Sonnet; and a parse failure cannot
  reach the fallback at all, because parsing happens downstream — asserted
  anyway, since "it cannot happen" is a claim with a history.

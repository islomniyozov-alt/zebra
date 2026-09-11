# ZEBRA — MONEY DESIGN

Status: draft for the user's review. Nothing here is built. Written against the real Datatruck settlements, the DT-015981 Werner packet, and the Sep 9 Amazon remittance.

Amended 2026-09-10 after profiling the source documents read-only. **Six** settlement statements are in `corpus/datatruck`, not eight — ST-005284, ST-005301, ST-005310, ST-005317, ST-005336, ST-005352. Everything below marked *(confirmed off the page)* was checked against them; §0, §4, §6 and §7 changed as a result.

A defect in the statements themselves, worth knowing before anything reads them: their ToUnicode maps ligature glyphs to **Private Use Area** codepoints — `U+E007` for ff, `U+E009` for tt. The files do not literally contain the strings `Payment tariff:`, `Settlement`, or `Muzaffarov`. Anything matching on those labels or on driver names has to map the PUA codes first.

Zebra's money job in one sentence: **know what was earned, know what was actually paid, and pay each driver their share of what was actually paid — weekly, per authority, without anyone retyping a number.**

---

## 0a. "Cutover" is three dates, and only one of them has happened

Written down 2026-09-10, because the word was carrying three meanings at once and every sentence using it was ambiguous:

| | date | happened? |
|---|---|---|
| **The pay-rule date** — where every seeded `DriverPayRule` begins, and before which no settleable load may pick up | **2026-08-01** | **yes**, ruled and enforced in `DATATRUCK_CUTOVER` and the drivers seed |
| **The operational cutover** — the day dispatchers stop working in Datatruck | not set | **no.** The standing ruling is that they stay on Datatruck until Zebra is finished |
| **The books cutover** — the first period Zebra is the system of record for money | not set | **no**, and it cannot precede the operational one |

**Zebra's revenue starts at the books cutover** (owner's ruling, 2026-09-10). Pre-cutover Amazon money does not enter as `Payment` rows: it was received and disbursed through Datatruck, and the six `ST-005xxx` statements are the evidence that drivers were already paid for it.

**The exclusion needs no new mechanism.** A pre-cutover load is `CLOSED_IN_DATATRUCK`, so `SETTLEABLE_LOAD` already excludes it and the importer's fifth outcome already counts it. That is the rule; there is no date comparison anywhere in the write path.

Asked of production before this was accepted — *does any pre-cutover Amazon load already carry Zebra money?* If one did, excluding its remittance would leave half a figure behind:

```
Pre-cutover direct-settled loads:  10,337   ($10,611,195.70)
  payment applications  0
  invoice lines         0
  settlement lines      0
  accessorials        600  — all on imported loads, none on loads Zebra created
```

Zero on all three ledger relations. The 600 accessorials were written by the loads import from Datatruck's `Total other pay`; they are transcribed history, not money this system moved.

**What this means for the importer:** every remittance now in the corpus is entirely pre-books-cutover. 847 of 881 payable units across six weeks are closed history. The importer has no live week to be tested against yet, and that gap cannot be closed by more reading.

---

## 0. A correction that has to come first: the week boundary

The period was recorded earlier as Saturday→Friday. It is **Sunday→Saturday** *(confirmed off the page)*: every statement prints a Period Start that is a Sunday and a Period End that is the Saturday six days later.

A period boundary off by one day puts every Saturday and Sunday delivery in the wrong week — a money error that looks like nothing. That is why it was worth confirming rather than deriving.

**What did NOT survive contact with the documents: the Tue/Thu cadence.** It was generalised from one packet. All three weeks the statements cover:

| Period | Statement date | Check date | Statements |
|---|---|---|---|
| Aug 9 (Sun) – Aug 15 (Sat) | Aug 19 (**Wed**) | Aug 21 (**Fri**) | ST-005284 |
| Aug 16 (Sun) – Aug 22 (Sat) | Aug 25 (Tue) | Aug 27 (Thu) | ST-005301, ST-005310, ST-005317 |
| Aug 23 (Sun) – Aug 29 (Sat) | Sep 2 (**Wed**) | Sep 4 (**Fri**) | ST-005336, ST-005352 |
| Amazon remittance | Aug 30 (Sun) – Sep 5 (Sat) | Sep 8 (Tue), paid Sep 9 (Wed) | — |

Two of three weeks are Wednesday statement / Friday check. So:

**Statement date and check date are per-batch INPUTS, never derived from the period.** A rule that computed "period end + 3" would have been right one week in three and wrong silently the rest — the same class of error as the boundary itself, and harder to see because each individual statement would look plausible.

§3's argument survives either shape, which is the point of writing this down rather than picking a cadence: the remittance lands Tuesday, the cash is in Wednesday, and the cheque goes Thursday **or Friday**. The money is in before the cheque is written under both observed patterns. Section 3 rests on that ordering, not on a weekday.

### The payout cadence: two weeks behind, everyone (Islom's ruling, 2026-09-11)

**A period ending Saturday is paid the Friday thirteen days later.** Aug 23–29 was paid **9/11**; Aug 30–Sep 5 pays **9/18**. It is a uniform company cadence, not a per-driver arrangement.

**Datatruck's printed Check Date is NOT the day the money moved, and must not be copied.** ST-005352 covers Aug 23–29 and prints `9/4`; the money moved `9/11`. Checked against all six statements — `period end + 13` lands on a Friday every time, and the printed date is early every time:

| statement | period end | printed Check Date | money actually moved | printed is early by |
|---|---|---|---|---|
| ST-005284 | Sat 8/15 | Fri 8/21 | Fri 8/28 | 7 days |
| ST-005301 / ST-005310 / ST-005317 | Sat 8/22 | **Thu** 8/27 | Fri 9/4 | **8 days** |
| ST-005336 / ST-005352 | Sat 8/29 | Fri 9/4 | Fri 9/11 | 7 days |

The eight-day row is not a second rule. It is the Aug 16–22 week printing a Thursday where the others print a Friday — the same wobble the table above already records — so the printed date is unreliable in weekday as well as in magnitude. Anyone reading these statements later will hit that row and should not conclude the lag varies.

**So the check date Zebra types is the REAL pay date**, and nothing derives it. This is the third reason §0 gives for the two dates being inputs, and the strongest: the source documents are not merely inconsistent about the cadence, they are *wrong* about it in a consistent direction.

**Consequences, none of which is code:**

- `Driver.payoutLagWeeks` stays **0 for everyone**. The field stays — see its comment in `schema.prisma` for why a per-driver lag remains expressible — but nothing sets it, and `payoutDate` therefore equals the batch's check date for every driver.
- **"Settle this week" (item 6) means the period that ended two Saturdays ago**, not the one that ended yesterday. A batch screen defaulting to the most recent closed week would offer to settle freight two weeks before it is paid for.
- This supersedes the earlier note that MCKANE's lag was 1. That was inferred from the ruling as given; the artefact never showed a per-driver lag, which was reported at the time as a discrepancy and is now explained — there is no per-driver lag to see.

---

## 1. Two payer shapes. Never merge them.

**Amazon / direct-settled** — no invoice, ever. One weekly ACH with a remittance file. The trip is the payable unit.
**Werner / factored** — one invoice per load, remit-to the factor, packet filed by hand, paid next day.

The discriminator already exists: `settlesDirectly` on the customer, copied to `directSettled` on the load at booking. No new flag. Every money screen splits on it, and Amazon freight never appears on Invoices or Receivables.

---

## 2. Amazon: the remittance importer

Same shape as the trips importer — upload → parse → preview with counts → confirm → batched write. Zero model calls; the file is structured.

**Parse**
- Sheet 1 is the header: carrier, SCAC, invoice number, work period, invoice total, payment status, payment date.
- Sheet 2 is the detail. Drop the 3 footer rows **by structure** (blank, total, "Paid …"), never by summing.
- Body must equal the header total exactly. If it doesn't, refuse the import and say by how much.
- Group by Trip ID: trip pay = the `TOUR - COMPLETED` base rate + every `LOAD - COMPLETED` row under it (fuel surcharge, tolls, detention, others).
- Rows with no Trip ID are single loads, keyed by Load ID.
- `CANCELLED` rows are $175 TONU. They pay, so they settle.

**Match** — Trip ID → `Load.referenceNumber` exact; Load ID → `referenceNumber` for singles. Four outcomes, counted on the preview before any row is written:

| Outcome | Meaning | Treatment |
|---|---|---|
| matched exact | remitted = load rate | pay it |
| short | remitted < rate | cash truth wins, delta shown |
| over | remitted > rate | accessorials arrived after booking |
| unmatched | Amazon paid a trip Zebra never saw | named list, **never auto-creates a load** |

The one-directional rule from the email join holds: a payment file may enrich freight, never create it.

**Write, on confirm**
- one `Payment` for the ACH, amount = header total, dated the payment date;
- `PaymentApplication` per load;
- accessorial lines on the load for FSC / tolls / detention / TONU, typed by item — so the load's gross becomes the **paid** gross;
- matched loads → PAID.

**Idempotency key: (invoice number, trip id, load id, item type).** Re-uploading the same file writes nothing. This is the guard that stops a double payment reaching a settlement, and it is the first thing to watch failing.

---

## 3. The decision that shapes everything: which gross pays the driver

Every driver is paid a percentage of gross. Which gross?

**Proposed ruling: for Amazon freight, drivers settle on REMITTED gross — what Amazon actually paid for that trip, including detention and TONU.** Booked rate is used only when the remittance hasn't arrived, and the line says so on the statement.

Why it's available: §0 — the remittance lands Tuesday, the batch is cut Tuesday, the cash is in Wednesday, and the cheque goes Thursday or Friday. What the argument needs is the ORDER, not the weekdays; the observed cadence varies week to week and the dates are batch inputs.

What it buys:
- detention Amazon paid flows the driver's 88–90% automatically. Datatruck cannot do this without someone typing it.
- a trip that paid short never overpays the driver.
- the carrier's margin on every load is real, not estimated.

What it costs, and must be accepted:
- **"Settle this week" warns loudly when the period's remittance has not been imported** and lists the loads that would settle on an estimate.
- A FINAL settlement freezes gross alongside the pay rule, the PU/DEL dates and the unit number already frozen (§6).
- Any money that arrives after a settlement is FINAL lands as a **next-week line naming the old load** ("Amazon adjustment, load 1042"), never as a rewrite. That is the same object as a one-off charge, so it costs no new machinery.

Werner is unaffected: gross = the invoice amount, settled on delivery, because the factor pays the next day.

*Alternative if rejected:* settle on booked rate and let every delta be a manual next-week line. Cheaper to build, worse answer, and it is exactly the manual work he is trying to leave behind.

---

## 4. Deductions: one open-line engine

Ruled: a deduction is a typed description plus an amount. The system need not know what a charge means, only add it up accurately. Islom's ruling holds where it mattered — **nobody writes code to add a charge.**

**Softened, not reversed, 2026-09-10.** This section said "no deduction type enum". Datatruck's statements *do* print a type column with free text beside it *(confirmed off the page)*, and the values observed across six statements are:

`Fuel` · `Insurance` · `Ifta` · `Admin Fee` · `Tolls` · `Other` · `Escrow`

So the shape is:

- **Type is a LABEL, with `Other` as the escape hatch.** It prints, it groups, and adding a new kind of charge means choosing `Other` and typing a description — not a migration. That is what the original ruling was protecting and it survives intact.
- **Description stays free text**, and is **genuinely optional**: `Ifta` and `Admin Fee` print no description at all on the real statements. A blank there is a fact about the charge, not a missing value to prompt for.
- **Code branches on type for exactly two, because only two carry behaviour**: `Fuel`, whose amount comes from the transaction import rather than a typed figure (§5), and `Escrow`, which has a target and a running balance and must stop itself. Every other type is a string that prints.

A type that carried no behaviour and could not be extended without a migration would have been the enum this section was right to refuse. A label with an escape hatch is not that.

**`RecurringDeduction`** (per driver): description, amount, cadence `WEEKLY | MONTHLY_SPLIT_WEEKLY`, optional target, optional proration, effective from/to. Created on the driver screen, dated, **superseded rather than edited** — same posture as `DriverPayRule` and for the same reason: these land on statements that have already been handed to a person.

- Insurance $1,800/month charged weekly at $450 → `MONTHLY_SPLIT_WEEKLY`, prints `$1800/$450`.
- Escrow $2,500 at $250/week → target with running balance, prints `$2500/$500`, and **stops itself when the target is reached, saying that it stopped.** Datatruck does not stop.
- Admin $50, IFTA $50 → flat weekly.
- First and last week prorate from the effective dates and print the day count ("for August 24 days $43.55").

**`SettlementCharge`** (one-off): description, amount, sign, optional `loadId`. "Charge for late Del Load#…" and a truck-wash reimbursement are the same object with opposite signs.

Escrow is the only one needing a ledger rather than a line: a held balance per driver, incremented on each FINAL settlement, refundable on termination.

No trailer rent — the operation is power only.

**An empty section is omitted, never rendered at zero** *(confirmed off the page)*. The two Dolphins statements carry no Deductions block at all — the summary reads `Deductions: $0.00` and the section simply is not there. Only the RAM statements carry `Fuel Transactions`. A zero-row table claims that somebody looked and found nothing; an absent section claims nothing, which is the honest output when there is nothing to say. Same rule §5 already states for the fuel line, generalised.

---

## 5. Fuel and tolls

The fuel deduction is the sum of the card's **invoice** amounts for the period. Retail prints for the driver's information; the discount stays with the company.

- **`FuelTransaction`** import from the card export (Pilot/EFS): date, card, driver, unit, station, city, state, product, gallons, retail, invoice. Idempotent on the transaction id.
- A week's transactions for one driver roll into **one** deduction line; the individual swipes print as the statement appendix, exactly as Datatruck does.
- An unmatched card is named on the preview and never guessed onto a driver.
- Tolls (PrePass) are the identical shape: one line plus a date range.

Both are optional at settlement time. A driver with no fuel import that week gets **no fuel line** — not a zero line, which would claim a fact.

---

## 6. The weekly batch

**`SettlementBatch`**: company + period + statement date + check date + status `DRAFT | FINAL | PAID`. One batch per company per week.

**Built 2026-09-11.** `settlement-week.ts` is the arithmetic and is graded against all six statements; `settlement-batch.ts` reads and writes the rows. A DRAFT holds no truth — every refresh deletes its settlements and recomputes from the loads, rules and charges as they are now, which is what makes "add the missing pay rule and refresh" a thing a person can do. The delete happens BEFORE the read, and that order is load-bearing: `settleableForBatch` excludes any load already carrying a settlement line, so reading first makes a draft invisible to its own refresh. The live path caught it — three loads went in, one fell out of the batch entirely and turned up unsettled the following week.

`SB-` and `ST-` draw from `SeriesCounter`, keyed on the ORGANIZATION rather than the company. `Counter` stays per-authority because a load number and an invoice number belong to one; holding a shared series there would mean nominating one company to keep it in, which nothing in the schema could express.

One action, **"Settle this week"**, per company. It:
- takes every driver with a load delivered in the period;
- **refuses, naming them**, any driver with no pay rule in force at period end — never skips silently;
- excludes the non-people rows (7 Star, TJK logistic, truck 3609 Said) — they need a decision, not a settlement;
- warns if the period's Amazon remittance is not imported (§3);
- builds every statement and leaves the batch DRAFT for a person to read.

`FINAL` freezes gross, pay rule, PU/DEL dates, **unit number**, deduction amounts and escrow balances. `PAID` records the payout date and the method. Statement date and payout date are separate columns because they are separate events — and both are **inputs**, not derived from the period (§0).

**The unit number is a per-settlement field, not a lookup** *(confirmed off the page)*. Muzaffarov settles on unit `0484` for Aug 16–22 and unit `8842` for Aug 23–29. Reading it from the driver's current truck link at render time would silently rewrite last month's statement the next time somebody reassigned a truck — a statement already handed to a person, changing under them. It belongs in the frozen set for the same reason gross and the pay rule do.

**Numbering: statements share ONE sequence across carriers; invoices stay per-authority.**

The real series is `ST-005xxx`, and it runs as one counter across both companies *(confirmed off the page)*: 5284 RAM, 5301 Dolphins, 5310 RAM, 5317 RAM, 5336 Dolphins, 5352 RAM. This section previously said per-company for both, which the artifact contradicts.

Matching the artifact, and the distinction is real rather than a concession: **an invoice is an outward-facing document that carries the authority's MC and its own invoice series, so it must be per-authority. A statement is internal paperwork** — nobody outside the company ever sees one — so a shared counter costs nothing and matches what the drivers already recognise. `SB-` batch ids behave the same way (SB-000436 through SB-000440 across both carriers).

**YTD is a query over FINAL settlements in the calendar year, never a stored accumulator.** A stored accumulator drifts the first time anything is voided; a query is one indexed round trip.

The percentage is applied **per load line and rounded per line**, not once on the total. `money.ts` owns the rounding, half-up, integer cents. TONU flows through the same percentage ($175 → $157.50) — and ST-005284 prints exactly that: a $175.00 Murfreesboro-to-Murfreesboro line paying $154.00 at 88%.

**CONFIRMED 2026-09-11, and four of the six settle it.** The earlier note here said none of the six had a line where per-line and on-total results differ, so the rule was unconfirmed. Reading the statements out of the PDFs rather than off a summary, four do — and every one prints the per-line answer:

| statement | gross × rate | rounded on the total | printed |
| --- | --- | --- | --- |
| ST-005310 | $9,210.76 × 88% | $8,105.47 | **$8,105.46** |
| ST-005317 | $10,839.15 × 30% | $3,251.75 | **$3,251.74** |
| ST-005336 | $9,490.80 × 32% | $3,037.06 | **$3,037.05** |
| ST-005352 | $5,556.01 × 30% | $1,666.80 | **$1,666.81** |

*(The earlier citation of "ST-0290 (796.98 → 717.28)" was a mis-transcription; no such statement exists.)*

---

## 7. Werner: one button, one packet

**File with factor**, on the load.

- Disabled until invoice + POD + BOL + rate confirmation all exist, and the tooltip **names the missing piece**. Zebra is stricter than Datatruck here by ruling.
- Produces one PDF per load in packet order: invoice → POD → BOL → rate confirmation. *(Confirmed off DT-015981: page 1 the invoice, pages 2–4 three 960×1280 scans, pages 5–8 the four-page Werner rate confirmation.)*
- Invoice: Bill To the broker, **REMIT TO the factor**, `IN-<shipment id>`, terms 30, load number = `referenceNumber`, linehaul flat.
- **`IN-` + the load's own six-digit Datatruck sequence** *(confirmed off the page)*: `IN-015981` against Shipment ID `DT-015981`. The invoice number is computed from the load, not allocated separately, and that is the join between the two.
- The fields it prints, verbatim: `Invoice ID · Date · Due Date · Terms · Load Number · Customer ID`. Charges table: `Type · Description · Charges`, one row `Linehaul · FLAT`.
- **The remit-to block on the real invoice is the factor's NAME and nothing else** — `RTS Financial`, no address, no account, no notice-of-assignment text. Worth deciding deliberately rather than inheriting: a factor's remittance instructions usually belong on the face of the invoice.
- **Do not reproduce Datatruck's `, 0,` bug.** Its Bill To renders as `PO BOX 45308, 0, OMAHA, NE, 68145-0308` — an empty address line 2 printed as a literal zero. An absent line is omitted, not filled with a placeholder; the same rule as an omitted section in §4.
- A yard drop's POD is **phone photos of the trailer**, so the packet must accept images as POD, not only documents.
- After filing, a person clicks PAID.

**Embedding a foreign PDF — built 2026-09-11, by the second of the two routes.**

It was owed from the day the packet was built, and silent until 2026-09-10: the assembler spliced pages out of PDFs *this system wrote* — uncompressed, one content stream per page — so a broker's agreement contributed nothing and the packet assembled **without it**. Five pages where DT-015981 has eight, no error, and a factor holding a packet with nothing to check the rate against. The load looked ready the whole time, because the document *is* on it.

`src/lib/pdf-import.ts` now reads the source's object graph and **copies each page's dictionary with everything it reaches** — resources, fonts, embedded font programs, images, colour spaces — renumbering references. Streams are carried byte for byte with their `/Filter` untouched; nothing is inflated and nothing is re-encoded. That is the second of the two routes named here, and the reason is that a page's marks depend on its resource dictionary: a content stream pasted onto a page with different resources renders different marks, or none, and says nothing about it. A rate confirmation is a contract, and a version of it that renders differently from the one the broker sent is worse than no version.

Graded against `corpus/werner-1..pdf`, which is **five scanned pages with no text operators in it at all** — the case the splicer could never have handled. The acceptance files it on a seeded load and reads eight pages back out of the produced file.

Of the fifteen broker PDFs in `corpus/`, thirteen copy. Two refuse, by name:

- **`encrypted`** — strings and streams are ciphertext; copying them produces a packet that opens and shows nothing. Decryption is a different promise, and so is the judgement about forwarding a document somebody locked.
- **`compressed_objects`** — objects stored inside a Flate stream cannot be read without inflating, and `DecompressionStream` is async, so reaching them means making the whole assembly path async. That is a trade to make deliberately rather than in passing; one file in fifteen. **Still owed**, and worth picking up if a broker turns out to send them routinely.

Both refuse the packet with them, and the route says which file and what to do about it. What must never happen again is the silent version.

Factoring money stays out of the software — funded amounts, fees, reserves and disputes remain manual, by his ruling.

---

## 8. Screens

- **Money → This week** — the only screen anyone opens on Tuesday. Three columns: Amazon (expected / remitted / short), Werner (ready to file / filed / paid), Settlements (draft / final / paid). Every number links to its rows.
- **Money → Remittances** — importer plus history.
- **Money → Settlements** — batches by week and company, drilling to a driver's statement.
- **Driver screen** — pay rule history, recurring deductions, escrow balance, statement history.
- **Invoices / Receivables** — scoped to broker freight only. They read $0 today and look broken; scoped, they will read correctly.

---

## 9. What must not be built

No factoring ledger. No trailer rent. No auto-created loads from a remittance. No editing a FINAL settlement. No stored YTD.

No **closed** deduction type enum — see §4. A type that could not be extended without a migration is still refused; a label with `Other` as its escape hatch is not that, and the statements print one.

No statement date or check date derived from the period (§0). No unit number read from the driver's current truck link at render time (§6). No zero-row section standing in for an absent one (§4), and no placeholder standing in for an absent address line (§7).

---

## 10. Open decisions — the user's, not the design's

1. **Remitted gross vs booked gross** (§3). Recommendation: remitted.
2. **The 3% / 4% pair rows** (Chapan Haydar, Chapan Odiljon, Assem Chapan): does the low row get its own settlement, or is it a line on the high row's?
3. **Advances** — Datatruck prints an Advances line. Are advances given, and are they weekly deductions or one-offs?
4. **Escrow refund on termination** — back through a settlement as a negative deduction, or outside the system?
5. **Non-people rows** (7 Star, TJK logistic, truck 3609 Said) — fee payees, or roster rows to be removed?
6. **Month-end**: what the accountant actually needs. Asked twice, still unanswered. It decides the reports screen, not this design.
7. ~~**§0's week boundary** — confirm Sunday→Saturday off the printed documents.~~ **Answered 2026-09-10: Sunday→Saturday, confirmed.** The Tue/Thu cadence beside it did not survive and is now a batch input.
8. **The remit-to block** (§7) — Datatruck prints the factor's name alone. Does RTS require an address or assignment notice on the invoice face?
9. **Per-line rounding** (§6) — still unconfirmed; none of the six statements carries a line where per-line and on-total rounding differ.

---

## 11. Build order

1. Remittance importer — highest leverage, and §3 depends on it.
2. Recurring deductions + one-off charges.
3. Batch settle + statement PDF.
4. Fuel and toll imports.
5. Werner packet button.
6. Money → This week.

**Which date this order hangs off, since the word was doing three jobs — see §0a.** Items 1–5 can be built and proved before the operational cutover; none of them needs Datatruck to have stopped. What they cannot be *exercised* on is live money, because until dispatchers move, every remittance week is closed history and the importer's live path stays a path no artefact has run.

So item 1 ships in two halves and they have different bars. The reader and preview were proved against six real workbooks. The writer can only be proved against the handful of live units those weeks happen to contain — five, totalling $7,446.35 — plus its refusal to touch the 847 closed-history units beside them. That is a small acceptance set and it is the whole of what exists; the first real week is the first week after the operational cutover.

**Prerequisite that is not code:** every load a settlement touches needs a driver and a truck.

*Updated 2026-09-10 — the roster is on production now, so the prerequisite is narrower and measurable rather than blanket. What remains:*

- **Three live loads carry no driver and no truck** ($312.87). Two more, 1015 and 1016 on truck 7072, carry a truck and no driver — $2,703.58 the Datatruck export names SHUHRAT SHARIPOV for. That gap is structural: the import's enrichment path writes five fields and driver is not one of them.
- **17 active drivers have no truck link**, across 26 driver→truck pairs the freight itself evidences; 13 of them run under an authority that disagrees with the truck's.
- **25 loads picked up before the pay rules start** (2026-08-01) and are still settleable, carrying $14,528.04 across 18 drivers. The drivers seed refuses to write while any of them exists — correctly. They are held pending a settlement-statement check that the six available statements cannot answer: they cover 2026-08-09 → 2026-08-29 and every one of the 25 picked up on or before 2026-07-10, so the honest verdict for all 25 is **"no statement for that week", never "unpaid"**.

Standing rules that apply throughout: integer cents; `money.ts` owns rounding; third-party latency never inside a transaction; batched writes against the 200 ms statement and 5 s transaction ceiling; guards watched failing before they are trusted; retired authorities keep owning their history.

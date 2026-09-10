# ZEBRA — MONEY DESIGN

Status: draft for the user's review. Nothing here is built. Written against the eight real Datatruck settlements, the DT-015981 Werner packet, and the Sep 9 Amazon remittance.

Zebra's money job in one sentence: **know what was earned, know what was actually paid, and pay each driver their share of what was actually paid — weekly, per authority, without anyone retyping a number.**

---

## 0. A correction that has to come first: the week boundary

The period was recorded earlier as Saturday→Friday. Checked against the real dates, it is **Sunday→Saturday**:

| Document | Period | Statement / invoice | Money |
|---|---|---|---|
| Datatruck ST-0290 | Aug 16 (Sun) – Aug 22 (Sat) | Aug 25 (Tue) | Check Aug 27 (Thu) |
| Amazon remittance | Aug 30 (Sun) – Sep 5 (Sat) | Sep 8 (Tue) | Paid Sep 9 (Wed) |

A period boundary off by one day puts every Saturday and Sunday delivery in the wrong week — a money error that looks like nothing. **Confirm this off the printed documents before it is coded**, since it is derived from day-of-week arithmetic, not from a weekday printed on the page.

What the corrected calendar gives us: the period closes Saturday, Amazon's remittance is available Tuesday, Amazon's cash is in the bank Wednesday, and the driver cheque goes Thursday. **The money is in before the cheque is written.** Section 3 rests on this.

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

Why it's available: §0 — the remittance lands Tuesday, the batch is cut Tuesday, the cash is in Wednesday, the cheque goes Thursday.

What it buys:
- detention Amazon paid flows the driver's 88–90% automatically. Datatruck cannot do this without someone typing it.
- a trip that paid short never overpays the driver.
- the carrier's margin on every load is real, not estimated.

What it costs, and must be accepted:
- **"Settle this week" warns loudly when the period's remittance has not been imported** and lists the loads that would settle on an estimate.
- A FINAL settlement freezes gross alongside the pay rule and the PU/DEL dates already frozen.
- Any money that arrives after a settlement is FINAL lands as a **next-week line naming the old load** ("Amazon adjustment, load 1042"), never as a rewrite. That is the same object as a one-off charge, so it costs no new machinery.

Werner is unaffected: gross = the invoice amount, settled on delivery, because the factor pays the next day.

*Alternative if rejected:* settle on booked rate and let every delta be a manual next-week line. Cheaper to build, worse answer, and it is exactly the manual work he is trying to leave behind.

---

## 4. Deductions: one open-line engine

Ruled: a deduction is a typed description plus an amount. The system need not know what a charge means, only add it up accurately. **No deduction type enum** — next year's new charge needs no code.

**`RecurringDeduction`** (per driver): description, amount, cadence `WEEKLY | MONTHLY_SPLIT_WEEKLY`, optional target, optional proration, effective from/to. Created on the driver screen, dated, **superseded rather than edited** — same posture as `DriverPayRule` and for the same reason: these land on statements that have already been handed to a person.

- Insurance $1,800/month charged weekly at $450 → `MONTHLY_SPLIT_WEEKLY`, prints `$1800/$450`.
- Escrow $2,500 at $250/week → target with running balance, prints `$2500/$500`, and **stops itself when the target is reached, saying that it stopped.** Datatruck does not stop.
- Admin $50, IFTA $50 → flat weekly.
- First and last week prorate from the effective dates and print the day count ("for August 24 days $43.55").

**`SettlementCharge`** (one-off): description, amount, sign, optional `loadId`. "Charge for late Del Load#…" and a truck-wash reimbursement are the same object with opposite signs.

Escrow is the only one needing a ledger rather than a line: a held balance per driver, incremented on each FINAL settlement, refundable on termination.

No trailer rent — the operation is power only.

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

One action, **"Settle this week"**, per company. It:
- takes every driver with a load delivered in the period;
- **refuses, naming them**, any driver with no pay rule in force at period end — never skips silently;
- excludes the non-people rows (7 Star, TJK logistic, truck 3609 Said) — they need a decision, not a settlement;
- warns if the period's Amazon remittance is not imported (§3);
- builds every statement and leaves the batch DRAFT for a person to read.

`FINAL` freezes gross, pay rule, PU/DEL dates, deduction amounts and escrow balances. `PAID` records the payout date (Friday) and the method. Statement date and payout date are separate columns because they are separate events.

Numbering: per company, forward-only, the existing `Counter` table. `ST-` statements, `SB-` batches.

**YTD is a query over FINAL settlements in the calendar year, never a stored accumulator.** A stored accumulator drifts the first time anything is voided; a query is one indexed round trip.

The percentage is applied **per load line and rounded per line**, not once on the total — measured on ST-0290 (796.98 → 717.28). `money.ts` owns the rounding, half-up, integer cents. TONU flows through the same percentage ($175 → $157.50).

---

## 7. Werner: one button, one packet

**File with factor**, on the load.

- Disabled until invoice + POD + BOL + rate confirmation all exist, and the tooltip **names the missing piece**. Zebra is stricter than Datatruck here by ruling.
- Produces one PDF per load in packet order: invoice → POD → BOL → rate confirmation.
- Invoice: Bill To the broker, **REMIT TO the factor**, `IN-<shipment id>`, terms 30, load number = `referenceNumber`, linehaul flat.
- A yard drop's POD is **phone photos of the trailer**, so the packet must accept images as POD, not only documents.
- After filing, a person clicks PAID.

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

No factoring ledger. No trailer rent. No deduction type enum. No auto-created loads from a remittance. No editing a FINAL settlement. No stored YTD.

---

## 10. Open decisions — the user's, not the design's

1. **Remitted gross vs booked gross** (§3). Recommendation: remitted.
2. **The 3% / 4% pair rows** (Chapan Haydar, Chapan Odiljon, Assem Chapan): does the low row get its own settlement, or is it a line on the high row's?
3. **Advances** — Datatruck prints an Advances line. Are advances given, and are they weekly deductions or one-offs?
4. **Escrow refund on termination** — back through a settlement as a negative deduction, or outside the system?
5. **Non-people rows** (7 Star, TJK logistic, truck 3609 Said) — fee payees, or roster rows to be removed?
6. **Month-end**: what the accountant actually needs. Asked twice, still unanswered. It decides the reports screen, not this design.
7. **§0's week boundary** — confirm Sunday→Saturday off the printed documents.

---

## 11. Build order

1. Remittance importer — highest leverage, and §3 depends on it.
2. Recurring deductions + one-off charges.
3. Batch settle + statement PDF.
4. Fuel and toll imports.
5. Werner packet button.
6. Money → This week.

**Prerequisite that is not code:** every load needs a driver and a truck, and production has neither. The roster seed reaches production before any of this can be tested against real freight.

Standing rules that apply throughout: integer cents; `money.ts` owns rounding; third-party latency never inside a transaction; batched writes against the 200 ms statement and 5 s transaction ceiling; guards watched failing before they are trusted; retired authorities keep owning their history.

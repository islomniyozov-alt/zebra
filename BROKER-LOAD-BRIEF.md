# BROKER-LOAD-BRIEF.md — the broker (non-Amazon) load detail in Datatruck's shape

_Owner's brief 2026-11-21. Artefacts: `corpus/datatruck/broker-load-2026-11-21.png`
(DT-018987, Werner route 2004989520) and `corpus/datatruck/packet-DT-018987.pdf`
(five letter pages: one POD photo as a full page, then Werner's four-page rate
con; no invoice page). Built on `work/second` in the steps of §4, each "ready to
merge", full ritual at merge. **Amazon loads unchanged** (`isAmazonLoad`, §7.13)._

## 1. What the owner asked for

The §7.13 shape (header, tracker, stops, trips, three cards, Activity and
Profit box rail) for every load that is not Amazon, plus:

1. **Documents as five tiles** — Rate confirmation, Bill of lading, Proof of
   delivery, Document, Commercial invoice — each an upload target, a filled
   tile showing its file. A broker load warns **Rate con missing** until one is
   uploaded and **cannot be dispatched without it** (dispatcher override with a
   reason, audited); **POD missing** after Delivered; **Create invoice**
   disabled until a POD is on file.
2. **Merge & send** — one PDF: letter pages, POD photos first as full pages,
   then the rate con's pages, then the invoice when one exists. Stored as the
   load's **Invoice packet** document, sent to the broker's billing email or
   the factor by the load's payment type via Resend, audited. Also **Merge
   download**. Idempotent: a re-send never duplicates the packet.
3. **Other pay** (accessorials) table and **Photos** (Pickup / Delivery
   folders) as in Datatruck; **Commodities** only if Zebra stores them.

## 2. What exists, what is missing

| Piece          | Exists                                                                                                                                                                                                                                                                                                                     | Missing                                                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §7.13 shape    | `loadDetailView(load).datatruckShape` (= `isAmazonLoad`) gates one branch of `loads/[id]/page.tsx`; `TrackerSteps`, `TripsTable`, `DetailCard`, `FactGrid`, `ProfitBoxCard` in `AmazonDetail.tsx`; `trackerStep`, `tripsFromStops`, `profitBox` in `src/lib`                                                               | A second flag for "Datatruck shape, broker rules". Non-Amazon loads render the older stacked page (stripe header, `PipelineStrip`, stop cards, RatePanel, PaymentType, Factoring, LoadDocuments, timeline).                    |
| Document types | `DocumentType`: `RATE_CONFIRMATION`, `BOL`, `POD`, `OTHER`, `PHOTO`, `INVOICE_PDF`, …                                                                                                                                                                                                                                      | **No `COMMERCIAL_INVOICE`, no `INVOICE_PACKET`.**                                                                                                                                                                              |
| Required slots | Rate con required, POD required from Delivered (`page.tsx:805`), "Missing — this load needs one."                                                                                                                                                                                                                          | Tiles; a WARNING (no load warning reads documents today — `load-warnings.ts`, `warnings.ts`).                                                                                                                                  |
| POD → status   | Confirming a POD upload sets `POD_RECEIVED` (`documents.ts:504`, `podConfirmed`)                                                                                                                                                                                                                                           | —                                                                                                                                                                                                                              |
| Dispatch       | `DISPATCHED` is set automatically when truck and driver are both on a `BOOKED` load (`statusForAssignment`); the dispatch board warns-then-acknowledges with a reason on `LoadAssignment.reason` (`dispatch/actions.ts:44`, `dispatchWarnings`)                                                                            | The load page's `assignLoadAction` runs no `dispatchWarnings` at all — the same gap Phase 4 §6 flag 19 named. No rate-con condition anywhere.                                                                                  |
| Create invoice | `generateInvoice` already requires `POD_RECEIVED` (`readyToInvoiceWhere`); only `/invoices` ReadyQueue calls it                                                                                                                                                                                                            | A button on the load page.                                                                                                                                                                                                     |
| Packet PDF     | `assemblePacketPdf` (`src/lib/pdf.ts:174`), hand-written, **no library on purpose** ("pdf-lib and its cousins are 300–600 KB of bundle"): JPEG as full pages, foreign PDF pages imported (`pdf-import.ts`); `GET /api/loads/[id]/packet`, factoring order INVOICE → POD → BOL → RATE CON, rendered on demand, never stored | The owner's order (POD photos → rate con → invoice); storing it; non-JPEG images (refused `unreadable_image`). Uploads are already JPEG: `compressImage` re-encodes every image to `image/jpeg` in the browser before the PUT. |
| Email          | `sendEmail` (`email.ts:100`), Resend over fetch                                                                                                                                                                                                                                                                            | **Attachments.** **From-address is `onboarding@resend.dev` on both workers** (`wrangler.jsonc:216, 323`) — not a sender a broker's AP inbox accepts.                                                                           |
| Recipients     | `Customer.billingEmail`, `FactoringCompany.email`, `Load.paymentType` (`Quickpay`, `Factored`, `ACH`, `Direct`), `Load.factoringCompanyId`; `Invoice.sentToEmail`, `markInvoiceSent` ("NOT a send")                                                                                                                        | A send.                                                                                                                                                                                                                        |
| Other pay      | `LoadAccessorial` (type, amount, billable, status), listed as a `<ul>` in RatePanel                                                                                                                                                                                                                                        | The table with an add row.                                                                                                                                                                                                     |
| Commodities    | `Load.commodity`, `weightLbs`, `tempF`, `isHazmat` — ONE line per load                                                                                                                                                                                                                                                     | No item table, no QTY/type/pieces/dimensions.                                                                                                                                                                                  |
| Photos         | `PHOTO` type (portal captures it)                                                                                                                                                                                                                                                                                          | **No pickup/delivery folder** on a document.                                                                                                                                                                                   |
| Memory         | GAPS 44 open: dev isolate crosses 128 MB under sweep load, 1 in 3                                                                                                                                                                                                                                                          | Any measurement of packet assembly.                                                                                                                                                                                            |

## 3. Rulings needed (recommendation first in each)

- **R1 — PDF engine: extend `assemblePacketPdf`, NOT pdf-lib.** The brief says
  pdf-lib; `pdf.ts` refused it in writing for bundle size on a Worker already
  at its memory ceiling (GAPS 44), and the existing assembler already does both
  things the packet needs (JPEG as a full page, PDF pages imported). Uploads
  are JPEG by construction. A HEIC/PNG that reached storage some other way is
  refused by name ("convert to JPEG"), as now.
- **R2 — Dispatch gate = the existing warn-then-acknowledge, on BOTH paths.**
  `rate_con_missing` joins `dispatchWarnings`; the board and the load page's
  assignment both refuse the first submit and accept the second with a
  reason, written to `LoadAssignment.reason` and the audit row. Because
  assignment and dispatch are one act today (truck + driver ⇒ `DISPATCHED`),
  the gate sits on that act. Alternative: let assignment through and hold the
  status at Booked — rejected, it invents a second dispatch step.
- **R3 — Migration 76:** `DocumentType` gains `COMMERCIAL_INVOICE` and
  `INVOICE_PACKET`; `Document` gains `photoStage` (`PICKUP` | `DELIVERY`,
  nullable) for the two photo folders, and `packetInputsHash` (nullable) for
  idempotency. Additive only; no default dropped. Production first.
- **R4 — Idempotency:** a packet's identity is the SHA-256 of its inputs (each
  source document's hash in packet order, plus the invoice id). Merge reuses
  the stored packet when the hash matches; a changed input supersedes the old
  packet (soft-deleted, kept in history), never a second live one. A re-send
  of the same packet to the same address within 24 h is refused with the time
  of the first send; a send is one audit row naming who, to whom, which
  packet.
- **R5 — Recipient:** `Factored` → the load's factoring company `email`;
  `Quickpay`, `ACH` or empty → the customer's `billingEmail`; `Direct` / an
  Amazon load → no send (not offered). No address → the button says which
  field is empty and links to it. When an invoice exists, the send marks it
  sent (`markInvoiceSent` with `sentToEmail`).
- **R6 — Sender:** a verified Resend domain before step 5 ships — e.g.
  `billing@zebratms.com` (zebratms.com already takes inbound mail), reply-to
  the authority's own email. Islom sets `RESEND_FROM` per the secret-entry
  rule. Until then step 5 builds and tests but stays off production.
- **R7 — Commodities: one read-only row** (description, weight, temperature,
  hazmat) from the four fields Zebra stores — or omit it. No item table
  without a model, which is a separate brief.
- **R8 — Not built:** Share Load, Follow load, Map view, Commission, Tags,
  Freight tags, Create E-Check, Bulk download (Merge download covers it),
  Edit load (no edit route; §7.13's flag stands).
- **R9 — Packet input cap:** at most 20 MB of source bytes per packet, refused
  by name above it; the assembly measured on dev with the isolate probe
  before step 4 ships (three runs, zero `exceededMemory`, as the argon2 rule).

## 4. Steps (each "ready to merge" on `work/second`)

0. **Doc:** TMS §7.14 "The broker load detail" with R1–R9 as ruled; migration 76
   written, applied to dev, pushed with its file (deploy order step 5).
1. **Shape.** `loadDetailView` gains `brokerShape` (`!amazon && !direct`); the
   broker load renders the §7.13 layout through the same components, with
   **Create invoice** in the header (enabled iff `readyToInvoiceWhere`), the
   seventh tracker word Invoiced. Render tests: an Amazon fixture renders
   byte-for-byte the same tabs and header as before.
2. **Documents tiles and warnings.** Five tiles over the existing upload flow;
   `rate_con_missing` and `pod_missing` load warnings (non-Amazon, non-direct,
   counted in the list's Warnings column through the one load-facts statement —
   query count held); the dispatch gate per R2 on both paths; guards watched
   failing.
3. **Other pay, Commodities, Photos.** Accessorial table with an add row
   (`LoadAccessorial`, billable by default); Commodities per R7; Photos as two
   folders over `PHOTO` documents with `photoStage`, upload into a folder, the
   portal's pickup/delivery captures setting it.
4. **Merge download.** `buildInvoicePacket`: POD photos (full letter pages),
   then the POD/BOL PDFs, then the rate con, then the invoice PDF when one
   exists; stored as `INVOICE_PACKET` by R4; R9 cap; memory measured on dev.
   Sample test: the DT-018987 inputs give five pages in the corpus packet's
   order.
5. **Merge & send.** Attachments in `sendEmail`; recipient by R5; one audit
   row per send; idempotent by R4; behind R6.

## 5. Flags against the brief

- pdf-lib (R1) — reversed in favour of the existing assembler, if ruled.
- "Cannot be dispatched" (R2) — becomes warn-and-acknowledge, the product's
  standing pattern (§2.4 "warn, do not block"), not a hard block.
- The load page's assignment never ran `dispatchWarnings` — an existing gap
  this chain closes as a side effect; it changes what a dispatcher sees on
  the load page for compliance warnings too.

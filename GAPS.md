# GAPS

What is known to be wrong or unfinished, in the order it gets worked: money
first, then everything else, in batches of ten. Build queue item 3.

**Source of the sweep rows:** `npm run sweep` against dev, 2026-10-06 —
`SWEEP CLEAN — OK. 57 PAGE(S), 0 PROBLEM(S)`, with the owner's session and with
no session. **The dispatcher role is NOT swept**: no dispatcher account exists
(ruling open, below). A clean sweep of two roles says nothing about the third.

A row leaves this file in the commit that closes it, with the commit named.

## Code — money first

| #   | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Where                                                                                | Found                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------- |
| 68  | **The generate path's trips still live in `SettlementLine` as `LOAD_PAY` rows; a hand-added trip is a `SettlementLoadLine`.** Each trip is in exactly one table and the header reads both (67), but the statement page's trips grid, the PDF's trip rows and `Trips count` read `SettlementLoadLine` only — so a generated workbench statement shows no trips there. Moving the rows is migration 68: measured 2026-10-06 at twelve test sites and six readers (the drift checker's snapshot arm, `settleableWhere`, `removeSettlementLine`'s guard, the page's trips section, three importers' tests). After 67's production dispatch, by deploy-order step 5. | `settlements.ts` generateSettlement, `settlements/[id]/page.tsx`, `statement-pdf.ts` | §6.2.2 v10.35, 2026-10-06  |
| 4   | **`Driver.employmentType` is an `OwnershipType`** — a truck's title on a person; "company driver" is spelled `OWNED`. Rename is a migration plus every writer: `fleet.ts:617,726`, `datatruck/drivers.ts:592`, the record form, the picker. Then `/payroll/statements` gets its `driverType` funnel, which today would want `OWNED` typed.                                                                                                                                                                                                                                                                                                                      | schema, the writers above                                                            | §6.2.10 part 6, 2026-10-06 |
| 5   | **Rate confirmation → pay basis.** The create form reads `money.total` into the rate field and stores it as `linehaulCents`; fuel and accessorials become line haul. Dev load 1177: line haul 245000 + fuel 38750 + detention 12000; stored `linehaul 295750`. Under JASON RAY BRACE's live rule (`PERCENT_LINEHAUL` 30%): **$887.25 today, $735.00 under the alternative**, $152.25 apart on one load. 55 of 57 live rules are `PERCENT_LINEHAUL`. **Ruling.**                                                                                                                                                                                                 | load create action, `payFor`                                                         | UAT, 2026-10-04            |
| 8   | **Production live check runs 11 of 12**: `PAIRED CHECKS SKIPPED (no session)` because `PROD_CHECK_EMAIL` / `PROD_CHECK_PASSWORD` are unset. Needs the Live Check ADMIN account (human step).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `scripts/live-check.mjs:146`, `.env`                                                 | UAT, 2026-10-04            |
| 9   | **zebratms.com — origins by env, measured, not yet done.** `APP_ORIGIN` is a per-worker var (`wrangler.jsonc:144` dev, `:221` production). Readers: `settlements/actions.ts:279` (falls back to the request host), `users/new/page.tsx:62` + `NewUserForm.tsx:148` (falls back to `window.location.origin`), `reset-actions.ts:50`, `reset-email.ts:82`. (`inbound-email.ts` names `loads@zebratms.com`, the MAIL domain, which already lives on zebratms.com — not an origin reader.) The cookie is host-only (AGENTS.md), so the move is the var plus one fresh sign-in.                                                                                      | the five readers                                                                     | build queue item 4         |

## Data — accountant / owner

Not code. Found on the production walk of 2026-10-05 (the owner's findings) and
in the readings taken for it. Nothing here is fixed by a deploy.

| What                                                                                                                                                                                                                  | Who                 | How                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Duplicate driver rows** — drivers sharing a phone or a truck within one authority. Three pairs share a unit without sharing a phone (3609, 3622, 4588); two "drivers" are not people (`Said truck 3609`, `7 Star`). | Islom merges        | `node scripts/duplicate-drivers.mjs --target=production` — read-only, lists each pair with statement $ per row |
| **Empty charges** — charge rows carrying no amount.                                                                                                                                                                   | accountant          | fill or void on `/payroll/charges`                                                                             |
| **Stale compliance dates** on driver and truck records.                                                                                                                                                               | owner / safety      | update on the records; the dashboard's 30/60/90 counts read them                                               |
| **Two unimported weeks** of settlements.                                                                                                                                                                              | accountant          | Datatruck import for the two weeks, then `/payroll/batches` shows them                                         |
| **`ST-000018`** stores `deductionsCents` −45000 beside two statements at +45000 (code gap 1). The grid is correct; the stored field is not.                                                                           | nobody, until gap 1 | leave the row; it is the evidence                                                                              |
| **Dev load 1177** is kept as the artefact for ruling 5.                                                                                                                                                               | Islom               | delete it once the ruling is made, or say so                                                                   |

## Rulings open

- Rate basis (code gap 5) — from load 1177.
- ~~Remittance penny~~ — ruled 2026-10-06: closed, stays as is. The penny is
  placed, not lost, and a one-cent `over`/`short` label is the truth.
- `PROD_READONLY_DATABASE_URL` and `correct-direct-settled.ts` — PARKED by
  ruling 2026-10-06 until Islom supplies the read-only string; neither moves
  before then.
- Live Check ADMIN and dispatcher accounts — ruled 2026-10-06: both created on
  dev by `scripts/create-user.ts` (temporary passwords handed over once, in
  the terminal that ran it); production copies are Islom's, through
  Admin → Users. Code gap 8 closes when `PROD_CHECK_EMAIL` /
  `PROD_CHECK_PASSWORD` carry the production Live Check account.
- ~~Migrations 64 and 65 on production~~ — applied by the owner 2026-10-06;
  production dispatched to `323ad84` on the same day. **Migration 66**
  (`ALLOW_PROD_MIGRATION=66`) is the open production line now; its code is on
  dev and waits on it.

# GAPS

What is known to be wrong or unfinished, in the order it gets worked: money
first, then everything else, in batches of ten. Build queue item 3.

**Source of the sweep rows:** `npm run sweep` against dev, 2026-10-06 —
`SWEEP CLEAN — OK. 57 PAGE(S), 0 PROBLEM(S)`, with the owner's session and with
no session. **The dispatcher role is NOT swept**: no dispatcher account exists
(ruling open, below). A clean sweep of two roles says nothing about the third.

A row leaves this file in the commit that closes it, with the commit named.

## Code — money first

| #   | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Where                                        | Found                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------- |
| 8   | **Production live check runs 11 of 12**: `PAIRED CHECKS SKIPPED (no session)` because `PROD_CHECK_EMAIL` / `PROD_CHECK_PASSWORD` are unset. Needs the Live Check ADMIN account (human step).                                                                                                                                                                                                                                                                                                                                                                               | `scripts/live-check.mjs:146`, `.env`         | UAT, 2026-10-04         |
| 10  | **Pay-to, kind and tags have no editor.** `Driver.payToName` / `payToAddress` are read by the statement and written only by the Datatruck import; `kind` (person / referral payee) and `tags` likewise. The record's Accounting and Others tabs (§6.4 part 2) show them read-only and say so. An editor is a form field plus a `driver.pay` gate for pay-to; kind needs a ruling on who may turn a person into a payee.                                                                                                                                                    | `drivers/[id]/page.tsx`, `drivers/fields.ts` | §6.4 part 2, 2026-10-07 |
| 9   | **zebratms.com — origins by env, measured, not yet done.** `APP_ORIGIN` is a per-worker var (`wrangler.jsonc:144` dev, `:221` production). Readers: `settlements/actions.ts:279` (falls back to the request host), `users/new/page.tsx:62` + `NewUserForm.tsx:148` (falls back to `window.location.origin`), `reset-actions.ts:50`, `reset-email.ts:82`. (`inbound-email.ts` names `loads@zebratms.com`, the MAIL domain, which already lives on zebratms.com — not an origin reader.) The cookie is host-only (AGENTS.md), so the move is the var plus one fresh sign-in. | the five readers                             | build queue item 4      |

## Data — accountant / owner

Not code. Found on the production walk of 2026-10-05 (the owner's findings) and
in the readings taken for it. Nothing here is fixed by a deploy.

| What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Who                 | How                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Duplicate driver rows** — drivers sharing a phone or a truck within one authority. Three pairs share a unit without sharing a phone (3609, 3622, 4588); two "drivers" are not people (`Said truck 3609`, `7 Star`).                                                                                                                                                                                                                                                                                       | Islom merges        | `node scripts/duplicate-drivers.mjs --target=production` — read-only, lists each pair with statement $ per row |
| **Empty charges** — charge rows carrying no amount.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | accountant          | fill or void on `/payroll/charges`                                                                             |
| **Stale compliance dates** on driver and truck records.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | owner / safety      | update on the records; the dashboard's 30/60/90 counts read them                                               |
| **Two unimported weeks** of settlements.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | accountant          | Datatruck import for the two weeks, then `/payroll/batches` shows them                                         |
| **`ST-000018`** stores `deductionsCents` −45000 beside two statements at +45000 (code gap 1). The grid is correct; the stored field is not.                                                                                                                                                                                                                                                                                                                                                                 | nobody, until gap 1 | leave the row; it is the evidence                                                                              |
| **Driver type, where the Datatruck export is silent** (migration 70). The export's `Driver Type` seeded 162 of dev's 167 drivers and found the seed's tariff rule inverted on 56; the 5 it does not know fell back to the old value (all `COMPANY_DRIVER`, all dev test fixtures: Board BDJYMP, Warn DW6BEQ, JULIA ROSE HALL, two Ahmad Settle rows). Production's own list: `node -r dotenv/config scripts/driver-type-gaps.mjs --target=production` — any real driver on it is set by hand on the record. | Islom               | the record's Driver type select, per driver                                                                    |
| **Dev load 1177** is kept as the artefact for ruling 5.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Islom               | delete it once the ruling is made, or say so                                                                   |

## Rulings open

- ~~Rate basis~~ — ruled 2026-10-06: the alternative. The rate field is the line
  haul; the basis is the pay rule's job (§7.6, v10.36). Code shipped; backfill = 68.
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
- ~~Migrations 64 through 68 on production~~ — all applied by the owner on
  2026-10-06, each followed by a production dispatch on its own receipt; both
  workers ended the day at `6021b84`. Production's rate-split list
  (`scripts/rate-split-gaps.mjs --target=production`) came back 0, so 68
  touched every load it was meant to and listed none. No production line is
  open.

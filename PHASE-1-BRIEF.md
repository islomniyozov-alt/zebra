# ZEBRA — PHASE 1 BRIEF

**Reads with:** `prisma/schema.prisma` and `TMS-DESIGN-SYSTEM.md`. Read them before writing anything.

---

## 0. How to use this brief

Work through §5 in order. Do not skip ahead to features. When a step is done, stop and report before starting the next — this phase is deliberately narrow, and the most likely failure is sprawl into modules that belong to Phase 2.

If something in this brief contradicts the schema or the design system, **those two files win** and the contradiction gets flagged, not silently resolved.

---

## 1. What Zebra is

A Transportation Management System replacing a paid TMS for a carrier group of 3–5 operating authorities running 5–10 trucks each. It is a production business application handling real money: invoices, driver settlements, accounts receivable. It is not a prototype.

**The users:** dispatchers booking loads at 6am, an accountant running settlements weekly, an owner watching profitability, and drivers uploading PODs from phones at truck stops.

**Phase 1 ships no features.** It ships the foundation every feature will sit on: the schema, the isolation guarantees, and the component vocabulary. Getting these wrong is expensive later; getting them right is unglamorous now.

---

## 2. Stack — decided, not open

| Layer     | Choice                                                                |
| --------- | --------------------------------------------------------------------- |
| Framework | Next.js (App Router) via OpenNext, deployed to Cloudflare Workers     |
| Database  | Neon Postgres — branch `dev` for development, `production` for live   |
| ORM       | Prisma 7.x with the Neon **WebSocket** driver adapter                 |
| Storage   | Cloudflare R2 — `zebra-docs-dev` / `zebra-docs`                       |
| Styling   | Tailwind v4, CSS-first `@theme` config, tokens from the design system |
| Type/lint | TypeScript strict, ESLint, Prettier                                   |

**Non-negotiable stack notes:**

- **WebSocket adapter, not HTTP.** The HTTP driver cannot run interactive transactions. Settlement generation, invoice creation, and the RLS session variable all require them. If you find yourself reaching for the HTTP driver, stop.
- **Prisma 7 syntax.** `schema.prisma` has no `url` in the datasource block on purpose, and `driverAdapters` is not a preview feature any more. Do not "fix" either back to Prisma 6 form.
- **Password hashing must be WebCrypto-compatible.** Native bcrypt and `@node-rs/argon2` do not run on Workers. Use PBKDF2 via WebCrypto with a high iteration count, or `hash-wasm`'s argon2id. Verify it runs in the Workers runtime, not just in `next dev`.

---

## 3. In scope

1. Repo scaffold, environments, deploy pipeline
2. Full schema migrated to `dev`, with RLS policies and the partial unique indexes
3. Seed data
4. Tenancy mechanism (§6)
5. Auth and role mechanism (§7)
6. Audit mechanism (§8)
7. Document upload infrastructure — the plumbing only, no UI (§9)
8. Atomic number allocation (§10)
9. Design token layer and the core component set (§11)
10. One screen proving it all works: an empty, filterable Loads table inside the real app shell

---

## 4. Explicitly out of scope

Do not build, scaffold, or stub any of these. If a placeholder feels necessary, leave the route absent rather than adding a dead page.

- Load creation, editing, or the dispatch board
- Invoicing, payments, AR, settlements
- Expenses, fuel, maintenance, IFTA
- Reports, charts, calendar
- The driver portal
- Notifications beyond the schema table
- Any integration, including OCR
- Sample or demo data beyond §12's seed

---

## 5. Order of work

**Step 1 — Scaffold.** Next.js + OpenNext + Workers, TypeScript strict, Tailwind v4, ESLint/Prettier. Confirm `.gitignore` contains `.env`. First commit before anything else.

**Step 2 — Database.** Wire the Neon WebSocket adapter. Run the initial migration against `dev`. Add the raw-SQL migration pieces Prisma cannot express: RLS policies (§6) and the partial unique indexes on `AssetAssignment` (see the comment in that model).

**Step 3 — Tenancy.** §6. Nothing else proceeds until the cross-org isolation test passes.

**Step 4 — Auth and roles.** §7.

**Step 5 — Audit.** §8.

**Step 6 — Infrastructure libs.** Documents (§9) and number allocation (§10).

**Step 7 — Design layer.** §11, ending with the Loads table screen.

---

## 6. Mechanism A — tenancy and row-level security

`organizationId` is the tenant boundary. It is enforced in Postgres, not in application code.

**Database roles.** Migrations run as the Neon owner. The application connects as a **separate, non-owner role** — call it `zebra_app`. This matters: table owners bypass RLS by default. Every table with `organizationId` gets both:

```sql
ALTER TABLE "Load" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Load" FORCE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON "Load"
  USING ("organizationId" = current_setting('app.current_org_id', true));
```

**Setting the variable.** `SET LOCAL` is transaction-scoped, which is exactly what's needed — a pooled connection must never carry one request's org into the next. Every request runs inside an interactive transaction:

```ts
export async function withOrg<T>(
  orgId: string,
  fn: (tx: TxClient) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_org_id = '${orgId}'`)
    return fn(tx)
  })
}
```

Validate `orgId` as a cuid before interpolation. It comes from the session, never from a request parameter.

**Child tables.** Thirteen tables have no direct `organizationId` — `LoadStop`, `InvoiceLine`, `PaymentApplication`, `SettlementLine` and similar. They inherit through a required parent FK, which RLS cannot traverse. Two options; pick one and apply it uniformly:

- **(a)** Denormalize `organizationId` onto them with a trigger keeping it consistent with the parent.
- **(b)** Leave them unprotected by RLS and reach them only through a parent that is protected.

**(a) is the recommendation** — it costs a column and a trigger, and it means no future query can accidentally read line items directly.

**Company scoping is separate and lives in the app layer.** A membership with an empty `companyScopes` list sees every authority in the org; a populated list restricts. This is a role check, not a security boundary — its failure mode is seeing your own other carrier's loads.

**Acceptance test — write this before moving on.** Mint a session for org A, query every model, confirm zero rows from org B. Then invert. Then attempt a direct query with a forged `organizationId` in the request body and confirm it returns nothing. This is the same forged-session pattern used on the AR Safety Support portal, and it must pass in both directions.

---

## 7. Mechanism B — auth, roles, permissions

Email and password against the `User` and `Session` tables. Sessions in the database, not JWT — you need server-side revocation.

**Session carries:** `userId`, `organizationId`, `role`, and the resolved company scope list. Resolved at login, refreshed on membership change.

**Roles** are the enum in the schema: `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `ACCOUNTING`, `DRIVER`.

Build a single `can(session, action, resource)` function. Every route and every server action calls it. No route decides its own permissions inline.

Two rules that shape the UI, not just the API:

- **A dispatcher without financial permission never sees an empty "Money" nav group.** Groups render only where the user has at least one visible child.
- **Never send data to the client and hide it with CSS.** If a role cannot see driver pay, it is absent from the payload. On the portal an `"isAdmin":false` boolean leaked into flight data — same class of mistake, avoid it by construction.

---

## 8. Mechanism C — audit log

A Prisma client extension over `$allOperations`, not hand-placed calls. Hand-placed audit ends up around 60% covered, which is the same as none.

- Captures `CREATE`, `UPDATE`, `DELETE`, `RESTORE` on all business models.
- For updates, read the row first and store a `{ field: { from, to } }` diff — changed fields only.
- One `AuditLog` row per write, not one per field.
- Records `userId`, `organizationId`, `ip`, `userAgent`.
- Skips `Session`, `Notification`, and `AuditLog` itself.
- Never fails the parent write. If audit insertion throws, log and continue.

**Acceptance test:** change a load's rate, confirm one audit row containing only the rate field with correct before and after.

---

## 9. Document infrastructure

Plumbing only in this phase — no upload UI.

- **Direct browser-to-R2 via presigned PUT.** The file never passes through the Worker. Build: an authorized route that validates the target entity and returns a presigned URL, and a confirm route that writes the `Document` row.
- Key format: `{organizationId}/{entity}/{entityId}/{uuid}-{filename}`
- **Never a public bucket.** Reads go through a route that authorizes, then mints a short-lived signed GET.
- Set the R2 CORS policy on `zebra-docs-dev` allowing `PUT` from `http://localhost:3000`. Without it, browser uploads fail with an opaque error while terminal uploads work — a confusing hour.
- Prove it with one integration test uploading and reading back a file. No UI.

---

## 10. Number allocation

Load, invoice, and settlement numbers come from the `Counter` table, allocated atomically:

```sql
UPDATE "Counter" SET value = value + 1
  WHERE "companyId" = $1 AND key = $2
  RETURNING value;
```

Never `MAX(id) + 1` — it collides under concurrency. This has already bitten the Telegram bot's invoice numbering; do not rediscover it.

Counters are **per company**, not per organization. Each authority bills under its own series.

Fail closed: if allocation fails, the parent operation fails. Never fall back to a guessed number.

---

## 11. Design layer

`TMS-DESIGN-SYSTEM.md` is the source of truth. Read all fifteen sections before writing CSS.

**Correction to §6.3** — the file is out of date on this point and should be amended in the same commit:

> The topbar company control is a **filter**, not a mode. A user sees every authority they're scoped to at once; the control narrows the view. Tables gain a company column and per-company color chip **only when the org holds more than one company** (`maxCompanies > 1`). Creation forms take the operating authority as their first field, defaulting to last-used. A single-authority organization sees none of this.

**Build in this order:**

1. Token layer — every value from design system §3, §4, §5 into Tailwind v4 `@theme`. No hex outside this block anywhere in the codebase.
2. Self-host IBM Plex Sans, Sans Condensed, and Mono. No CDN.
3. App shell — sidebar with the five nav groups (§6.2), topbar with search, company filter, notification bell, user menu.
4. Core components: `Table`, `StatusBadge`, `KpiCard`, `FilterBar`, `Button`, `Input`, `Select`, `Modal`, `Toast`, `EmptyState`.
5. The Loads screen — real app shell, real table component, real filter bar, empty state. No data, no create action.

**Three details that are easy to get wrong and expensive to retrofit:**

- `font-variant-numeric: tabular-nums` globally on numeric cells. Not optional.
- Logical CSS properties only — `margin-inline-start`, never `margin-left`. Farsi is RTL.
- i18n keys from the first component. EN, RU, FA. Retrofitting cost a full session on the portal.

---

## 12. Seed

One organization, `tier: INTERNAL`, `maxCompanies: 5`.

Two companies with real identifiers — RAM Haulage LLC (USDOT 3162967, MC-112499, SCAC ABFQZ) and Dolphins Transport Inc (USDOT 2544585, MC-885668). Leave the remaining authorities to be added through the UI.

One `OWNER` user with an org-level membership and an empty `companyScopes` list — access to every authority.

One second organization with one company and one user, existing **solely** so the isolation test has something to fail against. Never seeded into production.

Nothing else. No demo loads, no fake brokers, no placeholder trucks.

---

## 13. Acceptance criteria

Phase 1 is done when every one of these passes:

- [ ] `prisma migrate dev` runs clean against the `dev` branch from an empty database
- [ ] RLS is enabled **and forced** on every table carrying `organizationId`
- [ ] The app connects as a non-owner role
- [ ] Cross-org isolation test passes in both directions, including a forged `organizationId`
- [ ] A forged session for org B returns zero rows from org A on every model
- [ ] Login, logout, and session revocation work
- [ ] `can()` gates every route; a `DISPATCHER` cannot reach a financial route by URL
- [ ] Updating a record writes exactly one audit row with a correct field-level diff
- [ ] A file uploads direct to R2 via presigned URL and reads back through a signed GET
- [ ] Counter allocation survives 100 concurrent calls with no duplicates
- [ ] The Loads screen renders in the real shell with a working empty state
- [ ] At Standard density, 20 table rows are visible at 1080p without scrolling
- [ ] Every screen renders correctly in `dir="rtl"`
- [ ] Every screen renders correctly in Russian without truncation or overflow
- [ ] No hex color appears outside the token block
- [ ] Keyboard focus is visible on every interactive element
- [ ] TypeScript strict passes with no `any` in application code

---

## 14. Standing rules

1. **"Deployed" means the live Cloudflare version ID advanced and a live check passed.** Never `git push` success alone. A Workers Build stall has already been caught this way once.
2. `wrangler dev` bakes `.env` into the OpenNext build. Local runs use whatever `.env` holds — which is why `NEON_BRANCH` must be `dev` and why `prisma.config.ts` fails closed if it isn't.
3. Never regress to a singleton Prisma client. Workers I/O constraints require per-request instantiation via React `cache()` plus a Proxy.
4. Grep before deleting any token or constant.
5. Every surface declares its own background. No inheriting from `body`.
6. No inner scroll container in the app shell except designated table bodies.
7. Amend the design system in its own commit, with the reason, before changing code to match.

---

## 15. Definition of done

Report back with:

- The migration file, including the raw SQL for RLS and the partial unique indexes
- Test output for the isolation, audit, and counter-concurrency tests
- A screenshot of the Loads screen at 1080p, Standard density
- The same screen in RTL and in Russian
- Anything in the schema or design system you think is wrong — flagged, not silently changed

Then stop. Phase 2 is loads and dispatch, and it starts as a separate conversation.

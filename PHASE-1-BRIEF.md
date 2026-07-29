# ZEBRA — PHASE 1 BRIEF

**Version 2** — amended 2026-07-29 to match what was actually built.
**Reads with:** `prisma/schema.prisma` and `TMS-DESIGN-SYSTEM.md`. Read both before writing anything.

> **v1 → v2.** Twelve corrections, listed in §16. Where v1 and the repo disagree, **the repo is right** — Steps 1–5 shipped and their decisions are recorded here. If this file disagrees with the schema or the design system, those two win and the contradiction gets flagged, not silently resolved.

---

## 0. How to use this brief

Work §5 in order. One step per session; stop and report before the next. This phase is deliberately narrow and the likeliest failure is sprawl into Phase 2 modules.

---

## 1. What Zebra is

A Transportation Management System replacing a paid TMS for a carrier group of 3–5 operating authorities running 5–10 trucks each. Production software handling real money — invoices, driver settlements, accounts receivable. Not a prototype.

**Users:** dispatchers booking loads at 6am, an accountant running settlements weekly, an owner watching profitability, drivers uploading PODs from phones at truck stops.

**Phase 1 ships no features.** It ships the foundation: schema, isolation guarantees, component vocabulary.

---

## 2. Stack — decided

| Layer     | Choice                                                                     |
| --------- | -------------------------------------------------------------------------- |
| Framework | Next.js 16 App Router via OpenNext → Cloudflare Workers                    |
| Database  | Neon Postgres — `dev` branch for development, `production` for live        |
| ORM       | Prisma 7.x, Neon **WebSocket** driver adapter                              |
| Storage   | Cloudflare R2 — `zebra-docs-dev` / `zebra-docs`                            |
| Styling   | Tailwind v4, CSS-first `@theme`                                            |
| Tests     | Vitest 4.x, plus `@cloudflare/vitest-pool-workers` for the workerd runtime |

**Non-negotiables:**

- **WebSocket adapter, not HTTP.** The HTTP driver can't run interactive transactions, and every request needs one for the RLS session variable.
- **Prisma 7 config takes `datasource: { url }`, not `adapter`.** _(v1 said otherwise and was wrong — `adapter` doesn't exist in `@prisma/config` 7.9.x. Driver adapters are runtime-only, on the `PrismaClient` constructor.)_
- **`"type": "module"` in package.json.** Required by the Workers vitest pool. _(v1's `main()`-wrapper ruling is superseded.)_
- **Password hashing must be WebCrypto-compatible.** Native bcrypt and `@node-rs/argon2` don't run on workerd.

---

## 3. In scope

1. Repo scaffold, environments, deploy pipeline — **done, `4d43f73`**
2. Schema migrated to `dev`, RLS policies, partial unique indexes — **done, `3e43794`**
3. Tenancy mechanism (§6) — **done, `979f65a`**
4. Auth, roles, seed (§7) — **done, `13ca8bf`**
5. Audit mechanism (§8) — **done, `63ede81`**, hardened `e96365a`
6. Document upload infrastructure (§9) and number allocation (§10) — **in progress**
7. Design token layer, core components, login screen, one Loads screen (§11) — **remaining**

---

## 4. Explicitly out of scope

Do not build, scaffold, or stub. If a placeholder feels necessary, leave the route absent.

- Load creation/editing, dispatch board
- Invoicing, payments, AR, settlements
- Expenses, fuel, maintenance, IFTA
- Reports, charts, calendar
- Driver portal
- Notifications beyond the schema table
- Any integration, including OCR
- Sample data beyond §12

---

## 5. Order of work

| Step | Work                                                            | Status                |
| ---- | --------------------------------------------------------------- | --------------------- |
| 1    | Scaffold, TS strict, lint, two never-implicit environments      | `4d43f73`             |
| 2    | Migrations, RLS, triggers, partial indexes, `zebra_app` role    | `3e43794`             |
| 3    | `withOrg`/`runInOrg`, isolation suite, promoted structure audit | `979f65a`             |
| 4    | Auth, sessions, `can()`, rate limiting, rotation, **seed**      | `13ca8bf`             |
| 5    | Audit extension, health counters, guardrails                    | `63ede81` · `e96365a` |
| 6    | Documents (§9), number allocation (§10)                         | in progress           |
| 7    | Design layer, login screen, Loads screen, password reset (§11)  | remaining             |

---

## 6. Mechanism A — tenancy _(built)_

`organizationId` is the tenant boundary, enforced in Postgres.

**Roles.** Migrations run as the Neon owner. The app connects as **`zebra_app`** — non-owner, no `BYPASSRLS`, no DDL, `NOLOGIN` in git with login granted out of band per branch.

> **The Neon owner carries `BYPASSRLS`** (member of `neon_superuser`). Any isolation test pointed at `DIRECT_DATABASE_URL` passes vacuously. Tests connect via `DATABASE_URL`; `src/lib/db.ts` throws at startup if that isn't `zebra_app`.

Every tenant table is both `ENABLE` and `FORCE ROW LEVEL SECURITY`, one policy shape, `FOR ALL` with no `WITH CHECK` so `USING` governs reads and writes alike.

**Two session variables, both set by `set_config(..., $1, true)` with a bind parameter** — not `$executeRawUnsafe` with an interpolated id, as v1 showed:

- `app.current_org_id` — which tenant the caller is acting as.
- `app.current_user_id` — who is asking. Exists because `Membership` sits behind RLS but login must read it to discover the org. A `FOR SELECT`-only policy on `Membership` reads this variable. **`FOR SELECT` is load-bearing:** a permissive policy without a command restriction supplies its `USING` clause as the write check, which would let a caller write a membership into any organization they named.

This was chosen over a `SECURITY DEFINER` function precisely to keep a deliberate RLS bypass off the most-attacked path in the application.

**Child tables: eleven, not thirteen.** They carry a denormalized `organizationId` stamped by `BEFORE INSERT OR UPDATE` triggers — `SECURITY DEFINER` with pinned `search_path`, scoped `UPDATE OF <parent link>, "organizationId"`. Tables with two parents refuse the write if the parents disagree.

> **`User` and `Session` are outside RLS deliberately.** One person holds memberships in several organizations, and login must find a user by email before any organization is known. A policy on either makes authentication impossible.

**Attribution is required at the type level.** `withOrg`/`runInOrg` don't compile without it:

```ts
withOrg(orgId, fn, { attribution: { userId, ip, userAgent } })
withOrg(orgId, fn, { attribution: unattributed('nightly reconciliation') })
```

`withCurrentOrg` is the route-facing entry — it resolves tenant, permission and acting user together. `withOrg`, `runInOrg`, `runAsUser`, `prisma` and `createPrismaClient` are ESLint-banned under `src/app/**`, because reaching past the front door skips the `can()` check as well as attribution.

**Known ceiling:** Prisma aborts interactive transactions at 5 s. `withOrg`/`runInOrg` take an optional timeout, but for long work the right shape is short read → compute in memory → short write, not a larger timeout — the timeout holds a pooled connection open under exactly the load where that hurts.

---

## 7. Mechanism B — auth _(built)_

Database sessions, not JWTs. Cookie holds 256 bits; the database stores only its SHA-256 (`Session.tokenHash`).

`Session` carries `activeOrganizationId`, `role`, `companyScopes`, `permissionOverrides`, `revokedAt`, `lastSeenAt`.

> **`activeOrganizationId` is deliberately not named `organizationId`.** Every column with that name is subject to RLS; this one is the _input_ to it. A test asserts the name stays.

`can(session, action, resource)` is the only place permission is decided, with `navigationFor` derived from it. `load.financials` and `driver.pay` are separate resources — a dispatcher books freight all day and never learns the margin.

Rate limiting 5 failures per email, 30 per address, rolling 15 minutes; a locked account refuses the correct password too. Session rotation on success. A missing user costs the same as a wrong password.

**Never send data to the client and hide it with CSS.** If a role can't see driver pay, it's absent from the payload — an `"isAdmin":false` boolean once leaked into flight data on the AR Safety Support portal.

---

## 8. Mechanism C — audit _(built)_

A Prisma client extension over `$allOperations`, not hand-placed calls.

Audit rows are written **inside the caller's transaction, behind a `SAVEPOINT`.** Inside, because `AuditLog` is behind RLS and a rolled-back write must not leave a row claiming it happened. Behind a savepoint, because a failed statement poisons a Postgres transaction — without one, "audit failed" silently becomes "the load was never saved."

**v1 said "log and continue." That was wrong as written** — a silently-swallowed audit failure is the `.catch(() => {})` pattern that hid the trigger defect in Step 3. Corrected: continue, but never quietly. Every failure increments a counter, logs under the fixed tag `[zebra.audit.failure]`, and reaches any sink registered via `onAuditEvent`.

`gaps.unattributed` (declared, should be zero in app code) is counted separately from `gaps.noContext` (structural — the seed, login touching `User`), so coverage facts can't drown a real failure.

> **Owed before production:** `getAuditHealth()` counts in isolate memory, and Workers isolates are ephemeral and plural. The durable signal today is the log line. `onAuditEvent` is the seam — wire it to Analytics Engine or Sentry before go-live.

> **This is a change log, not a security event log.** Rolled-back and denied attempts leave no trace, which is correct for §25's purpose and wrong for security auditing. `LoginAttempt` is the beginning of the second stream. Do not merge them.

---

## 9. Documents — Step 6

Plumbing only. No UI.

- **Direct browser-to-R2 via presigned PUT.** The file never passes through the Worker.
- Key format: `{organizationId}/{entity}/{entityId}/{uuid}-{filename}` — the tenant boundary is the prefix, so a bucket-level policy stays expressible. _(v1 and the schema comment disagreed; the schema comment has been corrected to match.)_
- **Authorize at mint time.** The URL is the capability once issued — verify the target entity's org before the URL exists, and keep the TTL short.
- **Constrain the PUT** to a content-length range and content type, or it's a write-anything ticket.
- **Never a public bucket.** Reads go through a route that authorizes, then mints a short-lived signed GET.
- **Phantom rows:** tolerate orphan R2 objects; never a `Document` row pointing at nothing. A row is a claim the app makes to a user; an object is garbage only R2 knows about. Confirm does a `HEAD` before writing the row.
- Record the mint so reconciliation is an indexed query rather than a bucket listing. A `PendingUpload` row (key, target, expiry, user) is preferred over a `PENDING`-status `Document`, which depends on every read path remembering to filter.
- Set R2 CORS on `zebra-docs-dev` allowing `PUT` from `http://localhost:3000`. Without it browser uploads fail opaquely while terminal uploads work.
- **This is where `src/lib/db.ts` first runs on workerd.** Verify whether Route Handlers establish a React request scope; `cache()` does not memoize outside one. If they don't, hold the per-request client in `AsyncLocalStorage` rather than relying on every request touching `prisma` exactly once — that invariant is true today and will quietly stop being true.

---

## 10. Number allocation — Step 6

```sql
UPDATE "Counter" SET value = value + 1
  WHERE "companyId" = $1 AND key = $2
  RETURNING value;
```

Never `MAX(id) + 1`. This already bit the Telegram bot's invoice numbering.

Counters are **per company** — each authority bills under its own series. Fail closed: if allocation fails, the parent operation fails. Never guess a number.

---

## 11. Design layer — Step 7

`TMS-DESIGN-SYSTEM.md` is the source of truth. Read all fifteen sections first.

**Correction to design-system §6.3** — amend the file in the same commit:

> The topbar company control is a **filter**, not a mode. A user sees every authority they're scoped to at once; the control narrows the view. Tables gain a company column and per-company color chip **only when the org holds more than one company** (`maxCompanies > 1`). Creation forms take the operating authority as their first field, defaulting to last-used. A single-authority organization sees none of this.

**Build in order:**

1. Token layer — every value from design-system §3, §4, §5 into Tailwind v4 `@theme`. No hex outside this block anywhere.
2. Self-host IBM Plex Sans, Sans Condensed, Mono. No CDN.
3. App shell — sidebar with the five nav groups, topbar with search, company filter, bell, user menu.
4. Core components: `Table`, `StatusBadge`, `KpiCard`, `FilterBar`, `Button`, `Input`, `Select`, `Modal`, `Toast`, `EmptyState`.
5. **Login screen** — the auth mechanism has been complete and tested since Step 4 with no UI in front of it.
6. **Password reset** — token table, expiry, single-use, same rate limiting as login. _(Unowned in v1. It surfaces the day a real user forgets a password.)_
7. The Loads screen — real shell, real table, real filter bar, empty state. No data, no create action.

**Three details that are expensive to retrofit:**

- `font-variant-numeric: tabular-nums` globally on numeric cells.
- Logical CSS properties only — `margin-inline-start`, never `margin-left`. Farsi is RTL.
- i18n keys from the first component. EN, RU, FA.

---

## 12. Seed _(built in Step 4)_

One organization, `tier: INTERNAL`, `maxCompanies: 5`. Two companies with real identifiers — RAM Haulage LLC (USDOT 3162967, MC-112499, SCAC ABFQZ) and Dolphins Transport Inc (USDOT 2544585, MC-885668). One `OWNER` user with an empty `companyScopes` list. `CompanySettings` at schema defaults — configuration, not sample data.

> **v1's second organization is superseded.** The isolation suite builds and destroys its own fixtures, which is better than leaving a second tenant sitting in dev.

Owner password comes from `SEED_OWNER_PASSWORD`. Never print a generated one.

---

## 13. Acceptance criteria

Steps 1–5 — passing:

- [x] Migration runs clean from an empty database
- [x] RLS enabled **and forced** on all 38 tenant tables
- [x] App connects as a non-owner role
- [x] Cross-org isolation passes both directions, including forged `organizationId`
- [x] Unset session variable yields nothing
- [x] No leak between transactions on a reused pooled connection
- [x] Login, logout, revocation, refresh-on-membership-change
- [x] Updating a record writes exactly one audit row with a correct field-level diff
- [x] Audit failure is loud and countable, verified by revoking `INSERT`
- [x] Guardrail lint fires, and a test watches it fire

Steps 6–7 — remaining:

- [ ] A file uploads direct to R2 via presigned URL and reads back through a signed GET
- [ ] An oversized or wrong-typed PUT is refused by the URL's own constraints
- [ ] Counter allocation survives 100 concurrent calls with no duplicates
- [ ] `src/lib/db.ts` verified under workerd in a real route
- [ ] A `DISPATCHER` cannot reach a financial route by URL _(deferred from v1 — untestable until routes exist)_
- [ ] Loads screen renders in the real shell with a working empty state
- [ ] 20 rows visible at 1080p, Standard density
- [ ] Every screen correct in `dir="rtl"`
- [ ] Every screen correct in Russian without overflow
- [ ] No hex outside the token block
- [ ] Keyboard focus visible on every interactive element
- [ ] TypeScript strict, no `any` in application code

---

## 14. Standing rules

1. **"Deployed" means the live Cloudflare version ID advanced and a live check passed.** Never a green push.
2. `wrangler dev` bakes `.env` into the OpenNext build — which is why `NEON_BRANCH` must be `dev` and `prisma.config.ts` fails closed if it isn't.
3. Never regress to a singleton Prisma client.
4. Grep before deleting any token or constant.
5. Every surface declares its own background.
6. No inner scroll container in the app shell except designated table bodies.
7. Amend the design system in its own commit, with the reason, before changing code to match.
8. **A guardrail nobody has watched fail might be misconfigured.** Test that it fires.

---

## 15. Definition of done, per step

Report with: the migration or diff, test output, anything visual as a screenshot, and anything in the schema or design system you think is wrong — flagged, not silently changed. Then stop.

---

## 16. Amendments, v1 → v2

1. §2 — Prisma config takes `datasource`, not `adapter`. v1 was wrong.
2. §2 — `"type": "module"` required by the Workers vitest pool; supersedes the `main()`-wrapper ruling.
3. §6 — `set_config` with a bind parameter replaces `$executeRawUnsafe` with an interpolated id.
4. §6 — second session variable `app.current_user_id` added, with the `FOR SELECT` reasoning.
5. §6 — eleven child tables, not thirteen. `User` and `Session` are outside RLS deliberately.
6. §6 — attribution required at the type level; ESLint ban under `src/app/**`.
7. §6 — the 5 s transaction ceiling and the right shape for long work.
8. §8 — "log and continue" corrected to loud and countable; gap taxonomy split.
9. §8 — audit health is isolate-local; sink owed before production. Change log ≠ security log.
10. §9 — key prefix is `organizationId`; phantom-row ruling and `PendingUpload` recorded.
11. §11/§12 — seed moved to Step 4 and built; v1's second organization superseded by self-building fixtures.
12. §11/§13 — login screen and password reset assigned to Step 7; the `DISPATCHER`-by-URL criterion deferred there rather than dropped.

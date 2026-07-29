# Zebra

Transportation Management System for a multi-authority carrier group.

Read these three, in this order, before changing anything:

1. [`PHASE-1-BRIEF.md`](PHASE-1-BRIEF.md) — what is in scope right now, and what is not
2. [`prisma/schema.prisma`](prisma/schema.prisma) — the data model and its conventions
3. [`TMS-DESIGN-SYSTEM.md`](TMS-DESIGN-SYSTEM.md) — the interface, and the source of truth for it

Where the brief disagrees with the schema or the design system, the schema and the
design system win and the contradiction gets flagged.

## Stack

| Layer     | Choice                                                              |
| --------- | ------------------------------------------------------------------- |
| Framework | Next.js 16 (App Router) via OpenNext, on Cloudflare Workers         |
| Database  | Neon Postgres — branch `dev` for development, `production` for live |
| ORM       | Prisma 7 with the Neon **WebSocket** driver adapter                 |
| Storage   | Cloudflare R2 — `zebra-docs-dev` / `zebra-docs`                     |
| Styling   | Tailwind v4, CSS-first `@theme`                                     |
| Type/lint | TypeScript strict, ESLint, Prettier                                 |

The HTTP driver is not an option: it cannot run interactive transactions, and the
row-level-security session variable, settlement generation and invoicing all need
them.

## Environments

Two, and they are never selected implicitly.

|            | Worker      | Neon branch  | R2 bucket        |
| ---------- | ----------- | ------------ | ---------------- |
| dev        | `zebra-dev` | `dev`        | `zebra-docs-dev` |
| production | `zebra`     | `production` | `zebra-docs`     |

`NEON_BRANCH` is declared explicitly in `.env` and in `wrangler.jsonc`. A Neon
connection string names an endpoint, not a branch, so the target cannot be
inferred from the URL — `prisma.config.ts` refuses to guess and fails closed.

## Setup

`.env` comes first: `npm install` runs `prisma generate`, and `prisma.config.ts`
refuses to run without a declared branch.

```bash
cp .env.example .env      # then fill in real values; .env is gitignored
npm install
npm run db:migrate
npm run dev
```

## Database

Two roles, and the difference is the tenancy boundary rather than a
convention.

| Role           | Used by           | Notes                                         |
| -------------- | ----------------- | --------------------------------------------- |
| the Neon owner | migrations, seeds | carries `BYPASSRLS` — sees every organization |
| `zebra_app`    | the application   | owns nothing, no DDL, no `BYPASSRLS`          |

Every table carrying an `organizationId` — 38 of them — has row-level security
**enabled and forced**, with one policy shape:

```sql
USING ("organizationId" = current_setting('app.current_org_id', true))
```

Unset means invisible. A request that forgets to set the variable sees an empty
screen, never someone else's data.

Because the owner bypasses all of it, **an isolation test pointed at
`DIRECT_DATABASE_URL` passes vacuously.** Tests must use `DATABASE_URL`.

The migration creates `zebra_app` with `NOLOGIN` and no password, so no
credential is ever committed. Grant it login once per Neon branch:

```sql
ALTER ROLE zebra_app WITH LOGIN PASSWORD '<generated>';
```

`prisma/migrations/*_rls_and_isolation/migration.sql` is the whole story —
policies, the eleven child-table triggers, the `AssetAssignment` partial unique
indexes, and a self-audit that fails the migration if a future table carries a
tenant without a policy.

Application code never sets that variable by hand. It calls `withOrg` from
[`src/lib/tenancy.ts`](src/lib/tenancy.ts), which validates the id, opens one
interactive transaction and sets `app.current_org_id` for its duration. The id
comes from the session and from nowhere else.

Two session variables, and the difference matters:

| Variable              | Set by                 | Unlocks                                   |
| --------------------- | ---------------------- | ----------------------------------------- |
| `app.current_org_id`  | `withOrg` / `runInOrg` | everything a tenant owns                  |
| `app.current_user_id` | `runAsUser`            | a user's own `Membership` rows, read-only |

The second exists because login has to discover _which_ organization to scope
to, and `Membership` is itself behind RLS. The alternative was a
`SECURITY DEFINER` bypass on the login path — the most attacked path in the
application — so it is a second policy instead. `FOR SELECT` only: asserting a
user id reads memberships and can never write one.

## Auth

Email and password against `User` and `Session`. Sessions are rows, not JWTs,
because revocation has to be immediate.

- **Hashing is PBKDF2 over WebCrypto**, 600,000 iterations, OWASP's current
  floor. Native bcrypt and `@node-rs/argon2` do not exist on workerd, and both
  work fine in `next dev` — which is how that gets discovered at deploy time.
  Measured at ~0.7 s of CPU inside workerd; `tests/workers/` proves it there,
  not in Node.
- **The cookie holds the token; the database holds its SHA-256.** A dump of
  `Session` is a list of useless digests.
- **Rate limited** per email (5 per 15 min) and per address (30 per 15 min),
  the second higher because an office shares an address. A locked account
  refuses the _correct_ password too, or the limit is decoration.
- **Rotation on login**: whatever session the request arrived with is revoked
  and a fresh token issued, so a token planted before authentication is
  worthless after it. Other devices are left alone.
- **A missing user costs the same as a wrong password** — the failure path
  still runs a full verify against a throwaway hash, so response time is not a
  list of which addresses hold accounts.

`can(session, action, resource)` in [`src/lib/permissions.ts`](src/lib/permissions.ts)
is the only place permission is decided. Routes call `requirePermission` from
[`src/lib/auth-context.ts`](src/lib/auth-context.ts); no route decides for
itself. Navigation comes from the same function, so a dispatcher with no
financial permission never sees an empty **Money** heading — the group is
absent, not hidden.

## Audit

A Prisma client extension over `$allOperations`, attached inside
`createPrismaClient` — so there is no such thing as a client that writes
without being audited. Hand-placed audit calls end up around 60% covered, and
60% is worse than none: it looks like a record, so nobody checks.

Each write gets **one row, not one per field**, holding a
`{ field: { from, to } }` diff of the fields that actually moved. `updatedAt`
is excluded or it would be in every diff, burying the field that mattered. A
soft delete is recorded as `DELETE` and clearing `deletedAt` as `RESTORE`,
because §6 makes `deletedAt` the mechanism.

The row is written **inside the caller's own transaction, behind a
`SAVEPOINT`**. Both halves matter: inside, because `AuditLog` is behind RLS
like everything else and a second connection would have no
`app.current_org_id` — and because a rolled-back write must not leave an audit
row claiming it happened. Behind a savepoint, because a failed statement
poisons a Postgres transaction, so without one "audit failed" would silently
become "the load was never saved".

**Failures are loud and countable, never swallowed.** §8 says log and continue;
continuing is not the same as hiding. Every failure increments a counter,
records its details, logs under the fixed tag `[zebra.audit.failure]`, and is
handed to any sink registered with `onAuditEvent`.

```ts
getAuditHealth()
// { written, failures, lastFailure, gaps: { noContext, unfollowableOperation } }
```

`failures` is expected to be zero forever, which is what makes it worth
alerting on. **Gaps are counted separately** so they can never drown a real
failure: `noContext` is a write that ran outside any audit context (the login
path touching `User`, a seed), and `unfollowableOperation` is `createMany`,
which returns no ids to point an audit row at — use `createManyAndReturn`
where the trail matters.

Routes should call `withCurrentOrg` from
[`src/lib/auth-context.ts`](src/lib/auth-context.ts) rather than `withOrg`: it
resolves the tenant, the permission check and the acting user together, so
writes inside it are attributed instead of counted as gaps.

## Seed

`npm run db:seed` — §12 exactly, and idempotent.

One organization (`INTERNAL`, five authorities) holding RAM Haulage LLC and
Dolphins Transport Inc, plus one `OWNER` whose empty scope list means every
authority. No demo loads, no fake brokers, no placeholder trucks.

The owner's password comes from `SEED_OWNER_PASSWORD`, or is generated and
printed once if that is unset. There is deliberately no default password.

A second organization exists solely so a tenancy failure has something to
expose. It is skipped when `NEON_BRANCH=production`.

## Tests

Three projects, split by what they need and what they touch.

| Command              | Runs                                         | Writes              |
| -------------------- | -------------------------------------------- | ------------------- |
| `npm run test:check` | `node` + `workers` — part of `npm run check` | no                  |
| `npm test`           | all three, adding isolation and auth         | yes, then cleans up |

The **workers** project runs inside workerd rather than Node. A green Node
suite says nothing about the deployed runtime, which is the whole reason
password hashing is tested there.

`tests/structure.test.ts` is the migration's own self-audit, promoted out of
the migration and into `check`. In the migration it fires once, on the day it
is applied; here it fires on every check, so a later migration that adds a
tenant table without a policy fails the build instead of waiting to be noticed.

`tests/integration/isolation.test.ts` is the §6 acceptance test. It populates
**both** organizations in **every** table that carries a tenant — a table left
empty would pass "sees nothing from the other organization" for the boring
reason, so a coverage assertion fails if the fixture misses one — then asserts
isolation in both directions as `zebra_app`.

Everything needs `.env`. Nothing runs against `NEON_BRANCH=production`.

## Scripts

| Command                           | Does                                                    |
| --------------------------------- | ------------------------------------------------------- |
| `npm run dev`                     | Next dev server on http://localhost:3000                |
| `npm run check`                   | typecheck + lint + format + the non-writing tests       |
| `npm test` / `test:watch`         | every test, isolation suite included                    |
| `npm run typecheck`               | `tsc --noEmit`                                          |
| `npm run lint` / `lint:fix`       | ESLint                                                  |
| `npm run format` / `format:check` | Prettier                                                |
| `npm run db:migrate`              | `prisma migrate dev` against the declared branch        |
| `npm run db:seed`                 | §12's seed — idempotent                                 |
| `npm run db:deploy`               | `prisma migrate deploy` — no shadow database            |
| `npm run db:generate`             | regenerate the client into `src/generated/prisma`       |
| `npm run cf:typegen`              | regenerate `cloudflare-env.d.ts` from `wrangler.jsonc`  |
| `npm run preview`                 | OpenNext build, then run it in the real Workers runtime |
| `npm run deploy`                  | build and deploy to `zebra-dev`                         |
| `npm run deploy:prod`             | build and deploy to `zebra`                             |

`npm run preview` is not optional before deploying. `next dev` runs on Node; the
deployed app runs on workerd. Things that work in one and not the other —
password hashing above all — only surface under `preview`.

**"Deployed" means the live Cloudflare version ID advanced and a live check
passed.** A green push is not a deploy.

## Secrets

Nothing secret belongs in `wrangler.jsonc`. `vars` there holds `NEON_BRANCH` and
`R2_BUCKET` only. Connection strings, R2 keys and `AUTH_SECRET` go in via
`wrangler secret put` per environment, and in `.env` locally.

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

## Scripts

| Command                           | Does                                                    |
| --------------------------------- | ------------------------------------------------------- |
| `npm run dev`                     | Next dev server on http://localhost:3000                |
| `npm run check`                   | typecheck + lint + format check                         |
| `npm run typecheck`               | `tsc --noEmit`                                          |
| `npm run lint` / `lint:fix`       | ESLint                                                  |
| `npm run format` / `format:check` | Prettier                                                |
| `npm run db:migrate`              | `prisma migrate dev` against the declared branch        |
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

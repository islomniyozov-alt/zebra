# Zebra

Transportation Management System for a multi-authority carrier group.

Read these three, in this order, before changing anything:

1. [`PHASE-2-BRIEF.md`](PHASE-2-BRIEF.md) — what is in scope right now, and what is not
   ([`PHASE-1-BRIEF.md`](PHASE-1-BRIEF.md) is closed; its §6–§10 mechanisms still bind)
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

## Production bring-up

The parallel run puts real freight, real CDL numbers and real rates in
production, and none of that belongs on the `dev` branch that agents and tests
write to. This is the order to bring production up in. **Steps marked
(account)** cannot be done from this repository — they need the Cloudflare,
Neon or Resend dashboard, or DNS.

Each step assumes the ones above it.

1. **(account) Two new R2 tokens.** Cloudflare → R2 → Manage R2 API Tokens.
   One scoped to `zebra-docs-dev`, one to `zebra-docs`, both **Object Read &
   Write** — the worker never needs more. Put the dev pair in `.env` and on the
   dev worker now; hold the production pair for step 4. **Delete the old token
   last**: a presigned URL already in flight is signed with it.

2. **(account) `zebra_app` on the production branch.** The migration creates
   policies and grants, not the login role — the role must exist first, exactly
   as it does on dev:

   ```sql
   -- as neondb_owner, on the production branch
   CREATE ROLE zebra_app WITH LOGIN PASSWORD '<new>';
   GRANT USAGE ON SCHEMA public TO zebra_app;
   ```

   Nothing else. No table grants here — every migration grants its own tables,
   and a blanket `GRANT ALL` would hand `zebra_app` the DDL it must not have.

3. **Migrate production, from empty.**

   ```bash
   NEON_BRANCH=production NODE_ENV=production ALLOW_PROD_MIGRATION=1 \
     DIRECT_DATABASE_URL='<production DIRECT url>' npx prisma migrate deploy
   ```

   `ALLOW_PROD_MIGRATION` goes on that command and never in `.env`;
   `prisma.config.ts` refuses all three ways of getting this wrong (no branch
   declared, branch and `NODE_ENV` disagreeing, pooled URL). Proof it worked is
   `prisma migrate status` reporting 12 applied and the migrations' own `DO`
   blocks not raising — they assert RLS is enabled, forced and policied.

4. **Production worker secrets.** `--env production` on every one of them; a
   forgotten flag writes the dev worker's secret instead and nothing says so.

   ```bash
   printf '%s\n' "<url>"     | npx wrangler secret put DATABASE_URL        --env production
   printf '%s\n' "<secret>"  | npx wrangler secret put AUTH_SECRET         --env production
   printf '%s\n' "<id>"      | npx wrangler secret put R2_ACCOUNT_ID       --env production
   printf '%s\n' "<key id>"  | npx wrangler secret put R2_ACCESS_KEY_ID    --env production
   printf '%s\n' "<secret>"  | npx wrangler secret put R2_SECRET_ACCESS_KEY --env production
   printf '%s\n' "<url>"     | npx wrangler secret put R2_ENDPOINT         --env production
   printf '%s\n' "<key>"     | npx wrangler secret put RESEND_API_KEY      --env production
   printf '%s
   ' "<key>"     | npx wrangler secret put ANTHROPIC_API_KEY   --env production
   ```

   `ANTHROPIC_API_KEY` arrived with Phase 5. Without it the extraction service
   throws `no_api_key` by name rather than returning empty extractions that
   look like documents nothing could be read from — the same discipline as
   `RESEND_API_KEY`, and for the same reason. The dev worker needs it too, with
   the flag omitted:

   ```bash
   printf '%s
   ' "<key>" | npx wrangler secret put ANTHROPIC_API_KEY
   ```

   `GEMINI_API_KEY` is **experiment-only** and is needed on the DEV worker
   alone. It exists so the corpus table can be run against Gemini beside
   Anthropic; nothing in the shipped path asks for it, and without it a Gemini
   model answers `no_api_key` by name exactly as Anthropic's does. Production
   does not need it unless the owner rules for Gemini.

   ```bash
   printf '%s
   ' "<key>" | npx wrangler secret put GEMINI_API_KEY
   ```

   `DATABASE_URL` is `zebra_app` at the **pooled** production endpoint.
   `sslmode=require&channel_binding=require` is what Neon hands you and it is
   what dev has run on since Phase 1 — an earlier draft of this runbook said to
   strip `channel_binding`, which was wrong, and is corrected here rather than
   left to become folklore. `AUTH_SECRET` is **fresh**: sharing dev's would
   make a dev session cookie valid against production. `R2_BUCKET` and `NEON_BRANCH` are not secrets and are already in
   `wrangler.jsonc`.

   **Prove the string before you store it.** A wrong `DATABASE_URL` does not
   fail at deploy — it fails on the first request that touches the database,
   as a 500 with the message on the server and nothing in the browser. Both
   ways it can be wrong were hit on this bring-up, in this order:

   ```
   TypeError: Invalid URL string          the value is not a URL at all
   Authentication failed ... not valid    it is a URL, the password is wrong
   ```

   Each cost a deploy-and-probe cycle to identify. Two seconds beforehand says
   which:

   ```bash
   ZEBRA_TEST_URL='postgresql://...' node -r dotenv/config scripts/check-connection.mjs
   ```

   It reports the role, host, database and whether row-level security holds on
   that connection, and never prints the password. An application URL that
   reports `sees N Company rows with no org set` for N > 0 is a tenancy
   failure, not a working connection.

   Both shell traps from _Rotating them_ below apply to every line here.

5. **Prove the R2 pair, then set it.** Same discipline as the connection
   string, and for a sharper reason: a wrong R2 key does not fail until
   somebody uploads a document, and then it fails in the BROWSER as
   `net::ERR_FAILED`, which reads like a CORS problem. The worker's log stays
   clean. R2's real answer is only visible outside the browser.

   ```bash
   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=zebra-docs      R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com      node scripts/check-r2.mjs
   ```

   It checks the shape (32 and 64 hex characters), then writes a probe object
   and deletes it. A 403 on the PUT means the token is scoped to a different
   bucket — which is the mistake that caused these keys to be re-issued in the
   first place.

6. **(account) CORS on `zebra-docs`.** With a temporary **Admin Read & Write**
   token, deleted straight afterwards:

   ```bash
   R2_ACCESS_KEY_ID=<admin> R2_SECRET_ACCESS_KEY=<admin> \
     node -r dotenv/config scripts/r2-cors.mjs --apply \
     --bucket zebra-docs --origin https://<production origin>
   ```

   The app's own token gets `403 AccessDenied` on this call, which is correct —
   bucket configuration is not the worker's business. Without the rule, browser
   uploads fail with nothing useful in any log while terminal uploads work.

   **On Windows, type the values — do not route them through the clipboard.**
   Four secrets on this project have been set to the wrong thing, and every one
   of them came from a `Get-Clipboard` line that was stored or pasted instead
   of run. `Read-Host -AsSecureString` keeps the value out of shell history,
   out of `.env`, and out of any file:

   ```powershell
   $id  = Read-Host 'Admin access key id'
   $sec = Read-Host 'Admin secret access key' -AsSecureString
   $env:R2_ACCESS_KEY_ID     = $id
   $env:R2_SECRET_ACCESS_KEY =
     [Runtime.InteropServices.Marshal]::PtrToStringAuto(
       [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))

   # 1. prove the pair reaches the bucket at all
   $env:R2_BUCKET = 'zebra-docs'
   node scripts/check-r2.mjs

   # 2. set the rule, both origins, then read it back
   node scripts/r2-cors.mjs --apply --bucket zebra-docs `
     --origin https://zebra.tajikcargollc.workers.dev
   node scripts/r2-cors.mjs --bucket zebra-docs

   # 3. forget them, and delete the token in the dashboard
   Remove-Item Env:R2_ACCESS_KEY_ID, Env:R2_SECRET_ACCESS_KEY
   ```

   Step 1 matters as much as step 2: an admin token scoped to the wrong bucket
   sets CORS on a bucket nobody uploads to, and reports success doing it.

7. **(account) Verify `tajikcargollc.com` in Resend** — DKIM CNAMEs and an SPF
   TXT record. Until it verifies, production mail from `no-reply@` is refused,
   which is the failure you want: the alternative is silently sending from a
   shared address.

8. **Seed production.**

   ```bash
   NEON_BRANCH=production DIRECT_DATABASE_URL='<production DIRECT url>' \
     node --import tsx -r dotenv/config prisma/seed.ts
   ```

   **Not `npm run db:seed`.** That goes through the Prisma CLI, which loads
   `prisma.config.ts`, which refuses `NEON_BRANCH=production` unless
   `NODE_ENV=production` _and_ `ALLOW_PROD_MIGRATION=1` are set as well — and
   setting a flag named for migrations in order to run a seed is the kind of
   small lie that makes a guard worthless the next time it matters. The seed
   script reads `NEON_BRANCH` and `DIRECT_DATABASE_URL` itself and needs
   nothing from that config, so it is invoked directly. `dotenv/config` is
   still loaded, for `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD`; dotenv does
   not overwrite a variable already set on the command line, so the two above
   win over `.env`'s dev values.

   Expect `[zebra.audit.gap] noContext` lines. A seed writes outside any
   request, so there is no session to attribute the rows to, and the audit
   extension says so rather than inventing one.

   The seed hashes `SEED_OWNER_PASSWORD` once and the owner row is an upsert
   whose `update` is empty — a second seed will not change it — so it is a real
   one from the start. Left unset, the seed mints one and prints it exactly
   once. `SEED_OWNER_EMAIL` decides who the owner is; it defaults to the
   address in `prisma/seed.ts`.

   What it leaves behind: one organization, both operating authorities, one
   OWNER membership with no company scope (which means all of them), and
   nothing operational. **No `Counter` rows** — the load-number series is
   created atomically by `allocateNumber` when the first load is booked under
   an authority, not by the seed. An empty `Counter` table on a fresh
   production branch is the correct state, not a missing step. The isolation-counterpart organization is skipped
   outside dev by the seed itself (`prisma/seed.ts` — it prints
   `skipping the isolation counterpart — never in production`).

9. **Deploy and live-check.**

   ```bash
   npm run deploy:prod
   node -r dotenv/config scripts/live-check.mjs https://<production origin>
   ```

   Standing rule 1: a version ID alone is not a deploy. The live check pairs
   every refusal with the same request made with a session, so a 401 that is
   really a 404 cannot pass.

10. **(account) Custom domain** — **PARKED.** `tajikcargollc.com` does not
    resolve yet; neither the apex nor `tms.`. Production runs on
    `https://zebra.tajikcargollc.workers.dev` until it does, and the four things
    that must move together when it exists are written out below so that they
    move together rather than one at a time.

11. **Owner password changed through `/account`**, on production. The seed value
    is a bootstrap credential and has been typed into a shell.

12. **Prove the audit sink speaks.** The Analytics Engine binding is declared
    per environment in `wrangler.jsonc` (bindings are _not_ inherited into a
    named environment — the production block went without one until it was
    caught, and a missing binding is silent by design). After the first few real
    writes:

    ```bash
    node -r dotenv/config scripts/audit-events.mjs
    ```

    Silence is healthy only once you have seen it speak.

13. **Create the real users** — each dispatcher as `DISPATCHER`, accounting as
    `ACCOUNTING`, each setting their own password through the reset email. Set
    `companyScopes` only for someone who genuinely works one authority; an empty
    scope means every authority in the organization.

### Email-in: loads@zebratms.com (Phase 6 §4 step 4)

Mail arrives at a domain, gets parsed by a small worker, and lands in
**Loads → Incoming** as a draft. **The application does not move** — it stays
on `zebra.tajikcargollc.workers.dev`. `zebratms.com` is a mail domain here and
nothing else, which is why this is not the parked custom-domain block below.

Five values have to agree, and three of the steps are account-level. Do them in
this order: the DNS has propagation in it and everything else is instant.

1. **(account) Turn on Email Routing** — Cloudflare → `zebratms.com` → Email →
   Email Routing → **Enable**. Cloudflare adds three MX records and an SPF TXT
   itself. Wait for the dashboard to say the records are verified before going
   on; until it does, mail bounces rather than queues.

   ```bash
   nslookup -type=mx zebratms.com
   ```

2. **Deploy the mail worker.** It is inert until step 3 points mail at it, so
   this is safe to do first and easy to check.

   ```bash
   npx wrangler deploy --config workers/email/wrangler.jsonc                  # dev
   npx wrangler deploy --config workers/email/wrangler.jsonc --env production # prod
   ```

3. **(account) Route the address** — Email Routing → Routing rules →
   **Create address** → `loads@zebratms.com` → Action **Send to a Worker** →
   `zebra-email`. Use `zebra-email-dev` if you want to try it against dev first;
   one address can only go to one worker, so pick one.

4. **The shared secret, on BOTH workers.** The mail worker sends it and the
   application checks it. Same value, two places — a mismatch is a 401 on every
   message and nothing in the inbox.

   ```bash
   SECRET=$(node -e "console.log(crypto.randomUUID()+crypto.randomUUID())")
   printf '%s\n' "$SECRET" | npx wrangler secret put INBOUND_EMAIL_SECRET --config workers/email/wrangler.jsonc --env production
   printf '%s\n' "$SECRET" | npx wrangler secret put INBOUND_EMAIL_SECRET --env production
   ```

5. **Tell the application which tenant and which address.** Two values, and
   they are checked against each other on every message: the environment names
   the organization, the database says which address that organization claims.
   Neither alone is enough, which is deliberate — see the note in
   `src/app/api/inbound-email/route.ts`.

   ```bash
   # the organization id
   psql "$DIRECT_DATABASE_URL" -c 'select id, name from "Organization"'

   # and the address it claims
   psql "$DIRECT_DATABASE_URL" \
     -c $'update "Organization" set "inboundAddress" = \'loads@zebratms.com\' where id = \'<org-id>\''
   ```

   Then `INBOUND_EMAIL_ORG_ID` in `wrangler.jsonc` (production `vars`) → that
   id, and `npm run deploy:prod`.

Afterwards: send one real booking email to `loads@zebratms.com` and watch it
arrive.

```bash
npx wrangler tail zebra-email --env production   # the parse and the POST
npx wrangler tail zebra --env production         # the read and the state
```

It should appear in **Loads → Incoming** within about a minute — most of which
is the model reading it. If it does not, the two tails say which half:
`no_tenant` means step 5 disagrees with itself, a 401 means step 4 does.

> **Nothing here sends mail.** Outbound is still Resend, still
> `onboarding@resend.dev`, and still blocked on verifying a sending domain —
> see the parked block below. Receiving at `zebratms.com` and sending from it
> are separate purchases of trust and only the first is done.

### Parked: moving production to a custom domain

Four values name the origin and **all four have to agree**. Moving one at a
time gives you an application that serves on the new host while its reset
links, its uploads or its mail still point at the old one — each failing in a
different place, none of them loudly.

Do it in this order. Steps 1 and 4 are account-level.

1. **(account) Attach the domain** to the `zebra` worker (Cloudflare →
   Workers → the worker → Settings → Domains & Routes), and confirm it
   actually resolves before touching anything else:

   ```bash
   nslookup tms.tajikcargollc.com
   curl -s -o /dev/null -w '%{http_code}\n' https://tms.tajikcargollc.com/login
   ```

2. **CORS: ADD the new origin, keep the old one.** Both, in the same call —
   the script replaces the whole configuration:

   ```bash
   R2_ACCESS_KEY_ID=<admin> R2_SECRET_ACCESS_KEY=<admin> \
     node -r dotenv/config scripts/r2-cors.mjs --apply --bucket zebra-docs \
     --origin https://tms.tajikcargollc.com \
     --origin https://zebra.tajikcargollc.workers.dev
   ```

   Uploads in flight are signed against the origin that minted them. Drop the
   workers.dev origin only after a day on the new host with no upload failures.

3. **`APP_ORIGIN`** in `wrangler.jsonc` (production `vars`) → the new origin,
   then `npm run deploy:prod`. This one is safe to flip immediately: it decides
   where reset links point and nothing else reads it.

4. **(account) Verify the sending domain in Resend** (DKIM CNAMEs + SPF TXT),
   then set `RESEND_FROM` to `Zebra <no-reply@tajikcargollc.com>` and deploy
   again.

   **This is the step that unblocks onboarding.** Until it is done, production
   sends from `onboarding@resend.dev`, Resend's shared sender, which delivers
   **only to the address that owns the Resend account** — the owner can reset
   their own password and nobody else can. Runbook step 12 creates dispatchers
   by reset email, so it cannot be completed before this.

Afterwards, the checks worth running: `scripts/live-check.mjs` against the new
origin, one document upload from a browser on the new host, and one reset
request whose link you actually click.

> **Never refresh `dev` from production data.** Production now holds CDL
> numbers, broker rates and settlement figures. Schema-only or anonymized
> branching from here on.

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

Application code never sets that variable by hand. Routes call `withCurrentOrg`
from [`src/lib/auth-context.ts`](src/lib/auth-context.ts), which resolves the
tenant, the permission check and the acting user together; it delegates to
`withOrg` in [`src/lib/tenancy.ts`](src/lib/tenancy.ts), which validates the id,
opens one interactive transaction and sets `app.current_org_id` for its
duration. The id comes from the session and from nowhere else — and ESLint
refuses `withOrg` under `src/app/**` so that stays true.

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

- **Hashing is argon2id**, `m=19456 KiB, t=2, p=1` — OWASP's second recommended
  profile — via [`@noble/hashes`](https://github.com/paulmillr/noble-hashes),
  a pure-JS implementation. Hashes are stored in PHC format
  (`$argon2id$v=19$m=19456,t=2,p=1$…`), so the parameters travel with the hash
  and retuning invalidates nothing. **Measured at 646 ms of CPU on the deployed
  worker**, by `wrangler tail` around a real login. See the dead ends below —
  three of the four obvious answers do not work here.
- **Old PBKDF2 hashes still verify**, and `needsRehash` reports every one of
  them as stale, so each password upgrades itself on its owner's next
  successful login. Nobody is locked out and nobody is asked to reset.
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

### Password hashing on workerd: what does not work, and why

Four candidates, three dead. Each was verified, not assumed, and each is
recorded because rediscovering one costs a session.

| Candidate             | Outcome                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `bcrypt`              | C++ addon. Does not exist on workerd. Works perfectly in `next dev`.                                                               |
| `@node-rs/argon2`     | Rust addon. Same.                                                                                                                  |
| PBKDF2 over WebCrypto | Runs, but **deployed Workers cap it at 100,000 iterations** — below OWASP's 600k floor for SHA-256.                                |
| `hash-wasm`           | Decodes its module from base64 and calls `WebAssembly.compile` at runtime. workerd: `Wasm code generation disallowed by embedder`. |
| **`@noble/hashes`**   | Pure JS, no WASM, no addon. Runs. **This is what ships.**                                                                          |

> **The workers vitest pool is not the deployed runtime.** It is workerd, and it
> is close enough for behaviour, but it does not enforce the PBKDF2 iteration
> cap. Phase 1 shipped a test named _"runs 600,000 iterations inside workerd
> without complaint"_ that passed here and failed on the live worker, and the
> README said the cost was "measured in workerd". It was not. **Nothing in
> `tests/workers/` may be cited as evidence about a platform limit** — limits
> are settled against the deployed worker with `wrangler tail`, and the number
> is pasted into the step report.

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
// { written, failures, lastFailure,
//   gaps: { noContext, unattributed, unfollowableOperation } }
```

| Counter                      | Expected               | Meaning                                                              |
| ---------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `failures`                   | **zero, forever**      | the audit row could not be written                                   |
| `gaps.unattributed`          | zero in app code       | somebody declared `unattributed(reason)`; the reason is in the log   |
| `gaps.unfollowableOperation` | zero                   | `createMany` — use `createManyAndReturn`                             |
| `gaps.noContext`             | **non-zero, normally** | writes in no tenant transaction: the seed, and login touching `User` |

Gaps are counted apart from failures precisely so they can never drown one.

> **These counters live in isolate memory.** Workers isolates are ephemeral and
> plural, so `getAuditHealth()` reports one isolate's slice of one moment — not
> the fleet's. Read it as a test and development instrument.

**The durable counterpart is wired** (Phase 2 Step 1, paying Phase 1 §8's debt).
`onAuditEvent` feeds an Analytics Engine dataset through
[`src/lib/audit-sink.ts`](src/lib/audit-sink.ts), bound as `AUDIT_EVENTS` →
`zebra_audit_dev`. Read it back with:

```
node scripts/audit-events.mjs [hours]
```

Two properties that file must keep, and that `tests/audit-sink.test.ts` holds
it to:

- **A missing binding is a no-op, never an error.** Node, `next dev` and every
  test have no binding, and audit must behave identically without one.
- **Nothing tenant-identifying leaves.** A datapoint carries the _shape_ of the
  problem — model, operation, gap kind, error message — never a row id and
  never a value out of a diff. Analytics Engine sits outside the row-level
  security the rest of this application is built on.

Its failure mode is silence, which is indistinguishable from the healthy state
of zero failures. That is why the binding name is asserted from both ends and
why `scripts/audit-events.mjs` says so out loud when it finds nothing at all.

### This is a change log, not a security event log

Because the audit row rides the caller's transaction, a rolled-back write leaves
no trace. That is correct for the question this table answers — _what happened
to this load_ — and wrong for _who tried to reach what and was refused_.

Denied permission checks, forged tenant attempts and rolled-back writes belong
in a **separate stream**; `LoginAttempt` is the beginning of one. Keep them
apart: merging them fills the change log with noise and hands the security log a
rollback rule that erases exactly the attempts you wanted to see.

### Attribution is required, not encouraged

`runInOrg` and `withOrg` **will not compile** without an `attribution`. An
optional field there was the same shape of bug as the lazy-promise one: writes
committed perfectly, attributed to nobody, and nothing complained.

```ts
withOrg(orgId, fn, { attribution: { userId, ip, userAgent } })
withOrg(orgId, fn, { attribution: unattributed('nightly reconciliation') })
```

The escape hatch survives, but it has to be typed out, it carries its reason
into the log, and it is greppable. An audit gap is now a decision.

Routes get it for free from `withCurrentOrg` — and **ESLint refuses `withOrg`,
`runInOrg`, `runAsUser`, `prisma` and `createPrismaClient` under `src/app/**`**,
because reaching past the front door also skips the `can()`check §7 requires.`tests/guardrails.test.ts` runs ESLint to prove the rule actually fires.

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
| `npm run deploy:dev`              | build, stamp the commit, deploy to `zebra-dev`          |
| `npm run deploy:prod`             | build, stamp the commit, deploy to `zebra`              |
| `npm run check:drift`             | what each worker is running, against HEAD               |

Node scripts, all pointed at the deployed worker by default:

| Script                        | Does                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| `scripts/live-check.mjs`      | the second half of "deployed" — routing, auth gating, no CDN  |
| `scripts/verify-argon2.mjs`   | signs in for real and proves the hash rolled over to argon2id |
| `scripts/audit-events.mjs`    | reads the Analytics Engine audit sink                         |
| `scripts/screenshots.mjs`     | 1080p evidence in EN, RU and RTL                              |
| `scripts/verify-criteria.mjs` | rows-at-1080p and focus-ring measurements                     |
| `scripts/check-hex.mjs`       | no hex colour outside the token block                         |

**Every step ends with a deploy and a live check** (Phase 2 standing rule 9),
not just the phase. Every blocker this project has hit lived in the
local-vs-workerd seam, and the only way to find one is to go there.

### Two traps, both hit for real on the first deploy

**Secrets need a trailing newline.** `printf '%s' "$V" | wrangler secret put NAME`
exits 0 and silently leaves the old value in place. Use `printf '%s
'`. And do
not pipe a value out of `dotenv` — dotenv 17 prints a banner to stdout, which
ends up _inside_ the secret; the first deploy shipped an R2_ENDPOINT of
`[dotenv@17.2.3] injecting env...https://...` and every presigned URL threw
`TypeError: Invalid URL string`. Parse `.env` directly.

**A GET route handler that reads nothing dynamic gets prerendered.** Next will
run it on Node at build time and serve the frozen result, which makes any
measurement of runtime behaviour a measurement of the build. Add
`export const dynamic = 'force-dynamic'` to anything that must actually execute
per request.

Secrets the worker needs, none of which belong in `wrangler.jsonc`:
`DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_ENDPOINT`.

`npm run preview` is not optional before deploying. `next dev` runs on Node; the
deployed app runs on workerd. Things that work in one and not the other —
password hashing above all — only surface under `preview`.

**"Deployed" means the live Cloudflare version ID advanced and a live check
passed.** A green push is not a deploy.

## Verification credentials

The scripts under `scripts/` that need a session — `live-check.mjs`,
`verify-users.mjs` — choose their account from the URL they are pointed at.
`scripts/check-credentials.mjs` owns that decision and there is exactly one
rule in it: **production never falls back to the seed owner.**

| Target                 | Reads                                      |
| ---------------------- | ------------------------------------------ |
| `zebra-dev`, localhost | `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` |
| anything else          | `PROD_CHECK_EMAIL` / `PROD_CHECK_PASSWORD` |

An unrecognised host counts as production. A custom domain nobody has added to
the list should demand the careful credential, not the convenient one.

### The Live Check account

Create it **through Admin → Users**, like any other person:

- role **ADMIN** — it needs to reach the screens the check exercises
- name it so it is obvious in the list, e.g. `Live Check`
- leave the company scope empty
- take the temporary password from the created panel and put it in
  `PROD_CHECK_PASSWORD`; it never expires on its own, and nothing forces it to
  be changed because nobody signs in interactively with it

Then, for a production run:

```bash
PROD_CHECK_EMAIL=live-check@… PROD_CHECK_PASSWORD=… \
  node -r dotenv/config scripts/live-check.mjs https://zebra.tajikcargollc.workers.dev
```

**It can be deactivated at will**, from the same Users screen, and that is the
point of it being an ordinary account rather than a credential in a vault:
deactivating revokes its sessions immediately, the checks start failing loudly
on the next run, and nothing else in the application is affected. Reactivate
when you want them back.

Two reasons the owner account is not used here. It broke — the owner changed
their production password through `/account`, which is exactly what they were
told to do, and the live check began reporting a failure that was its own stale
credential. And it was worse when it worked: a script signing into production
as the account that can do everything, from a machine where the password sits
in a dotfile beside the dev one.

`verify-users.mjs` additionally refuses a production run without
`PROD_DIRECT_DATABASE_URL`. It creates a user and deletes it again; doing that
against production through the dev connection string would either fail or, far
worse, half-succeed.

## Deploying

Two commands, and **there is no bare `npm run deploy`** — it was removed rather
than aliased, so muscle memory cannot reach the wrong worker:

```bash
npm run deploy:dev     # zebra-dev
npm run deploy:prod    # zebra
```

Both stamp the short commit onto the Cloudflare version with `--message`, and
a deploy from a dirty tree is stamped `<sha>+dirty` — "which commit is live"
has to be answerable including when the honest answer is "not one".

`npm run check:drift` reads that stamp back for both workers:

```
HEAD is 927b522
  dev         b1acc9f3  927b522 — matches HEAD
  production  180e1ba7  eaba71e — 3 commit(s) behind HEAD, 2 file(s) under src/
```

It runs as part of `npm run check` and **always exits 0**, including when it
shouts. Being ahead of production is the normal state of development, and a
gate that fails on the normal state is a gate people learn to skip. It is loud
in exactly one case — production trailing a commit that touched `src/` — and
silent about network failure, so `npm run check` still works on a plane.

The incident it exists for: the Telegram share action passed its whole check
suite, a live check and three screenshots **on dev**, while production carried
the previous commit and nobody noticed until the button was missing from the
screen that mattered.

## Secrets

Nothing secret belongs in `wrangler.jsonc`. `vars` there holds the non-secret
configuration — `NEON_BRANCH`, `R2_BUCKET`, `APP_ORIGIN`, `RESEND_FROM`.
Connection strings, R2 keys, `AUTH_SECRET` and `RESEND_API_KEY` go in via
`wrangler secret put` per environment, and in `.env` locally.

### Email (Resend)

The password-reset link is the only mail this application sends. The transport
is `src/lib/email.ts` — one `fetch` to `https://api.resend.com/emails`, no SDK.

**The API key is an account-level act and cannot be created from here.** Same
class as the R2 token below:

1. **resend.com → API Keys → Create**, with **Sending access**.
2. `printf '%s
' "<key>" | npx wrangler secret put RESEND_API_KEY`

Until that is done the worker logs `[zebra.email] RESEND_API_KEY is not set;
nothing was sent` and the reset screen still says the same sentence it always
says — the answer to "reset my password" must not change based on whether the
account exists OR on whether Resend is reachable, or it becomes the
account-enumeration oracle the rest of the flow carefully is not.

**The sender.** `RESEND_FROM` defaults to `Zebra <onboarding@resend.dev>`,
Resend's shared address: it works with no verified domain and delivers **only
to the address that owns the Resend account**. Right for dev, wrong for
production — production sets `Zebra <no-reply@tajikcargollc.com>`, which
requires the domain to be verified in Resend first (DNS: DKIM CNAMEs plus an
SPF TXT). Until it is verified, production mail is REFUSED rather than
silently sent from a shared address, which is the better of the two failures.

**`APP_ORIGIN`** is where reset links point. It is a deployment fact, not a
request fact: taken from the `Host` header, a worker reached through a preview
URL would mint links back to the preview. The header is only the fallback.

### Rotating them

**`zebra_app` database password.** Doable from here, because the migration owns
the role:

```sql
ALTER ROLE zebra_app WITH PASSWORD '<new>';   -- as the Neon owner
```

then update `DATABASE_URL` in `.env` and `printf '%s\n' "$URL" | wrangler secret put DATABASE_URL`.
Mind both traps above. Rotated 2026-07-30.

**R2 access key pair.** _Not_ doable from here: creating an S3-compatible token
is an account-level act, and `wrangler login`'s OAuth token is refused for it
(`9109 Unauthorized to access requested resource`). It is a dashboard job —
**R2 → Manage R2 API Tokens → Create** with Object Read & Write on
`zebra-docs-dev`, then:

```
printf '%s\n' "<key id>"  | wrangler secret put R2_ACCESS_KEY_ID
printf '%s\n' "<secret>"  | wrangler secret put R2_SECRET_ACCESS_KEY
```

and the same two values in `.env`. Delete the old token afterwards, not before —
a presigned URL already in flight is signed with it.

**`neondb_owner` password.** Neon dashboard only, same reasoning.

> **`.env` is gitignored and no credential in it has ever been committed** —
> `git log -S` over the full history finds none of them, and there is no remote.
> The exposure is transcript-only. That is still exposure.

# Production secret rotation

How to replace production's R2 tokens and the `zebra_app` database password
without taking the application down, and how to know it worked before anything
is destroyed.

**The one rule everything else serves:** _revoke the old credential only after
the new one is confirmed working._ A rotation has two irreversible moments — the
revoke and, for a database role, the password change — and the window between
"stored the new one" and "proved the new one" is where an outage lives.

**Nothing in this document goes into `.env`.** Rotation values are passed on the
command that needs them and nowhere else. `.env` holds DEV values; a production
value left there is a production credential sitting in a dotfile beside the dev
one, which is how the next person verifies the wrong thing.

---

## Before you start

| fact                   | where it lives                                                |
| ---------------------- | ------------------------------------------------------------- |
| Which bucket           | `wrangler.jsonc` → `env.production.vars.R2_BUCKET`            |
| Which R2 endpoint      | `wrangler.jsonc` → `env.production.vars.R2_ENDPOINT`          |
| Which Neon branch      | `wrangler.jsonc` → `env.production.vars.NEON_BRANCH`          |
| The secrets themselves | the worker, write-only. A secret's value cannot be read back. |

That last row is the constraint that shapes this whole procedure: **you cannot
ask the worker what its current secret is.** So "did it work" is answered by
making the credential do its job, not by reading it back.

### The verification command

```bash
# R2 only
R2_ACCESS_KEY_ID=<new id> R2_SECRET_ACCESS_KEY=<new secret> \
R2_BUCKET=zebra-docs R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
  node scripts/verify-secrets.mjs --target=production

# Database only
ZEBRA_TEST_URL='postgresql://zebra_app:<new>@<pooled host>/neondb?sslmode=require&channel_binding=require' \
  node scripts/verify-secrets.mjs --target=production
```

It prints booleans, hostnames and bucket names. **No secret reaches the output
on any path** — `tests/verify-secrets.test.ts` runs it with canary values and
greps for them.

It checks what a rotation gets wrong rather than only what a credential does:

- the role is `zebra_app`, not the owner — `src/lib/db.ts` refuses to start
  otherwise, so an owner URL deploys fine and fails on the first request
- the host is the **pooled** endpoint, which is what the worker uses
- the endpoint is not the one `.env` points at, when the target is production —
  `.env` is dev, and verifying dev while believing it is production is the
  mistake that makes the next step destructive
- the bucket and R2 endpoint match `wrangler.jsonc` for that environment
- and then, only then, it connects and does a PUT/GET/DELETE round trip

**`ALL CHECKS PASSED` is the only thing that licenses a revoke.** Anything else
prints `DO NOT REVOKE ANYTHING`, because the old credential is what is still
holding the application up.

---

## 1. R2 API tokens

R2 tokens are **additive**: two valid tokens can read and write the same bucket
at once. That is what makes this rotation safe — there is no moment when no token
works.

1. **Create the new token.** Cloudflare dashboard → R2 → Manage API Tokens →
   Create. Scope it to **Object Read & Write** on `zebra-docs` **only**. Not
   account-wide, and not including the dev bucket: a token that can reach both is
   a token whose blast radius is both.

   Copy the Access Key ID (32 hex) and Secret Access Key (64 hex). The secret is
   shown once.

2. **Prove the pair before storing it.** This is cheap and it is the step that
   has caught real breakage on this project — a stored value that was 70
   characters of shell instead of a 32-character key, which failed only in a
   browser, as `net::ERR_FAILED`, hours later.

   ```bash
   R2_ACCESS_KEY_ID=<new id> R2_SECRET_ACCESS_KEY=<new secret> \
   R2_BUCKET=zebra-docs R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
     node scripts/verify-secrets.mjs --target=production
   ```

3. **Store it on the production worker.** `--env production` on **both**, and a
   trailing newline — `printf '%s\n'`, not `'%s'`. A secret stored without the
   newline has bitten this project before.

   ```bash
   printf '%s\n' "<new id>"     | npx wrangler secret put R2_ACCESS_KEY_ID     --env production
   printf '%s\n' "<new secret>" | npx wrangler secret put R2_SECRET_ACCESS_KEY --env production
   ```

   A forgotten `--env production` writes the **dev** worker's secret and says
   nothing.

4. **Redeploy and confirm the worker is using them.** Secrets take effect on the
   next deploy of that worker.

   ```bash
   node scripts/run-status.mjs deploy-prod -- npm run deploy:prod
   node scripts/run-status.mjs --check deploy-prod
   ```

   Then upload a document through the application and open it. That is the only
   check that exercises the presigned-URL path the way a dispatcher does; the
   script in step 2 proves the credential, not the deployment.

5. **Only now, revoke the old token.** Dashboard → R2 → Manage API Tokens →
   delete the previous one. If you cannot tell which is which, the new one's
   Access Key ID is the value you stored in step 3.

   **And not immediately after the deploy, either.** A presigned URL already in
   flight is signed with the old token: a dispatcher who opened a document page
   thirty seconds ago is holding a link that the revoke invalidates. Give it a
   few minutes. The presign TTL is in `src/lib/r2.ts`; wait at least that long
   after the deploy in step 4.

### Rollback

Before step 5 the old token still works, so rollback is: store the **old** pair
again with the step-3 commands and redeploy. Keep the old values until step 5 is
done for exactly this reason.

After step 5 there is no rollback — the old token is gone. That is why the
revoke is last and why `ALL CHECKS PASSED` gates it.

---

## 2. The `zebra_app` database password

This one is **not** additive. A role has one password; changing it invalidates
the old string immediately, so there IS a window — between the `ALTER ROLE` and
the deployed worker picking up the new secret — in which the running worker
cannot authenticate.

**Expect a short outage on this rotation and schedule it.** Minutes, not hours,
and not during a dispatch shift if it can be helped.

1. **Generate the new password** and build the full connection string from
   Neon's own value for the **pooled** production endpoint, keeping
   `?sslmode=require&channel_binding=require`. Do not hand-edit the host.

2. **Change the role's password**, as the branch owner, against the production
   branch:

   ```sql
   ALTER ROLE zebra_app WITH PASSWORD '<new>';
   ```

   The old string stops working here. The clock starts.

3. **Prove the new string immediately**, before touching the worker:

   ```bash
   ZEBRA_TEST_URL='postgresql://zebra_app:<new>@<pooled host>/neondb?sslmode=require&channel_binding=require' \
     node scripts/verify-secrets.mjs --target=production
   ```

   This also confirms the two things a wrong rotation gets wrong quietly: that
   the role is `zebra_app` and not the owner, and that row-level security still
   bites on the connection (`sees 0 Company rows with no org set`). A string that
   connects as the owner would work, deploy, and silently disable every tenant
   boundary in the application.

4. **Store it and redeploy:**

   ```bash
   printf '%s\n' "<new url>" | npx wrangler secret put DATABASE_URL --env production
   node scripts/run-status.mjs deploy-prod -- npm run deploy:prod
   node scripts/run-status.mjs --check deploy-prod
   ```

5. **Confirm the application**, not just the credential: sign in, open the
   dashboard. The window closes when a request that touches the database
   succeeds.

### Rollback

Run `ALTER ROLE zebra_app WITH PASSWORD '<the previous one>'` and redeploy with
the previous `DATABASE_URL`. **This requires having kept the old password**, so
keep it until step 5 passes. If the old password was not kept, rollback is
"generate another new one and repeat" — which is survivable but longer, and it
is the reason this document says to keep it.

### What this rotation does NOT touch

`DIRECT_DATABASE_URL` is the **owner** role, is used only by migrations and
seeds from an operator's machine, and is not a worker secret. Rotating it is a
separate, lower-risk job: change the owner password in Neon, update `.env`, run
`npx prisma migrate status`. Nothing deployed reads it.

---

## Order of operations, if both are being rotated

Do **R2 first, then the database.** R2's rotation has no outage window and
exercises the deploy pipeline; if something is wrong with the deploy itself, you
find out while the application is still fully up, rather than during the
database window.

Between the two, redeploy once and confirm — do not batch both secrets into one
deploy. A single deploy carrying two new credentials gives you one failure signal
for two possible causes.

---

## Why there is no automation here

A script that rotated these would need to hold both the old and new credentials,
the Cloudflare API token that can delete R2 tokens, and the database owner
password — which is a single thing worth stealing in place of three things that
are not kept together. The steps above are deliberately manual, and the only code
is the part that answers "did it work", because that is the part a human does
badly under time pressure.

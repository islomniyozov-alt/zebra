import { appendFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// THE TWO CONNECTION STRINGS FOR A CI BRANCH, BUILT FROM PARTS.
//
// ── WHY THIS IS NOT SIX LINES OF SHELL ───────────────────────────────────
//
// It was. Run 35307302962 built the application URL with
//
//     credential=${DEV_DATABASE_URL%%@*}
//
// and 108 test FILES failed to load with `DATABASE_URL or DIRECT_DATABASE_URL
// is not a URL`. The owner's URL was fine — the round-trip probe had already
// connected with it and printed a 16ms median — so the malformed one was this
// one, and the step that built it said nothing at all.
//
// `%%@*` is the same hazard as `sed` and as `cmd | tail`: a prefix strip
// CANNOT FAIL. What is left is a secret nobody can print and a failure three
// steps downstream, which is where that run spent itself.
//
// ── AND WHY IT NO LONGER READS A CONNECTION STRING AT ALL ────────────────
//
// The next run, 35308232556, parsed the secret properly, reached the gate and
// passed 1,915 of 1,939 tests — then failed two on `password authentication
// failed for user zebra_app`. The password was dev's, carried here through a
// secret box, and a password can be wrong in ways no amount of parsing can
// see: a `#` or a `?` inside it is a fragment or a query to a URL parser, and
// a stale paste looks exactly like a current one.
//
// So nothing is parsed now. The workflow gives the branch its OWN application
// credential — it is a throwaway copy, deleted when the job ends — and this
// file assembles two strings from named parts. There is no external URL left
// to be malformed.
//
// ── THE APPLICATION NEVER CONNECTS AS THE OWNER ──────────────────────────
//
// Run 35301618293 composed both URLs as the branch owner. `src/lib/db.ts`
// refused and `structure.test.ts` caught it independently — the owner holds
// BYPASSRLS, so every tenant boundary would have vanished and every isolation
// test would have passed vacuously. The two roles are therefore checked
// against each other here, before either string exists.
// ---------------------------------------------------------------------------

/** The application's role. Never the owner, and asserted rather than assumed. */
const APPLICATION_ROLE = 'zebra_app'

function required(name) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    console.log(`[ci] ${name} is empty; cannot compose a connection string.`)
    process.exit(1)
  }
  return value.trim()
}

const host = required('ENDPOINT_HOST')
const database = required('DATABASE_NAME')
const ownerRole = required('OWNER_ROLE')
const ownerPassword = required('OWNER_PASSWORD')
const appRole = required('APP_ROLE')
const appPassword = required('APP_PASSWORD')

// THE DANGEROUS ONE FIRST, and it is first because the spec caught it second:
// written the other way round, `APP_ROLE=neondb_owner` was refused for not
// being named `zebra_app` and the sentence explaining what BYPASSRLS would
// have cost never printed. A correct refusal for a shallow reason is how a
// check stops teaching anybody anything.
if (appRole === ownerRole) {
  console.log(`[ci] the application role and the branch owner are both`)
  console.log(`[ci] "${ownerRole}". The owner holds BYPASSRLS, so every tenant`)
  console.log(`[ci] boundary would disappear and the isolation suite would`)
  console.log(`[ci] pass on an empty promise. Refusing to compose that.`)
  process.exit(1)
}
if (appRole !== APPLICATION_ROLE) {
  console.log(`[ci] APP_ROLE is "${appRole}", not ${APPLICATION_ROLE}.`)
  process.exit(1)
}

// THE POOLED DOOR OF THE SAME ENDPOINT. `tests/db-target.ts` folds a `-pooler`
// suffix away and then demands the two hostnames match exactly, so the suffix
// goes on the FIRST label and nowhere else.
const [firstLabel, ...restOfHost] = host.split('.')
if (restOfHost.length === 0) {
  console.log(`[ci] ENDPOINT_HOST has no domain part: ${host}`)
  process.exit(1)
}
const pooledHost = [`${firstLabel}-pooler`, ...restOfHost].join('.')

/**
 * One connection string, with every part escaped on the way in.
 *
 * `encodeURIComponent` because a generated password is not promised to be
 * URL-safe: a raw `@` would retarget the host and a raw `/` would end the
 * authority, both silently.
 */
function connectionString(role, password, hostname) {
  return (
    `postgresql://${encodeURIComponent(role)}:${encodeURIComponent(password)}` +
    `@${hostname}/${encodeURIComponent(database)}?sslmode=require`
  )
}

// The owner's string does the admin work only: creating the eight per-worker
// databases from `zebra_template`, and the template itself. Nothing the
// application does runs as this role.
const direct = connectionString(ownerRole, ownerPassword, host)
const pooled = connectionString(appRole, appPassword, pooledHost)

// A last look through the same parser the suite uses, so a bad ENDPOINT_HOST
// or database name is caught here rather than three steps downstream.
for (const [label, value] of [
  ['DIRECT_DATABASE_URL', direct],
  ['DATABASE_URL       ', pooled],
]) {
  let url
  try {
    url = new URL(value)
  } catch (error) {
    console.log(`[ci] ${label.trim()} did not come out a URL: ${error.message}`)
    console.log(`[ci] host "${host}", database "${database}"`)
    process.exit(1)
  }
  // Said out loud, without the password.
  console.log(
    `[ci] ${label} -> ${url.protocol}//${url.username}:***@${url.host}${url.pathname}${url.search}`,
  )
}

const output = process.env.GITHUB_OUTPUT
if (!output) {
  console.log('[ci] no GITHUB_OUTPUT; composed the URLs but wrote nothing.')
  process.exit(0)
}

// Masked BEFORE they are written anywhere, so a later `set -x` or a step that
// echoes an output cannot leak one.
console.log(`::add-mask::${ownerPassword}`)
console.log(`::add-mask::${appPassword}`)
console.log(`::add-mask::${direct}`)
console.log(`::add-mask::${pooled}`)
appendFileSync(output, `direct=${direct}\npooled=${pooled}\n`)

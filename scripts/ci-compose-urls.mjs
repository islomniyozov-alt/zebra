import { appendFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// THE TWO CONNECTION STRINGS FOR A CI BRANCH, COMPOSED BY PARSING.
//
// ── WHY THIS IS NOT SIX LINES OF SHELL ───────────────────────────────────
//
// It was. Run 35307302962 built the application URL with
//
//     credential=${DEV_DATABASE_URL%%@*}
//     pooled="${credential}@${host%%.*}-pooler.${host#*.}/${database}?..."
//
// and 108 test FILES failed to load with `DATABASE_URL or DIRECT_DATABASE_URL
// is not a URL`. The owner's URL was fine — the round-trip probe had already
// connected with it and printed a 16ms median — so the malformed one was this
// one, and the step that built it said nothing at all.
//
// `%%@*` is the same hazard as `sed` and as `cmd | tail`: a prefix strip
// CANNOT FAIL. A wrapping quote, a `psql ` the console put in front, a stray
// newline, an `@` inside the password — each produces a different wrong string
// and none of them produce an error. What is left is a secret nobody can print
// and a failure three steps downstream, which is where the last run spent
// itself.
//
// So the string is PARSED, and every assumption is a check that names what it
// found. `new URL` either yields a real credential or throws here, with the
// shape printed and the password not.
//
// ── AND THE APPLICATION NEVER CONNECTS AS THE OWNER ──────────────────────
//
// Run 35301618293 composed both URLs as the branch owner. `src/lib/db.ts`
// refused and `structure.test.ts` caught it independently — the owner holds
// BYPASSRLS, so every tenant boundary would have vanished and every isolation
// test would have passed vacuously. The username is therefore asserted, not
// assumed: the owner role does the admin work, `zebra_app` does everything the
// application does.
// ---------------------------------------------------------------------------

/** What a malformed secret may be shown as. Never the password. */
function shapeOf(value) {
  return `length ${value.length}, starts ${JSON.stringify(value.slice(0, 14))}, ends ${JSON.stringify(value.slice(-20))}`
}

function required(name) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    console.log(`[ci] ${name} is empty; cannot compose a connection string.`)
    process.exit(1)
  }
  return value
}

/**
 * What people actually paste into a secret box.
 *
 * Neon's console offers the string inside a `psql '...'` snippet and GitHub
 * keeps whatever is pasted, whitespace and quotes included. None of that is a
 * reason to fail — but all of it must be REMOVED KNOWINGLY and said out loud,
 * rather than silently surviving into a URL that does not parse.
 */
function tidy(name, raw) {
  let value = raw.trim()
  const notes = []
  if (value !== raw) notes.push('surrounding whitespace')
  if (/^psql\s+/i.test(value)) {
    value = value.replace(/^psql\s+/i, '').trim()
    notes.push('a leading `psql`')
  }
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value)
  if (quoted) {
    value = quoted[2]
    notes.push('wrapping quotes')
  }
  if (notes.length > 0) {
    console.log(`[ci] ${name} carried ${notes.join(' and ')}; trimmed.`)
  }
  return value
}

function parse(name, raw) {
  const value = tidy(name, raw)
  try {
    return new URL(value)
  } catch (error) {
    console.log(`[ci] ${name} IS NOT A URL: ${error.message}`)
    console.log(`[ci] ${name} ${shapeOf(value)}`)
    process.exit(1)
  }
}

const host = required('ENDPOINT_HOST')
const database = required('DATABASE_NAME')
const ownerRole = required('OWNER_ROLE')
const ownerPassword = required('OWNER_PASSWORD')

// THE POOLED DOOR OF THE SAME ENDPOINT. `tests/db-target.ts` folds the
// `-pooler` suffix away and then demands the two hostnames match exactly, so
// this suffix goes on the FIRST label and nowhere else.
const [firstLabel, ...restOfHost] = host.split('.')
if (restOfHost.length === 0) {
  console.log(`[ci] ENDPOINT_HOST has no domain part: ${host}`)
  process.exit(1)
}
const pooledHost = [`${firstLabel}-pooler`, ...restOfHost].join('.')

// ── THE OWNER'S URL: admin work only ─────────────────────────────────────
// Creating the eight per-worker databases from `zebra_template`, and the
// template itself. `encodeURIComponent`, because a revealed password is not
// promised to be URL-safe and a raw `@` or `/` in it would silently retarget
// the whole string.
const direct = new URL(
  `postgresql://${encodeURIComponent(ownerRole)}:${encodeURIComponent(ownerPassword)}@${pooledHost}/x`,
)
direct.hostname = host
direct.pathname = `/${database}`
direct.search = '?sslmode=require'

// ── AND THE APPLICATION'S URL: dev's own `zebra_app`, new host ───────────
// The branch is a copy of dev, so dev's application role and password exist on
// it unchanged. Only the host moves.
const dev = parse('DEV_DATABASE_URL', required('DEV_DATABASE_URL'))
if (dev.username !== 'zebra_app') {
  console.log(
    `[ci] DEV_DATABASE_URL authenticates as "${dev.username}", not zebra_app.`,
  )
  console.log('[ci] The application must never connect as the database owner.')
  process.exit(1)
}
if (dev.username === ownerRole) {
  console.log(`[ci] zebra_app and the branch owner are the same role.`)
  console.log('[ci] The owner holds BYPASSRLS; every tenant boundary would go.')
  process.exit(1)
}

const pooled = new URL(dev.toString())
pooled.hostname = pooledHost
pooled.port = ''
pooled.pathname = `/${database}`
pooled.search = '?sslmode=require'

// ── SAY WHAT WAS BUILT, WITHOUT SAYING THE PASSWORD ──────────────────────
for (const [label, url] of [
  ['DIRECT_DATABASE_URL', direct],
  ['DATABASE_URL       ', pooled],
]) {
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
console.log(`::add-mask::${dev.password}`)
console.log(`::add-mask::${direct.toString()}`)
console.log(`::add-mask::${pooled.toString()}`)
appendFileSync(
  output,
  `direct=${direct.toString()}\npooled=${pooled.toString()}\n`,
)

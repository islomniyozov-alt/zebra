// ---------------------------------------------------------------------------
// LIVE CHECK — the second half of standing rule 1.
//
// "Deployed" means the version ID advanced AND a live check passed. Phase 2's
// rule 9 makes that a per-step ritual rather than a phase-end event, so the
// check is a script instead of a sequence of curls somebody retypes and
// shortens a little each time.
//
//   node scripts/live-check.mjs [base-url]
//
// Exits non-zero on the first failure. Every assertion is about a fact the
// local build cannot tell you: routing, redirects, auth gating, and whether a
// font URL survived the bundler.
// ---------------------------------------------------------------------------

const BASE = process.argv[2] ?? 'https://zebra-dev.tajikcargollc.workers.dev'

const results = []

async function check(label, path, expect, options = {}) {
  const response = await fetch(new URL(path, BASE), {
    method: options.method ?? 'GET',
    redirect: 'manual',
    headers: options.headers ?? {},
    ...(options.body ? { body: options.body } : {}),
  })
  const location = response.headers.get('location')
  const actual = location
    ? `${response.status} → ${new URL(location, BASE).pathname}`
    : String(response.status)
  const ok = actual === expect
  results.push({ label, path, expect, actual, ok })
  return response
}

await check('root redirects to the working screen', '/', '307 → /loads')
await check('loads without a session', '/loads', '307 → /login')
await check('login renders', '/login', '200')
await check('reset request renders', '/reset-password', '200')
// POST with a WELL-FORMED body. Two earlier drafts of this line asserted 401
// against a GET (a truthful 405) and then against `{}` (a truthful 400) — both
// were measuring the method check and the body validator, neither of which is
// the auth gate. Only a request that would otherwise succeed proves the gate
// is what stopped it.
await check(
  'api refuses an anonymous caller',
  '/api/documents/confirm',
  '401',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pendingUploadId: 'clzzzzzzzzzzzzzzzzzzzzzzz' }),
  },
)

// The one that only a real fetch can answer: nothing reaches a font CDN.
const login = await fetch(new URL('/login', BASE))
const html = await login.text()
const cdn = html.match(
  /https?:\/\/[^"']*(fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|unpkg)[^"']*/g,
)
results.push({
  label: 'no external font CDN',
  path: '/login',
  expect: '0 references',
  actual: `${cdn?.length ?? 0} references`,
  ok: !cdn,
})

const width = Math.max(...results.map((r) => r.label.length))
for (const r of results) {
  console.log(
    `${r.ok ? 'ok  ' : 'FAIL'}  ${r.label.padEnd(width)}  ${r.path.padEnd(24)} ${r.actual}${r.ok ? '' : `   (expected ${r.expect})`}`,
  )
}

const failed = results.filter((r) => !r.ok).length
console.log(
  `\n${results.length - failed}/${results.length} passed against ${BASE}`,
)
process.exit(failed === 0 ? 0 : 1)

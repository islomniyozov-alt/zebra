// ---------------------------------------------------------------------------
// LIVE CHECK — the second half of standing rule 1.
//
// "Deployed" means the version ID advanced AND a live check passed. Phase 2's
// rule 9 makes that a per-step ritual rather than a phase-end event, so the
// check is a script instead of a sequence of curls somebody retypes and
// shortens a little each time.
//
//   node -r dotenv/config scripts/live-check.mjs [base-url]
//
// STANDING RULE 11: a negative check proves nothing unless the same request
// succeeds with the gate removed. Every "refused" assertion below is paired
// with the same request made with a session, and the pair is what makes the
// refusal evidence about authentication rather than about the request being
// malformed, the route being absent, or the worker being down. Two earlier
// drafts of the anonymous-API line asserted 401 against a GET (a truthful 405)
// and against `{}` (a truthful 400); both passed, and neither touched the auth
// gate. That is the incident this rule is named after.
//
// The paired half needs credentials. Without them the script still runs and
// says out loud which assertions it could not pair.
// ---------------------------------------------------------------------------

const BASE = process.argv[2] ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const EMAIL = process.env.SEED_OWNER_EMAIL
const PASSWORD = process.env.SEED_OWNER_PASSWORD

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
  results.push({ label, path, expect, actual, ok: actual === expect })
  return response
}

/**
 * A session cookie, by signing in the way a person does.
 *
 * Through a real browser, not a hand-built POST. The first version of this
 * scraped the server-action id out of the login HTML and posted to it; the id
 * format is Next's business and the regex did not match, so `signIn` returned
 * null and the script reported "credentials not set" — which was false, and
 * is precisely the failure mode rule 11 exists to catch. A check whose failure
 * message names the wrong cause is worse than no check.
 *
 * Returns a reason rather than null, so the two ways this can fail stay
 * distinguishable.
 */
async function signIn() {
  if (!EMAIL || !PASSWORD) {
    return {
      cookie: null,
      reason: 'SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD not set',
    }
  }

  const { chromium } = await import('playwright')
  const browser = await chromium.launch(
    process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
  )
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(new URL('/login', BASE).href, {
      waitUntil: 'domcontentloaded',
    })
    await page.fill('input[name="email"]', EMAIL)
    await page.fill('input[name="password"]', PASSWORD)
    await Promise.all([
      page.waitForURL(/\/loads/, { timeout: 60_000 }),
      page.click('button[type="submit"]'),
    ])
    const found = (await context.cookies()).find(
      (c) => c.name === 'zebra_session',
    )
    return found
      ? { cookie: `zebra_session=${found.value}`, reason: null }
      : { cookie: null, reason: 'signed in but no session cookie was set' }
  } catch (error) {
    return {
      cookie: null,
      reason: `login failed: ${String(error).slice(0, 120)}`,
    }
  } finally {
    await browser.close()
  }
}

// --- unauthenticated ---------------------------------------------------------

await check('root redirects to the working screen', '/', '307 → /loads')
await check('login renders', '/login', '200')
await check('reset request renders', '/reset-password', '200')

const GATED = [
  ['loads', '/loads'],
  ['trucks', '/trucks'],
  ['trailers', '/trailers'],
  ['drivers', '/drivers'],
  ['brokers', '/brokers'],
  ['account', '/account'],
]

for (const [name, path] of GATED) {
  await check(`${name} without a session`, path, '307 → /login')
}

const API_BODY = JSON.stringify({
  pendingUploadId: 'clzzzzzzzzzzzzzzzzzzzzzzz',
})
await check(
  'api refuses an anonymous caller',
  '/api/documents/confirm',
  '401',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: API_BODY,
  },
)

// --- the paired half: the same requests WITH a session ----------------------

const { cookie: session, reason } = await signIn()

if (!session) {
  results.push({
    label: 'PAIRED CHECKS SKIPPED',
    path: '(no session)',
    expect: 'a session',
    actual: reason,
    ok: false,
  })
} else {
  for (const [name, path] of GATED) {
    await check(`${name} WITH a session`, path, '200', {
      headers: { cookie: session },
    })
  }

  // Past the auth gate, this id belongs to no mint — 404, not 401. Anything
  // other than 401 proves the gate was what stopped the anonymous call.
  await check(
    'api admits an authenticated caller',
    '/api/documents/confirm',
    '404',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: session },
      body: API_BODY,
    },
  )
}

// --- the one only a real fetch can answer -----------------------------------

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

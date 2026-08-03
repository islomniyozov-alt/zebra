// ---------------------------------------------------------------------------
// WHICH ACCOUNT A VERIFICATION SCRIPT SIGNS IN AS.
//
// The scripts used to read SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD whatever
// they were pointed at, which was wrong in two directions at once.
//
//   It broke. The owner changed their production password through /account —
//   which is exactly what they were told to do — and the live check started
//   reporting a failure that was its own stale credential.
//
//   It was worse when it worked. A script that signs into PRODUCTION as the
//   owner is a script holding the account that can do everything, on a machine
//   where the password sits in a dotfile beside the dev one.
//
// So production runs use a dedicated Live Check account: an ADMIN created
// through the Users screen, deactivatable from the same screen the moment it
// looks wrong, and holding nothing that is not needed to answer "does this
// deployment work". There is NO fallback to the seed owner. A missing
// PROD_CHECK_PASSWORD stops the run with an explanation rather than quietly
// trying the wrong key in the more important lock.
//
// UNKNOWN HOSTS COUNT AS PRODUCTION. A custom domain that nobody added to the
// list below should demand the careful credential, not the convenient one.
// ---------------------------------------------------------------------------

/** Hosts known to be the development worker. Everything else is production. */
const DEV_HOSTS = new Set([
  'zebra-dev.tajikcargollc.workers.dev',
  'localhost',
  '127.0.0.1',
])

export function isProduction(baseUrl) {
  try {
    return !DEV_HOSTS.has(new URL(baseUrl).hostname)
  } catch {
    // An unparseable base is not a reason to reach for the owner's password.
    return true
  }
}

/**
 * The credentials to use against `baseUrl`, or an explanation of what is
 * missing. Never throws — the caller decides how to report it.
 */
export function credentialsFor(baseUrl) {
  if (!isProduction(baseUrl)) {
    const email = process.env.SEED_OWNER_EMAIL
    const password = process.env.SEED_OWNER_PASSWORD
    if (!email || !password) {
      return {
        ok: false,
        target: 'dev',
        reason:
          'SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD are not set. They are the dev seed values from .env.',
      }
    }
    return { ok: true, target: 'dev', email, password, source: 'SEED_OWNER_*' }
  }

  const email = process.env.PROD_CHECK_EMAIL
  const password = process.env.PROD_CHECK_PASSWORD
  if (!email || !password) {
    return {
      ok: false,
      target: 'production',
      reason:
        'PROD_CHECK_EMAIL / PROD_CHECK_PASSWORD are not set.\n' +
        '  Production runs use a dedicated Live Check account — an ADMIN created\n' +
        '  through Admin -> Users, deactivatable from the same screen.\n' +
        '  SEED_OWNER_* is deliberately NOT used here: it is the owner account,\n' +
        '  and on production its password is not the one in .env anyway.',
    }
  }
  return {
    ok: true,
    target: 'production',
    email,
    password,
    source: 'PROD_CHECK_*',
  }
}

/** Resolve or exit, for scripts that cannot do anything useful without a session. */
export function requireCredentials(baseUrl) {
  const resolved = credentialsFor(baseUrl)
  if (!resolved.ok) {
    console.error(`Cannot sign in against ${baseUrl}:\n  ${resolved.reason}`)
    process.exit(1)
  }
  return resolved
}

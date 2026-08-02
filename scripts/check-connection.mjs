import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// PROVE A CONNECTION STRING BEFORE IT BECOMES A SECRET.
//
// A wrong `DATABASE_URL` does not fail at deploy. It fails on the first
// request that touches the database — a 500 with the message on the server and
// nothing in the browser — and the two ways it goes wrong look identical from
// outside:
//
//   TypeError: Invalid URL string          the value is not a URL at all
//   Authentication failed ... not valid    the value is a URL, the password is wrong
//
// Both happened on this project's production bring-up, in that order, each
// costing a deploy-and-probe cycle to identify. This says which in two seconds,
// from the machine holding the string, before `wrangler secret put` ever runs.
//
//   ZEBRA_TEST_URL='postgresql://...' node -r dotenv/config scripts/check-connection.mjs
//
// It prints the role, host, database and what row-level security does to the
// connection — never the password.
// ---------------------------------------------------------------------------

const url = process.env.ZEBRA_TEST_URL
if (!url) {
  console.error(
    'Set ZEBRA_TEST_URL to the connection string you are about to store.',
  )
  process.exit(1)
}

/**
 * Describe the value WITHOUT quoting any of it.
 *
 * The first version of this printed `url.slice(0, 24)` on the not-a-URL path,
 * reasoning that 24 characters of a broken string is diagnostic and harmless.
 * It is neither. `postgresql://zebra_app:` is 23 characters, so character 24
 * is the first character of the password — and the strings that FAIL to parse
 * are disproportionately the ones whose password contains a character that
 * breaks `new URL()`. That printed two real passwords into terminal
 * scrollback and a transcript before anybody noticed.
 *
 * So: shape only. Every check below is a boolean or a count, and no substring
 * of the value reaches the output on any path.
 */
function describe(value) {
  return [
    `length ${value.length}`,
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      ? 'starts with a scheme'
      : 'NO scheme at the start',
    `${(value.match(/@/g) ?? []).length} "@"`,
    /\s/.test(value) ? 'CONTAINS WHITESPACE' : 'no whitespace',
    /[\r\n]/.test(value) ? 'CONTAINS A LINE BREAK' : 'single line',
    /^["']|["']$/.test(value) ? 'WRAPPED IN QUOTES' : 'unquoted',
  ].join(', ')
}

/** Nothing derived from the value may reach a log. Errors included. */
function scrub(text) {
  let safe = text.replaceAll(url, '<connection string>')
  const password = url.match(/^[^:]+:\/\/[^:]+:([^@]+)@/)?.[1]
  if (password) safe = safe.replaceAll(password, '<password>')
  return safe
}

let parsed
try {
  parsed = new URL(url)
} catch {
  console.error('NOT A URL. This is the `TypeError: Invalid URL string` case.')
  console.error(`  ${describe(url)}`)
  console.error(
    '  Common causes: the shell command was stored instead of its output; a\n' +
      '  quote or a carriage return came along; the clipboard was empty. The\n' +
      '  value itself is deliberately not shown — a broken connection string\n' +
      '  is still a password.',
  )
  process.exit(1)
}

console.log(`role     ${parsed.username}`)
console.log(`host     ${parsed.hostname}`)
console.log(`database ${parsed.pathname.replace(/^\//, '')}`)
console.log(`params   ${parsed.search || '(none)'}`)
console.log(`pooled   ${parsed.hostname.includes('-pooler')}`)
console.log('')

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: url })

// THE LEAK THAT MATTERED, and it was not the one this file set out to fix.
//
// On an authentication failure the driver rejects the query — which the catch
// below handles and scrubs — and THEN emits an unhandled `error` event on the
// idle client. Node's default handler prints the event, which inspects the
// client, which contains `config.connectionString`. The password goes to
// stderr in cleartext, after a clean "FAILED to connect" that says it did not.
//
// Found by running this script against a URL with a canary password in it and
// grepping the output for the canary — which is the only way to find it, since
// every line the script itself writes is already careful.
//
// Two handlers, because one is the known path and the other is every path.
pool.on('error', () => {
  // Reported from the catch below. Swallowed here so Node does not print the
  // client object that carries the string.
})

process.on('uncaughtException', (error) => {
  console.error('FAILED — an error escaped after the connection attempt.')
  console.error(
    `  ${scrub(error instanceof Error ? error.message : String(error)).slice(0, 200)}`,
  )
  console.error('  (details suppressed: they carry the connection string)')
  process.exit(1)
})

try {
  const { rows } = await pool.query(
    `select current_user, current_database(),
            (select count(*)::int from pg_roles
              where rolname = current_user and rolbypassrls) bypassrls`,
  )
  const row = rows[0]
  console.log(`CONNECTED as ${row.current_user} to ${row.current_database}`)
  console.log(
    `bypassrls ${row.bypassrls > 0 ? 'YES — this is an owner connection' : 'no — this is an application connection'}`,
  )

  // What the tenant wall does to this connection. An application URL that can
  // see rows without `app.current_org_id` set is the one failure that would
  // not announce itself.
  const visible = await pool.query('select count(*)::int n from "Company"')
  console.log(
    `sees ${visible.rows[0].n} Company rows with no org set` +
      (row.bypassrls > 0
        ? ' (expected — the owner bypasses RLS)'
        : visible.rows[0].n === 0
          ? ' (expected — RLS is holding)'
          : ' ← RLS IS NOT HOLDING ON THIS CONNECTION'),
  )
} catch (error) {
  // Scrubbed: a driver is entitled to put the connection string it was handed
  // into its own error message, and several do.
  const message = scrub(error instanceof Error ? error.message : String(error))
  console.error('FAILED to connect.')
  console.error(`  ${message.split('\n').slice(0, 3).join(' ').slice(0, 300)}`)
  if (/authentication failed|password/i.test(message)) {
    console.error(
      '\n  The URL parses and the host answered — the credentials are wrong.\n' +
        "  Reset the role's password as the branch owner and rebuild the URL:\n" +
        "    ALTER ROLE zebra_app WITH PASSWORD '<new>';",
    )
  }
  process.exitCode = 1
} finally {
  await pool.end()
}

import { readFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// READ THE AUDIT SINK.
//
// `getAuditHealth()` counts inside one isolate and Workers isolates are
// ephemeral and plural — Phase 1 §8 recorded that as owed before production.
// Phase 2 Step 1 wired `onAuditEvent` to Analytics Engine; this is the other
// end, and the reason the wiring is not taken on trust.
//
//   node scripts/audit-events.mjs [hours]
//
// Auth comes from CLOUDFLARE_API_TOKEN if set, otherwise from the token
// `wrangler login` already stored. Nothing here is tenant data by
// construction — see src/lib/audit-sink.ts for what a datapoint may carry.
// ---------------------------------------------------------------------------

const HOURS = Number(process.argv[2] ?? 24)
const ACCOUNT = process.env.R2_ACCOUNT_ID ?? readEnv('R2_ACCOUNT_ID')
const DATASET = process.env.AUDIT_DATASET ?? 'zebra_audit_dev'

function readEnv(key) {
  try {
    const line = readFileSync('.env', 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${key}=`))
    return line?.slice(key.length + 1).replace(/^"|"$/g, '')
  } catch {
    return undefined
  }
}

function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN
  const path = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`
  const match = readFileSync(path, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/)
  if (!match) throw new Error('No API token. Run `wrangler login`.')
  return match[1]
}

const sql = `
  SELECT blob1 AS type, blob2 AS model, blob3 AS operation, blob4 AS detail,
         sum(_sample_interval) AS events
  FROM ${DATASET}
  WHERE timestamp > NOW() - INTERVAL '${HOURS}' HOUR
  GROUP BY type, model, operation, detail
  ORDER BY events DESC
  FORMAT JSON`

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`,
  {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token()}`,
      'content-type': 'text/plain',
    },
    body: sql,
  },
)

const body = await response.text()
if (!response.ok) {
  console.error(`Analytics Engine said ${response.status}:`, body.slice(0, 400))
  if (response.status === 401 && !process.env.CLOUDFLARE_API_TOKEN) {
    // The token above comes out of wrangler's config file, and a `wrangler
    // login` OAuth token expires roughly hourly. Wrangler refreshes it when it
    // runs; this script only reads it, so an expired one gives a bare
    // "Authentication error" that reads like a permissions problem and is not.
    // This is a weekly command during the parallel run — it should say so.
    console.error(
      "\n  The token in wrangler's config has almost certainly expired.\n" +
        '  Run any wrangler command to refresh it, then retry:\n' +
        '    npx wrangler whoami && node scripts/audit-events.mjs',
    )
  }
  process.exit(1)
}

const { data } = JSON.parse(body)
if (data.length === 0) {
  console.log(`No audit events in ${DATASET} over the last ${HOURS}h.`)
  console.log(
    'Zero failures is the expected steady state. Zero of EVERYTHING may mean the sink is not bound.',
  )
} else {
  console.table(data)
}

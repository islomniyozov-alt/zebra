import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// WHAT THE READERS ACTUALLY COST, FROM THE LEDGER PRODUCTION WROTE.
//
// Written 2026-09-12 for the provider switch. The question in front of it is
// "which calls does Zebra make to an LLM, and how big are they" — and the
// honest source for the second half is `ExtractionUsage`, one row per engine
// call, refusals included, tokens exactly as the engine reported them.
//
// NOT THE CODE'S BELIEF ABOUT ITS OWN CALLS. The prompt lengths are in the
// repository and would give a confident, wrong number: they omit the document,
// which is most of the input, and they cannot know the output at all. So this
// reads rows.
//
// SELECT ONLY, and it says so where the fence can read it: the allowlist in
// `tests/prod-url-guard.test.ts` holds every file permitted to open
// PROD_DIRECT_DATABASE_URL, and holds this one to SELECT.
// ---------------------------------------------------------------------------

//   node -r dotenv/config scripts/inspect-extraction-usage.mjs
//   ZEBRA_TARGET=dev node -r dotenv/config scripts/inspect-extraction-usage.mjs

const dev = process.env.ZEBRA_TARGET === 'dev'
const connectionString = dev
  ? process.env.DIRECT_DATABASE_URL
  : process.env.PROD_DIRECT_DATABASE_URL

if (!connectionString) {
  console.error(
    dev
      ? 'DIRECT_DATABASE_URL is not set.'
      : 'PROD_DIRECT_DATABASE_URL is not set.',
  )
  process.exit(1)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const DAYS = Number(process.argv[2] ?? 7)
const pool = new Pool({ connectionString, max: 1 })
console.log(`Target: ${dev ? 'dev' : 'PRODUCTION'}`)

const rows = async (text, values = []) => (await pool.query(text, values)).rows

const table = (title, data, columns) => {
  console.log(`\n${title}`)
  if (data.length === 0) {
    console.log('  (no rows)')
    return
  }
  const widths = columns.map((column) =>
    Math.max(
      column.length,
      ...data.map((row) => String(row[column] ?? '').length),
    ),
  )
  console.log('  ' + columns.map((c, i) => c.padEnd(widths[i])).join('  '))
  for (const row of data) {
    console.log(
      '  ' +
        columns
          .map((c, i) => String(row[c] ?? '').padEnd(widths[i]))
          .join('  '),
    )
  }
}

try {
  // THE TARGET IS NAMED FROM THE VARIABLE THAT WAS USED, and the timestamp is
  // formatted by Postgres rather than by `Date`. The first version printed
  // "production" whatever it had connected to and rendered the time in the
  // reader's local zone while labelling it UTC — a reading that mislabels its
  // own source is the one hazard this whole file is here to avoid.
  const [{ now }] = await rows(
    "SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS now",
  )
  console.log(
    `${dev ? 'dev' : 'PRODUCTION'}, read ${now} UTC — the last ${DAYS} days`,
  )

  // THE WINDOW IS STATED AND SO IS WHAT PRECEDES IT. A week with no rows is a
  // finding about the week; a table with no rows at all is a finding about the
  // ledger, and the two must not be reported as the same thing.
  const [total] = await rows(
    'SELECT count(*)::int AS all_rows FROM "ExtractionUsage"',
  )
  console.log(`ledger holds ${total.all_rows} rows in total`)

  table(
    `Per document type, calls in the window`,
    await rows(
      `SELECT "documentType"                             AS type,
              "model",
              count(*)::int                              AS calls,
              sum(CASE WHEN refused THEN 1 ELSE 0 END)::int AS refused,
              round(avg("inputTokens"))::int             AS avg_in,
              max("inputTokens")::int                    AS max_in,
              round(avg("outputTokens"))::int            AS avg_out,
              max("outputTokens")::int                   AS max_out,
              sum("cacheWriteTokens")::int               AS cache_w,
              sum("cacheReadTokens")::int                AS cache_r,
              sum("milliCents")::int                     AS millicents
         FROM "ExtractionUsage"
        WHERE "createdAt" > now() - ($1 || ' days')::interval
        GROUP BY 1, 2
        ORDER BY calls DESC`,
      [String(DAYS)],
    ),
    [
      'type',
      'model',
      'calls',
      'refused',
      'avg_in',
      'max_in',
      'avg_out',
      'max_out',
      'cache_w',
      'cache_r',
      'millicents',
    ],
  )

  table(
    `The same, over the whole ledger — the window may be quiet`,
    await rows(
      `SELECT "documentType"                  AS type,
              "model",
              count(*)::int                   AS calls,
              to_char(min("createdAt") AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS first,
              to_char(max("createdAt") AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS last,
              round(avg("inputTokens"))::int  AS avg_in,
              round(avg("outputTokens"))::int AS avg_out
         FROM "ExtractionUsage"
        GROUP BY 1, 2
        ORDER BY calls DESC`,
    ),
    ['type', 'model', 'calls', 'first', 'last', 'avg_in', 'avg_out'],
  )

  // ── THE LAST FEW CALLS, ONE ROW EACH ────────────────────────────────
  //
  // Added 2026-09-13 to answer a question the aggregates cannot: did THIS
  // upload go to the configured provider? A count of "12 DeepSeek CDL reads"
  // includes every run that NAMED the model on the command line, so it says
  // nothing about whether the worker's own configuration is in effect. One
  // row, with its clock, does.
  table(
    'The last ten calls, newest first',
    await rows(
      `SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'MM-DD HH24:MI:SS') AS at,
              "documentType"  AS type,
              "model",
              "askedModel"    AS asked,
              "inputTokens"   AS tok_in,
              "outputTokens"  AS tok_out,
              "cacheReadTokens" AS cache_r,
              "milliCents"    AS millicents,
              refused
         FROM "ExtractionUsage"
        ORDER BY "createdAt" DESC
        LIMIT 10`,
    ),
    [
      'at',
      'type',
      'model',
      'asked',
      'tok_in',
      'tok_out',
      'cache_r',
      'millicents',
      'refused',
    ],
  )

  table(
    'Fallbacks — asked one engine, answered by another',
    await rows(
      `SELECT "askedModel" AS asked, "model" AS answered, count(*)::int AS calls
         FROM "ExtractionUsage"
        WHERE "askedModel" IS NOT NULL
        GROUP BY 1, 2
        ORDER BY calls DESC`,
    ),
    ['asked', 'answered', 'calls'],
  )
} finally {
  await pool.end()
}

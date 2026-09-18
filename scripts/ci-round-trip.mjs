import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// HOW FAR IS THIS RUNNER FROM THE DATABASE? (owner's ruling, 2026-09-17)
//
// ── WHY IT IS THE FIRST THING CI DOES ────────────────────────────────────
//
// Standard GitHub-hosted runners give no region choice. The ruling is to use
// them anyway and let this number decide whether a paid, region-pinned runner
// is worth buying — so the number has to exist, in every run's log, before any
// timing the suite prints can be read.
//
// EVERY FIGURE THIS PROJECT QUOTES SITS ON TOP OF IT. The money screen's
// 2,209ms was measured from a machine roughly 200ms from us-east-2; the same
// page from a runner in the same region is a different number about the same
// code. A timing recorded without its distance is a measurement of an unknown
// place, which is the mistake `EXTRACTION-CONTRACT.md` records about costs and
// `this-week-timing.test.ts` records about clocks.
//
// ── A MEDIAN OF TEN, AFTER ONE WARM-UP ───────────────────────────────────
//
// The first query pays for the connection and the TLS handshake — that is the
// cold start the timing test was just fixed to stop charging to the page, and
// charging it here would overstate the distance by a second or more. Ten
// samples and the median, because one sample is a coin toss and a mean is at
// the mercy of a single stall.
//
// IT NEVER FAILS THE RUN. A measurement that could block a deploy is a
// measurement somebody deletes; if the probe cannot connect, the steps after
// it will say so far better than this can.
// ---------------------------------------------------------------------------

const url = process.env.PGURL
if (!url) {
  console.log('[ci] no PGURL; skipping the round-trip measurement')
  process.exit(0)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const pool = new Pool({ connectionString: url, max: 1 })

try {
  const connectStarted = Date.now()
  await pool.query('select 1')
  const cold = Date.now() - connectStarted

  const samples = []
  for (let index = 0; index < 10; index++) {
    const started = Date.now()
    await pool.query('select 1')
    samples.push(Date.now() - started)
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]

  // THE REGION COMES FROM THE HOST, not from a setting. `show neon.region`
  // is not a parameter Postgres knows — the probe's own guard said so the
  // first time this ran — and the endpoint name carries it plainly:
  // `ep-little-lake-aydu7faj.c-5.us-east-2.aws.neon.tech`.
  const host = new URL(url).hostname
  const region = /\.([a-z]+-[a-z]+-\d+)\.aws\./.exec(host)?.[1] ?? 'unknown'

  console.log('[ci] round trip to the Neon branch')
  console.log(`[ci]   connection + handshake  ${cold}ms (paid once)`)
  console.log(`[ci]   samples                 ${samples.join(' ')} ms`)
  console.log(`[ci]   MEDIAN                  ${median}ms`)
  console.log(`[ci]   database region         ${region}`)
  console.log(
    '[ci] every timing this run prints sits on top of that median. A paid,',
  )
  console.log(
    '[ci] region-pinned runner is worth buying only if this number says so.',
  )
} catch (error) {
  // NEVER FATAL. See the header.
  console.log(
    `[ci] could not measure the round trip: ${error instanceof Error ? error.message : String(error)}`,
  )
} finally {
  await pool.end().catch(() => undefined)
}

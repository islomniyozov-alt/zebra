// ---------------------------------------------------------------------------
// A BOUNDED TAIL FOR A PROBE (owner's ruling 2026-10-26, GAPS 38).
//
//   node scripts/tail-capture.mjs <origin-or-worker> <seconds> <out.json>
//
// Starts the worker's tail through `startTail`, waits `seconds`, and writes
// every event seen — TRIMMED by `trimEvent`, so no request headers and no
// cookie — as a JSON array to `out.json`. The tail dies with its whole
// process tree at the deadline; `startTail` also refuses the production
// worker, so this can never be the stray tail that split production's
// events on 2026-10-23. Use it beside a sign-in probe; never a bare
// `wrangler tail`.
// ---------------------------------------------------------------------------
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { startTail, trimEvent, rayOf, workerNameFor } from './worker-tail.mjs'

const [target, secondsArg, out] = process.argv.slice(2)
const seconds = Number(secondsArg)
if (!target || !Number.isFinite(seconds) || seconds <= 0 || !out) {
  console.error(
    'usage: node scripts/tail-capture.mjs <origin-or-worker> <seconds> <out.json>',
  )
  process.exit(2)
}
const worker = target.startsWith('http') ? workerNameFor(target) : target
const tail = startTail(worker, { maxMs: seconds * 1000 + 5_000 })
process.on('exit', () => tail.stop())
if (tail.failure()) {
  console.error(`tail-capture: ${tail.failure()} — NOT OK`)
  process.exit(1)
}
console.log(`tail-capture: tailing ${worker} for ${seconds} s → ${out}`)
await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
tail.stop()
const events = tail
  .all()
  .map((event) => ({ ray: rayOf(event), ...trimEvent(event) }))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(events, null, 2))
console.log(`tail-capture: ${events.length} event(s) written — OK`)

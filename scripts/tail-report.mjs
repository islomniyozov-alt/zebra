import { readFileSync } from 'node:fs'

// Turn a `wrangler tail --format json` capture into the CPU/wall table rule 10
// asks for. The output is pretty-printed JSON objects concatenated, not JSONL,
// so it is split on a closing brace at column 0 rather than on newlines.
//
//   npx wrangler tail --format json > tail.jsonl    # in another shell
//   node scripts/tail-report.mjs tail.jsonl [pathFilter]

const [file, filter] = process.argv.slice(2)
const raw = readFileSync(file, 'utf8')

const rows = []
for (const chunk of raw.split(/^\}\s*$/m)) {
  const text = chunk.trim()
  if (!text.startsWith('{')) continue
  try {
    const event = JSON.parse(`${text}}`)
    if (!event.event?.request) continue
    const path = new URL(event.event.request.url).pathname
    if (filter && !path.includes(filter)) continue
    rows.push({
      method: event.event.request.method,
      path,
      outcome: event.outcome,
      cpuMs: event.cpuTime,
      wallMs: event.wallTime,
    })
  } catch {
    // A truncated final object at the end of the capture. Skip it.
  }
}

if (rows.length === 0) {
  console.log('no matching requests in the capture')
} else {
  console.table(rows)
  const cpu = rows.map((r) => r.cpuMs).sort((a, b) => a - b)
  console.log(
    `${rows.length} requests · CPU min ${cpu[0]}ms · median ${cpu[Math.floor(cpu.length / 2)]}ms · max ${cpu[cpu.length - 1]}ms`,
  )
}

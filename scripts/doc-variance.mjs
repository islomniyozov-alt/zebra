import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  documentType,
  mimeTypeOf,
  readDocument,
  readingOf,
  signIn,
} from './document-types.mjs'

// ---------------------------------------------------------------------------
// HOW STABLE IS THIS DOCUMENT, FIELD BY FIELD?
//
//   node -r dotenv/config scripts/doc-variance.mjs <cdl|med> <path> [runs]
//
// ── WHY A DOCUMENT IS MEASURED RATHER THAN READ ONCE ──────────────────────
//
// On 2026-09-07 the same Georgia licence was read twice and `restrictions`
// came back ["S","M"] and then ["E","M"], both at high confidence. A single
// read cannot tell a stable field from an unstable one, and every accuracy
// figure this project quotes is built on single reads.
//
// Ten runs of that card then found thirteen of fourteen fields identical, and
// `restrictions` returning FIVE distinct values with four mutually exclusive
// ones sharing the label `high`. That measurement is what moved confidence
// onto each code and taught the reader to say a code is unreadable — none of
// which is visible from one run.
//
// SO EVERY NEW DOCUMENT GETS MEASURED THIS WAY. `EXTRACTION-CONTRACT.md` holds
// the numbers and the caveat they must travel with.
//
// IT GOES THROUGH THE DEPLOYED WORKER, because the API key lives there. ONE
// LOGIN, N SEQUENTIAL READS: concurrency would measure the rate limiter as
// well as the model, and sequential keeps each read independent.
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const EMAIL = process.env.VERIFY_EMAIL ?? process.env.SEED_OWNER_EMAIL
const PASSWORD = process.env.VERIFY_PASSWORD ?? process.env.SEED_OWNER_PASSWORD
const KIND = process.argv[2]
const CARD = process.argv[3]
const RUNS = Number(process.argv[4] ?? 10)

if (!KIND || !CARD || !EMAIL || !PASSWORD) {
  console.error(
    'Usage: node -r dotenv/config scripts/doc-variance.mjs <cdl|med> <path> [runs]',
  )
  console.error('Needs VERIFY_EMAIL and VERIFY_PASSWORD (or the SEED_OWNER_*).')
  process.exit(1)
}

const type = documentType(KIND)
const bytes = readFileSync(CARD)
console.log(`document ${type.label}`)
console.log(`card     ${CARD} (${bytes.length} bytes as ${mimeTypeOf(CARD)})`)
console.log(`target   ${BASE}${type.route}`)
console.log(`runs     ${RUNS}
`)

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const results = []
try {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, BASE, EMAIL, PASSWORD)

  for (let run = 1; run <= RUNS; run++) {
    const started = Date.now()
    const answer = await readDocument(page, type, bytes, basename(CARD))
    const ms = Date.now() - started
    let parsed = null
    try {
      parsed = JSON.parse(answer.text)
    } catch {
      // Kept raw in the dump: a run that did not parse is still evidence.
    }
    results.push({ run, ms, status: answer.status, parsed, raw: answer.text })

    // ONE FIELD ON THE LIVE LINE, CHOSEN PER DOCUMENT — the one already known
    // to move. Everything else is in the table below; this is so a long run
    // can be watched rather than waited out.
    const watched = KIND === 'cdl' ? 'restrictions' : 'expiresAt'
    const reading = readingOf(parsed?.fields?.[watched])
    console.log(
      `run ${String(run).padStart(2)}  http ${answer.status}  ` +
        `${String(ms).padStart(6)}ms  ${watched}=${reading.value}/${reading.confidence}` +
        (parsed?.notice ? `  NOTICE ${parsed.notice}` : ''),
    )
  }
} finally {
  await browser.close()
}

// THE RAW RUNS ARE DUMPED BEFORE ANYTHING IS SUMMARISED, so a wrong summary
// cannot destroy the evidence — the rule `doc-accuracy.mjs` also follows.
mkdirSync('corpus/.extractions', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const out = `corpus/.extractions/variance-${basename(CARD).replace(/\W+/g, '-')}-${stamp}.json`
writeFileSync(
  out,
  JSON.stringify(
    { kind: KIND, card: CARD, base: BASE, runs: results },
    null,
    2,
  ),
)
console.log(`
raw runs dumped to ${out}`)

const ok = results.filter((r) => r.parsed?.fields)
if (ok.length === 0) {
  console.log('\nNo run returned fields. Read the dump.')
  process.exit(3)
}

const keys = [
  ...new Set(ok.flatMap((r) => Object.keys(r.parsed.fields))),
].sort()
let observations = 0
let disagreements = 0
const unstable = []

console.log(`\n${ok.length}/${results.length} runs returned fields\n`)
console.log('field'.padEnd(20) + 'distinct  values (count)  [confidences]')
console.log('-'.repeat(100))
for (const key of keys) {
  const values = new Map()
  const confidences = new Map()
  for (const r of ok) {
    const { value, confidence } = readingOf(r.parsed.fields[key])
    values.set(value, (values.get(value) ?? 0) + 1)
    confidences.set(confidence, (confidences.get(confidence) ?? 0) + 1)
  }
  observations += ok.length
  disagreements += ok.length - Math.max(...values.values())
  if (values.size > 1) unstable.push({ key, distinct: values.size })

  const vs = [...values]
    .sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `${v}×${n}`)
    .join('  ')
  const cs = [...confidences]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}×${n}`)
    .join(' ')
  console.log(
    `${key.padEnd(20)}${String(values.size).padStart(5)}     ${vs}   [${cs}]`,
  )
}
console.log('-'.repeat(100))
console.log(
  `field-observations: ${observations}, disagreeing with the modal value: ${disagreements}`,
)

// ── THE FIGURE, AND THE SENTENCE IT MAY NOT TRAVEL WITHOUT ────────────────
//
// A bare ratio invites "licences are N times noisier than rate confirmations".
// The 2026-09-07 measurement was 1 in 28, and its shape was 0 in 130 across
// thirteen fields and 5 in 10 on one. The caveat is printed BESIDE the number
// rather than left to whoever quotes it, because the number is the part that
// travels. See EXTRACTION-CONTRACT.md.
if (disagreements === 0) {
  console.log(`No run-to-run variance across ${ok.length} runs of this card.`)
} else {
  console.log(
    `Aggregate: 1 field in ${Math.round(observations / disagreements)}.`,
  )
  console.log('')
  console.log('  QUOTE THIS RATIO ONLY WITH ITS SHAPE. The aggregate hides')
  console.log('  where the variance lives, and where is the useful part:')
  for (const { key, distinct } of unstable) {
    console.log(`    ${key}: ${distinct} distinct values in ${ok.length} runs`)
  }
  console.log(
    `    the other ${keys.length - unstable.length} field(s): identical across all ${ok.length} runs`,
  )
  console.log('')
  console.log('  And it is ONE CARD. A rate for licences needs several.')
}

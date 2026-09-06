import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

// ---------------------------------------------------------------------------
// ONE CARD, READ BY THE DEPLOYED WORKER, GRADED AGAINST A TRUTH SET THAT
// EXISTED FIRST.
//
// THE ORDER IS THE METHOD. The truth file is written and confirmed before this
// runs; a truth set produced after reading the model's output is a
// transcription of the answer being graded. `_meta.writtenAt` in the truth
// file and this run's timestamp are both dumped so the order is checkable
// later rather than remembered.
//
// IT GOES THROUGH THE DEPLOYED WORKER, not a local call, because the API key
// lives on the worker — `wrangler secret put`, the owner's arrangement — and
// there is none on this machine. That also makes it a reading of what is
// actually deployed rather than of what is in the working tree.
//
// THE RAW RESPONSE IS DUMPED BEFORE ANYTHING IS COMPARED. If the comparison
// code is wrong, the evidence still exists; if the response is surprising, it
// can be read directly rather than through a scorer's summary.
//
// NO PROMPT EDITS ON THE STRENGTH OF THIS WITHOUT SAYING SO. One card is one
// card. A per-field table over a single document is a description of that
// document, not an accuracy rate, and tuning against it is tuning against one
// photograph.
//
//   node -r dotenv/config scripts/cdl-accuracy.mjs corpus/cdl/<card>.jpg
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const EMAIL = process.env.VERIFY_EMAIL ?? process.env.SEED_OWNER_EMAIL
const PASSWORD = process.env.VERIFY_PASSWORD ?? process.env.SEED_OWNER_PASSWORD
const CARD = process.argv[2]

if (!CARD || !EMAIL || !PASSWORD) {
  console.error('Needs a card path, and VERIFY_EMAIL / VERIFY_PASSWORD.')
  process.exit(1)
}

const truthPath = CARD.replace(/\.[^.]+$/, '.truth.json')
const truth = JSON.parse(readFileSync(truthPath, 'utf8'))
const { _meta, _traps, ...expected } = truth

const bytes = readFileSync(CARD)
console.log(`card   ${CARD} (${bytes.length} bytes)`)
console.log(`truth  ${truthPath}, written ${_meta?.writtenAt ?? '(undated)'}`)
console.log(`target ${BASE}\n`)

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)

try {
  const page = await (await browser.newContext()).newPage()

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })

  // POSTED FROM INSIDE THE PAGE so the session cookie rides along, which is
  // the same path the drop zone takes.
  const answer = await page.evaluate(
    async ({ b64, name }) => {
      const binary = atob(b64)
      const array = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i)
      const body = new FormData()
      body.append('file', new File([array], name, { type: 'image/jpeg' }))
      const response = await fetch('/api/cdl/read', { method: 'POST', body })
      return { status: response.status, text: await response.text() }
    },
    { b64: bytes.toString('base64'), name: basename(CARD) },
  )

  mkdirSync('corpus/.extractions', { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dump = `corpus/.extractions/${basename(CARD, '.jpg')}-${stamp}.json`
  writeFileSync(
    dump,
    JSON.stringify(
      { ranAt: new Date().toISOString(), base: BASE, card: CARD, answer },
      null,
      2,
    ),
  )
  console.log(`raw response dumped to ${dump}`)
  console.log(`http ${answer.status}\n`)

  let parsed
  try {
    parsed = JSON.parse(answer.text)
  } catch {
    console.log('The response was not JSON. Read the dump.')
    process.exit(3)
  }

  if (parsed.notice) {
    console.log(`REFUSED: ${parsed.notice}`)
    console.log('No per-field table — a refusal is not a partial reading.')
    process.exit(3)
  }

  const fields = parsed.fields ?? {}
  const same = (a, b) =>
    Array.isArray(a) || Array.isArray(b)
      ? JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
      : a === b

  console.log('field           confidence  match  read / expected')
  console.log('-'.repeat(78))

  let right = 0
  const total = Object.keys(expected).length
  for (const [key, want] of Object.entries(expected)) {
    const field = fields[key]
    const got = field?.value ?? null
    const confidence = field?.confidence ?? '—'
    const ok = same(got, want)
    if (ok) right++
    console.log(
      `${key.padEnd(15)} ${String(confidence).padEnd(11)} ${(ok ? 'ok' : 'MISS').padEnd(6)} ` +
        `${JSON.stringify(got)}${ok ? '' : ` / ${JSON.stringify(want)}`}`,
    )
  }

  console.log('-'.repeat(78))
  console.log(`${right}/${total} fields match the truth set.`)
  console.log('MACHINE-DRAFTED, HUMAN-CONFIRMED — the truth set was drafted by')
  console.log('reading the image and then checked field by field against the')
  console.log('card by the owner. Quote it that way wherever it is quoted.')

  // THE TRAP, BY NAME. A licence number that came back as the document
  // discriminator is a specific, nameable failure — not a generic miss — and
  // it is the one this contract was written to prevent.
  const trap = _traps?.['5DD']
  if (trap) {
    const read = fields.licenceNumber?.value ?? null
    console.log(
      read === trap
        ? `\n5DD TRAP: FAILED — licenceNumber came back as the document discriminator (${trap}).`
        : `\n5DD TRAP: avoided — licenceNumber is not the discriminator (${trap}).`,
    )
  }

  const temp = fields.isTemporary?.value
  console.log(
    `isTemporary: ${JSON.stringify(temp)} (confidence ${fields.isTemporary?.confidence ?? '—'}), truth ${JSON.stringify(expected.isTemporary)}`,
  )
} finally {
  await browser.close()
}

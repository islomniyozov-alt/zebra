import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import {
  documentType,
  mimeTypeOf,
  readDocument,
  signIn,
} from './document-types.mjs'

// ---------------------------------------------------------------------------
// ONE DOCUMENT, READ BY THE DEPLOYED WORKER, GRADED AGAINST A TRUTH SET THAT
// EXISTED FIRST.
//
//   node -r dotenv/config scripts/doc-accuracy.mjs <cdl|med> <path>
//
// THE ORDER IS THE METHOD. The truth file is written and confirmed before this
// runs; a truth set produced after reading the model's output is a
// transcription of the answer being graded. `_meta.writtenAt` and this run's
// timestamp are both dumped so the order is checkable later rather than
// remembered.
//
// IT GOES THROUGH THE DEPLOYED WORKER, because the API key lives there —
// `wrangler secret put`, the owner's arrangement — and there is none on this
// machine. That also makes it a reading of what is deployed rather than of the
// working tree.
//
// THE RAW RESPONSE IS DUMPED BEFORE ANYTHING IS COMPARED. If the comparison is
// wrong the evidence survives; if the response is surprising it can be read
// directly rather than through a scorer's summary.
//
// NO PROMPT EDITS ON THE STRENGTH OF THIS WITHOUT SAYING SO. One document is
// one document. A per-field table over a single card describes that card, not
// an accuracy rate, and tuning against it is tuning against one photograph.
// `doc-variance.mjs` is the other half: a single read cannot tell a stable
// field from an unstable one.
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const EMAIL = process.env.VERIFY_EMAIL ?? process.env.SEED_OWNER_EMAIL
const PASSWORD = process.env.VERIFY_PASSWORD ?? process.env.SEED_OWNER_PASSWORD
const KIND = process.argv[2]
const CARD = process.argv[3]

// WHICH ENGINE, defaulting to whatever the worker is configured for.
//
//   node -r dotenv/config scripts/doc-accuracy.mjs cdl <card> \
//     --model deepseek-v4-flash-vision-exp
//
// The route allowlists it against ALLOWED_MODELS, so a typo is a 400 rather
// than a column of a comparison table quietly answered by the default. That
// matters more here than anywhere: the point of naming an engine is that the
// number underneath it belongs to that engine.
const argv = process.argv.slice(4)
const MODEL = argv.includes('--model')
  ? argv[argv.indexOf('--model') + 1]
  : null

if (!KIND || !CARD || !EMAIL || !PASSWORD) {
  console.error(
    'Usage: node -r dotenv/config scripts/doc-accuracy.mjs <cdl|med> <path>',
  )
  console.error('Needs VERIFY_EMAIL and VERIFY_PASSWORD (or the SEED_OWNER_*).')
  process.exit(1)
}

const type = documentType(KIND)

const truthPath = CARD.replace(/\.[^.]+$/, '.truth.json')
let truth
try {
  truth = JSON.parse(readFileSync(truthPath, 'utf8'))
} catch {
  console.error(`No truth file at ${truthPath}.`)
  console.error(
    'It is written and confirmed BEFORE this runs — a truth set drafted after\n' +
      'reading the output is a transcription of the answer being graded.',
  )
  process.exit(1)
}
const { _meta, _traps, ...expected } = truth

const bytes = readFileSync(CARD)
console.log(`document ${type.label}`)
console.log(`card     ${CARD} (${bytes.length} bytes as ${mimeTypeOf(CARD)})`)
console.log(`truth    ${truthPath}, written ${_meta?.writtenAt ?? '(undated)'}`)
console.log(`target   ${BASE}${type.route}`)
console.log(`model    ${MODEL ?? "(the worker's configured default)"}\n`)

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)

try {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, BASE, EMAIL, PASSWORD)
  const answer = await readDocument(page, type, bytes, basename(CARD), MODEL)

  mkdirSync('corpus/.extractions', { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dump = `corpus/.extractions/${basename(CARD, extname(CARD))}-${stamp}.json`
  writeFileSync(
    dump,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        base: BASE,
        kind: KIND,
        card: CARD,
        // WHICH ENGINE PRODUCED THIS, in the dump rather than only in the
        // terminal. A comparison read back next month from two files must not
        // depend on somebody remembering which window was which.
        model: MODEL,
        answer,
      },
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

  console.log('field                confidence  match  read / expected')
  console.log('-'.repeat(84))

  let right = 0
  const total = Object.keys(expected).length
  for (const [key, want] of Object.entries(expected)) {
    const field = fields[key]
    // A code list is an array of envelopes; a truth file states the codes.
    const got = Array.isArray(field)
      ? field.map((entry) => entry?.value ?? null)
      : (field?.value ?? null)
    const confidence = Array.isArray(field)
      ? field.map((entry) => entry?.confidence ?? '—').join('+')
      : (field?.confidence ?? '—')
    const ok = same(got, want)
    if (ok) right++
    console.log(
      `${key.padEnd(20)} ${String(confidence).padEnd(11)} ${(ok ? 'ok' : 'MISS').padEnd(6)} ` +
        `${JSON.stringify(got)}${ok ? '' : ` / ${JSON.stringify(want)}`}`,
    )
  }

  console.log('-'.repeat(84))
  console.log(`${right}/${total} fields match the truth set.`)

  // ── FIELDS THE CONTRACT MUST NOT HAVE RETURNED AT ALL ──────────────────
  //
  // The medical certificate excludes health information in four places — the
  // prompt, the type, the schema and `additionalProperties: false`. This is
  // the fifth: whatever a real card actually produced. A truth file lists the
  // keys under `_meta.forbidden`, and one appearing here is worth more than
  // the accuracy figure.
  const forbidden = _meta?.forbidden ?? []
  if (forbidden.length > 0) {
    const leaked = forbidden.filter((key) => key in fields)
    console.log(
      leaked.length === 0
        ? `\nEXCLUSIONS HELD: none of ${forbidden.length} forbidden field(s) came back.`
        : `\nEXCLUSION BREACHED — the response carried ${leaked.join(', ')}. Read the dump.`,
    )
  }

  // ── THE TRAPS, BY NAME ─────────────────────────────────────────────────
  //
  // A wrong grab that is SPECIFIC and nameable, rather than a generic miss:
  // a licence number that came back as the document discriminator, a registry
  // number that is really the phone. `_traps` is `{ field: {notValue, why} }`.
  //
  // THE OLDER `{"5DD": "..."}` SHAPE IS STILL READ, because the Florida truth
  // file uses it and was confirmed field by field against the card by hand.
  // Rewriting somebody's verified artefact to suit a refactor is not a
  // refactor.
  const traps = { ..._traps }
  if (typeof traps['5DD'] === 'string') {
    traps.licenceNumber = { notValue: traps['5DD'], why: traps.why }
  }
  for (const [key, trap] of Object.entries(traps)) {
    if (!trap || typeof trap !== 'object' || !('notValue' in trap)) continue
    const read = Array.isArray(fields[key])
      ? JSON.stringify(fields[key].map((e) => e?.value ?? null))
      : (fields[key]?.value ?? null)
    console.log(
      read === trap.notValue
        ? `\nTRAP ${key}: FAILED — came back as ${JSON.stringify(trap.notValue)}.` +
            (trap.why ? `\n  ${trap.why}` : '')
        : `\nTRAP ${key}: avoided — not ${JSON.stringify(trap.notValue)}.`,
    )
  }

  console.log(
    '\nONE DOCUMENT IS ONE DOCUMENT. Run doc-variance.mjs before reading a',
  )
  console.log('stable field into any of these numbers.')
} finally {
  await browser.close()
}

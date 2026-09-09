import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { documentType, readDocument, signIn } from './document-types.mjs'

// ---------------------------------------------------------------------------
// ONE DOCUMENT, READ BY THE DEPLOYED WORKER, PRINTED IN FULL.
//
//   node -r dotenv/config scripts/doc-read.mjs <cdl|med|coi> <path>
//
// ── THE THIRD QUESTION, AND IT IS NOT A MEASUREMENT ──────────────────────
//
// `doc-accuracy.mjs` asks "is it right" and needs a truth file that existed
// first. `doc-variance.mjs` asks "is it stable" and needs several runs. This
// asks "WHAT DID IT SAY", once, and grades nothing — which is the honest tool
// for a document nobody has written a truth set for yet, and the wrong tool
// for any claim about accuracy.
//
// SO IT REFUSES TO SCORE. There is no comparison here and there must not be
// one: the moment this printed a percentage, somebody would read the answer it
// was given as the answer it should have given. The reader of this output
// holds the document.
//
// IT GOES THROUGH THE DEPLOYED WORKER, because the API key lives there —
// `wrangler secret put`, the owner's arrangement — and there is none on this
// machine. That also makes it a reading of what is deployed rather than of the
// working tree, which is worth knowing when the two differ.
//
// THE RAW RESPONSE IS DUMPED BESIDE THE SUMMARY. A summary is a reading of a
// reading; the file is what actually came back.
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const EMAIL = process.env.VERIFY_EMAIL ?? process.env.SEED_OWNER_EMAIL
const PASSWORD = process.env.VERIFY_PASSWORD ?? process.env.SEED_OWNER_PASSWORD
const KIND = process.argv[2]
const DOC = process.argv[3]

if (!KIND || !DOC || !EMAIL || !PASSWORD) {
  console.error(
    'Usage: node -r dotenv/config scripts/doc-read.mjs <cdl|med|coi> <path>',
  )
  console.error('Needs VERIFY_EMAIL and VERIFY_PASSWORD (or the SEED_OWNER_*).')
  process.exit(1)
}

const type = documentType(KIND)
const bytes = readFileSync(DOC)

const browser = await chromium.launch()
const page = await browser.newPage()

let response
try {
  await signIn(page, BASE, EMAIL, PASSWORD)
  response = await readDocument(page, type, bytes, basename(DOC))
} finally {
  await browser.close()
}

mkdirSync('.extractions', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dump = `.extractions/${KIND}-${basename(DOC).replace(/\.[^.]+$/, '')}-${stamp}.json`
writeFileSync(
  dump,
  JSON.stringify(
    { readAt: new Date().toISOString(), base: BASE, document: DOC, response },
    null,
    2,
  ),
)

console.log(`${type.label} — ${DOC}`)
console.log(`read by ${BASE} at ${new Date().toISOString()}`)
console.log(`HTTP ${response.status}`)
console.log(`raw response: ${dump}`)
console.log('')

let payload
try {
  payload = JSON.parse(response.text)
} catch {
  console.log(response.text.slice(0, 4000))
  process.exit(response.status === 200 ? 0 : 1)
}

console.log(JSON.stringify(payload, null, 2))

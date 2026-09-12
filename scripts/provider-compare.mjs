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
// TWO ENGINES, THE SAME CARDS, ONE TABLE PER CARD.
//
//   node -r dotenv/config scripts/provider-compare.mjs \
//     --card cdl:corpus/cdl/fl-classa-temp-01.jpg \
//     --card cdl:corpus/cdl/ga-classam-01.jpg \
//     --card med:corpus/med/med-mcsa5876-01.jpg \
//     --model gemini-3.6-flash --model deepseek-v4-flash-vision-exp
//
// ── WHY THIS EXISTS BESIDE `doc-accuracy.mjs` RATHER THAN INSIDE IT ───────
//
// `doc-accuracy.mjs` answers "is this engine right about this card" and prints
// a per-field table for a person to read. The provider question is different:
// it is a COMPARISON, and a comparison assembled by hand from six terminal
// windows is a comparison whose rows can be mismatched by whoever assembles
// it. Same truth file, same scoring, same route — one table.
//
// IT REUSES `doc-accuracy`'s RULES RATHER THAN RESTATING THEM. The truth set
// is refused if absent, the raw response is dumped before anything is
// compared, forbidden keys are checked, and traps are named. A second scorer
// that drifted from the first would produce two accuracy numbers for the same
// card and no way to tell which was wrong.
//
// ONE READ PER ENGINE PER CARD. A single read is one sample of a
// non-deterministic reader — `doc-variance.mjs` is the instrument for
// stability, and nothing here should be read as one.
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const EMAIL = process.env.VERIFY_EMAIL ?? process.env.SEED_OWNER_EMAIL
const PASSWORD = process.env.VERIFY_PASSWORD ?? process.env.SEED_OWNER_PASSWORD

const argv = process.argv.slice(2)
const many = (flag) =>
  argv.reduce(
    (found, value, index) =>
      value === flag ? [...found, argv[index + 1]] : found,
    [],
  )

const CARDS = many('--card')
const MODELS = many('--model')

if (CARDS.length === 0 || MODELS.length === 0 || !EMAIL || !PASSWORD) {
  console.error(
    'Usage: node -r dotenv/config scripts/provider-compare.mjs \\\n' +
      '  --card <kind>:<path> [--card ...] --model <name> [--model ...]',
  )
  console.error('Needs VERIFY_EMAIL and VERIFY_PASSWORD (or the SEED_OWNER_*).')
  process.exit(1)
}

const same = (a, b) =>
  Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
    : a === b

/** The value a truth file states, out of whatever envelope the field is in. */
const valueOf = (field) =>
  Array.isArray(field)
    ? field.map((entry) => entry?.value ?? null)
    : (field?.value ?? null)

const pad = (text, width) => String(text).padEnd(width)

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)

const runs = []

try {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, BASE, EMAIL, PASSWORD)

  for (const entry of CARDS) {
    const [kind, ...rest] = entry.split(':')
    const card = rest.join(':')
    const type = documentType(kind)

    const truthPath = card.replace(/\.[^.]+$/, '.truth.json')
    let truth
    try {
      truth = JSON.parse(readFileSync(truthPath, 'utf8'))
    } catch {
      console.error(`No truth file at ${truthPath}. Refusing to score.`)
      process.exit(1)
    }
    const { _meta, _traps, ...expected } = truth
    const bytes = readFileSync(card)

    console.log(`\n${'='.repeat(78)}`)
    console.log(`${basename(card)} — ${type.label}`)
    console.log(
      `truth ${truthPath}, written ${_meta?.writtenAt ?? '(undated)'} by ${_meta?.writtenBy ?? '(unrecorded)'}`,
    )
    console.log(`${bytes.length} bytes as ${mimeTypeOf(card)}`)
    console.log('='.repeat(78))

    const answers = {}
    for (const model of MODELS) {
      const started = Date.now()
      const answer = await readDocument(
        page,
        type,
        bytes,
        basename(card),
        model,
      )
      const elapsed = Date.now() - started

      mkdirSync('corpus/.extractions', { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const dump = `corpus/.extractions/compare-${basename(card, extname(card))}-${model}-${stamp}.json`
      writeFileSync(
        dump,
        JSON.stringify(
          {
            ranAt: new Date().toISOString(),
            base: BASE,
            kind,
            card,
            model,
            elapsed,
            answer,
          },
          null,
          2,
        ),
      )

      let parsed = null
      try {
        parsed = JSON.parse(answer.text)
      } catch {
        /* left null — reported as such below */
      }
      answers[model] = { answer, parsed, elapsed, dump }
    }

    // ── THE PER-FIELD TABLE, ENGINES SIDE BY SIDE ────────────────────────
    const width = Math.max(
      22,
      ...Object.keys(expected).map((k) => k.length + 2),
    )
    const colWidth = 34
    console.log(
      '\n' +
        pad('field', width) +
        MODELS.map((m) => pad(m.slice(0, colWidth - 2), colWidth)).join(''),
    )
    console.log('-'.repeat(width + colWidth * MODELS.length))

    const score = Object.fromEntries(MODELS.map((m) => [m, 0]))
    for (const [key, want] of Object.entries(expected)) {
      const cells = MODELS.map((model) => {
        const fields = answers[model].parsed?.fields ?? {}
        const got = valueOf(fields[key])
        const ok = same(got, want)
        if (ok) score[model]++
        const confidence = Array.isArray(fields[key])
          ? fields[key].map((e) => e?.confidence ?? '—').join('+')
          : (fields[key]?.confidence ?? '—')
        return pad(
          `${ok ? 'ok  ' : 'MISS'} ${JSON.stringify(got)} ${ok ? '' : `[${confidence}]`}`.slice(
            0,
            colWidth - 1,
          ),
          colWidth,
        )
      })
      console.log(pad(key, width) + cells.join(''))
    }
    console.log('-'.repeat(width + colWidth * MODELS.length))
    const total = Object.keys(expected).length
    console.log(
      pad('MATCHED', width) +
        MODELS.map((m) => pad(`${score[m]}/${total}`, colWidth)).join(''),
    )
    console.log(
      pad('seconds', width) +
        MODELS.map((m) =>
          pad((answers[m].elapsed / 1000).toFixed(1), colWidth),
        ).join(''),
    )

    // ── WHAT THE TRUTH FILE COULD NOT STATE ──────────────────────────────
    //
    // Reported rather than graded. A field the truth set calls unreadable is
    // one nobody can score, and printing the engines' answers beside each
    // other is the only honest thing to do with it.
    for (const key of Object.keys(_meta?.unreadable ?? {})) {
      console.log(
        pad(`(${key})`, width) +
          MODELS.map((m) =>
            pad(
              `not graded ${JSON.stringify(valueOf((answers[m].parsed?.fields ?? {})[key]))}`.slice(
                0,
                colWidth - 1,
              ),
              colWidth,
            ),
          ).join(''),
      )
    }

    // ── THE EXCLUSIONS, WHICH OUTRANK THE ACCURACY FIGURE ────────────────
    const forbidden = _meta?.forbidden ?? []
    if (forbidden.length > 0) {
      for (const model of MODELS) {
        const fields = answers[model].parsed?.fields ?? {}
        const leaked = forbidden.filter((key) => key in fields)
        console.log(
          leaked.length === 0
            ? `exclusions  ${model}: HELD — none of ${forbidden.length} forbidden field(s) came back.`
            : `exclusions  ${model}: BREACHED — ${leaked.join(', ')}. Read the dump.`,
        )
      }
    }

    // ── THE TRAPS, BY NAME ───────────────────────────────────────────────
    for (const [key, trap] of Object.entries(_traps ?? {})) {
      if (!trap || typeof trap !== 'object' || !('notValue' in trap)) continue
      for (const model of MODELS) {
        const fields = answers[model].parsed?.fields ?? {}
        const read = valueOf(fields[key])
        console.log(
          read === trap.notValue
            ? `trap ${key}  ${model}: FAILED — came back as ${JSON.stringify(trap.notValue)}.`
            : `trap ${key}  ${model}: avoided.`,
        )
      }
    }

    for (const model of MODELS) {
      const { answer, parsed, dump } = answers[model]
      if (answer.status !== 200) {
        console.log(
          `\n${model}: HTTP ${answer.status} — ${answer.text.slice(0, 300)}`,
        )
      } else if (parsed === null) {
        console.log(`\n${model}: the response was not JSON. ${dump}`)
      } else if (parsed.notice) {
        console.log(`\n${model}: REFUSED — ${parsed.notice}`)
      }
      runs.push({ card: basename(card), kind, model, dump })
    }
  }
} finally {
  await browser.close()
}

console.log('\nONE READ PER ENGINE PER CARD. These readers are not')
console.log('deterministic — doc-variance.mjs is the instrument for stability,')
console.log('and nothing above should be read as one.')
console.log('\nDumps:')
for (const run of runs) console.log(`  ${run.dump}`)

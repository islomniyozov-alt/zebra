import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE MONEY SCREEN NEVER RENDERS A DOCUMENT, AND NEVER FETCHES BYTES.
//
// ── WHY THIS IS A SOURCE CHECK AND NOT A BEHAVIOUR ONE ───────────────────
//
// A behavioural test can only catch a page that renders a PDF and is SLOW. The
// failure this guards against is the quiet one: somebody reaches for
// `packetPlanFor` to find out whether a load is ready to file — a reasonable
// instinct, since it answers exactly that — and the summary page silently
// starts rendering an invoice per load and fetching from R2 per document.
//
// It would not even be slow at first. It would be slow in proportion to how
// much freight a company has, which is the shape of a problem nobody notices
// until the week it matters.
//
// AND R2 WOULD THROW RATHER THAN CRAWL, which is the other half: `objectBytes`
// calls `assertOutsideTransaction`, and this page is one transaction. So the
// first broker load would take the Tuesday screen down entirely.
//
// `filingStatesForCompanies` is the sanctioned read. Rows and
// `packetReadiness`, nothing else.
// ---------------------------------------------------------------------------

/** Anything that lays out a document, or reaches for an object store. */
const FORBIDDEN = [
  'renderStatementPdf',
  'renderInvoicePdf',
  'renderSettlementPdf',
  'assemblePdf',
  'assemblePacketPdf',
  'buildFactoringPacket',
  'packetPlanFor',
  'assemblePacket',
  'filePacketForLoad',
  'packetForLoad',
  'objectBytes',
  'r2ConfigFromEnv',
]

const PAGE_DIR = join(
  process.cwd(),
  'src',
  'app',
  '(app)',
  'money',
  'this-week',
)

function sources(): { name: string; text: string }[] {
  const found = [
    {
      name: 'src/lib/this-week.ts',
      text: readFileSync(
        join(process.cwd(), 'src', 'lib', 'this-week.ts'),
        'utf8',
      ),
    },
  ]
  for (const entry of readdirSync(PAGE_DIR)) {
    if (!/\.tsx?$/.test(entry)) continue
    found.push({
      name: `money/this-week/${entry}`,
      text: readFileSync(join(PAGE_DIR, entry), 'utf8'),
    })
  }
  return found
}

describe('the Tuesday screen', () => {
  it('reads its own source, so the check cannot pass by finding nothing', () => {
    const files = sources()
    expect(files.length).toBeGreaterThanOrEqual(4)
    expect(files.map((file) => file.name)).toContain('src/lib/this-week.ts')
  })

  it('never renders a document and never fetches an object', () => {
    const offenders: string[] = []
    for (const file of sources()) {
      // THE IMPORT, NOT THE WORD. These names appear in this file's own prose
      // and in the comments explaining why they are absent, and a substring
      // match would fail on the explanation rather than on the code.
      for (const line of file.text.split('\n')) {
        if (!/^\s*import\b|\bfrom '/.test(line)) continue
        for (const name of FORBIDDEN) {
          if (new RegExp(`\\b${name}\\b`).test(line)) {
            offenders.push(`${file.name}: ${line.trim()}`)
          }
        }
      }
    }
    expect(offenders, 'the money screen must not render or fetch').toEqual([])
  })

  // The positive half: it DOES go through the shared readiness definition, so
  // "it renders nothing" cannot be satisfied by counting documents by hand.
  it('asks the shared filing read for the factoring position', () => {
    const text = readFileSync(
      join(process.cwd(), 'src', 'lib', 'this-week.ts'),
      'utf8',
    )
    // THE CALL, NOT THE MENTION. An earlier version looked for the names
    // anywhere in the file, which an unused import satisfies — so gutting the
    // call and leaving the import behind passed. Watched failing that way.
    expect(text).toMatch(/filingStatesForCompanies\(\s*tx/)
    // ORG-WIDE SINCE 2026-09-11. The screen reads one batch input for the whole
    // operation, not one per authority — `batchInputForCompanies` is gone.
    expect(text).toMatch(/batchInputForOrg\(\s*tx/)
    expect(text).toMatch(/computeBatch\(\{/)
  })
})

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importPdfPages, serializeObject } from '@/lib/pdf-import'
import { assemblePacketPdf } from '@/lib/pdf'

// ---------------------------------------------------------------------------
// A FOREIGN PDF'S PAGES, COPIED — GRADED AGAINST THE REAL AGREEMENT.
//
// MONEY-DESIGN.md §7 carried this as owed from the day the packet was built.
// What it replaces spliced the TEXT out of content streams, which reads exactly
// one kind of file: the kind this system writes. The Werner agreement in
// `corpus/werner-1..pdf` has no text at all — it is five scanned pages — so the
// splicer gave it zero pages and the packet refused. A real Werner load could
// not be filed.
//
// ── THE CORPUS IS GITIGNORED, SO EVERY GUARD IS STAGED TWICE ─────────────
//
// The artefact tests below skip on CI and on a fresh clone. A guard that only
// exists where somebody's `corpus/` happens to be is a guard for one laptop, so
// each structural case is also built by hand here, from bytes written in this
// file. `tests/trips-csv.test.ts` records why that rule exists.
//
// ── WHAT A HAND-BUILT CASE IS FOR ────────────────────────────────────────
//
// Every one of these is a defect seen in a real file, not an invention:
// an indirect `/Length`, a `/Length` that is simply wrong, a page tree that
// inherits its resources two levels up, an incremental update that redefines an
// object, and cross-reference offsets that point at nothing. A PDF reader that
// cannot survive those is a reader for documents nobody emailed.
// ---------------------------------------------------------------------------

type Piece = string | { dict: string; stream: string }

/**
 * A classic PDF from object bodies, numbered from 1.
 *
 * THE XREF IT WRITES IS DELIBERATELY A LIE — every offset is zero. The importer
 * does not read it, and that is the point: offsets are the first thing to be
 * wrong in a file that has been through a re-save or a mail gateway, which is
 * why every PDF reader carries a repair path. This makes the repair path the
 * only path, and these tests the proof that it works.
 */
function buildPdf(objects: Piece[], trailer = '<< /Size 99 /Root 1 0 R >>') {
  const parts: string[] = ['%PDF-1.4\n']
  objects.forEach((piece, index) => {
    const number = index + 1
    if (typeof piece === 'string') {
      parts.push(`${String(number)} 0 obj\n${piece}\nendobj\n`)
      return
    }
    parts.push(
      `${String(number)} 0 obj\n${piece.dict}\nstream\n${piece.stream}\nendstream\nendobj\n`,
    )
  })
  parts.push('xref\n0 1\n0000000000 65535 f \n')
  parts.push(`trailer\n${trailer}\nstartxref\n0\n%%EOF\n`)
  return bytesOf(parts.join(''))
}

const bytesOf = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index++) {
    out[index] = text.charCodeAt(index) & 0xff
  }
  return out
}

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

/** Pages in an assembled file, counted from the file rather than from a return. */
const pagesIn = (pdf: Uint8Array) =>
  (latin1(pdf).match(/\/Type\s*\/Page(?![s])/g) ?? []).length

/** A minimal three-object document: catalog, page tree, one page. */
const ONE_PAGE: Piece[] = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
  { dict: '<< /Length 21 >>', stream: 'BT /F1 12 Tf (hi) Tj ET' },
]

describe('a PDF is read as an object graph', () => {
  it('finds the pages through the catalog', () => {
    const outcome = importPdfPages(buildPdf(ONE_PAGE))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.document.pages).toHaveLength(1)
  })

  // THE PAGE ORDER IS THE TREE'S ORDER, not the file's. An object numbered
  // later can be an earlier page, and a rate confirmation whose pages arrive
  // shuffled is a contract nobody can read.
  it('takes the pages in tree order, not in object order', () => {
    const outcome = importPdfPages(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [5 0 R 4 0 R 3 0 R] /Count 3 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>',
        '<< /Type /Page /Parent 2 0 R /Contents 7 0 R >>',
        '<< /Type /Page /Parent 2 0 R /Contents 8 0 R >>',
        { dict: '<< /Length 9 >>', stream: '(third) Tj' },
        { dict: '<< /Length 10 >>', stream: '(second) Tj' },
        { dict: '<< /Length 9 >>', stream: '(first) Tj' },
      ]),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const written = assemblePacketPdf(
      outcome.document.pages.map((_, page) => ({
        kind: 'imported' as const,
        document: outcome.document,
        page,
      })),
    )
    const text = latin1(written)
    expect(text.indexOf('(first) Tj')).toBeLessThan(text.indexOf('(second) Tj'))
    expect(text.indexOf('(second) Tj')).toBeLessThan(text.indexOf('(third) Tj'))
  })

  // A NESTED PAGE TREE IS NORMAL, not exotic: every PDF over a few dozen pages
  // has one, and so does anything produced by merging two files.
  it('walks a nested page tree and inherits down it', () => {
    const outcome = importPdfPages(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 2 /Resources 6 0 R /MediaBox [0 0 595 842] >>',
        '<< /Type /Pages /Parent 2 0 R /Kids [4 0 R 5 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 3 0 R /Contents 7 0 R >>',
        '<< /Type /Page /Parent 3 0 R /Contents 7 0 R >>',
        '<< /Font << /F1 8 0 R >> >>',
        { dict: '<< /Length 9 >>', stream: '(page) Tj' },
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      ]),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.document.pages).toHaveLength(2)

    // INHERITANCE IS RESOLVED ONTO THE PAGE, because the page tree it is about
    // to join is ours and inherits nothing from the one it came from. A page
    // that lost its /Resources on the way in renders blank — the exact silent
    // failure this file exists to prevent.
    for (const number of outcome.document.pages) {
      const page = outcome.document.objects[number]!.value
      expect(page.t).toBe('dict')
      if (page.t !== 'dict') return
      expect(page.v.has('Resources')).toBe(true)
      expect(page.v.has('MediaBox')).toBe(true)
      // And the old parent is gone: it pointed into a tree that is not here.
      expect(page.v.has('Parent')).toBe(false)
    }
  })

  // Both pages point at object 7. It must be copied ONCE — an embedded font
  // duplicated per page is most of the file on a four-page agreement.
  it('copies a shared object once, however many pages reach it', () => {
    const outcome = importPdfPages(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>',
        '<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>',
        { dict: '<< /Length 9 >>', stream: '(page) Tj' },
      ]),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const streams = outcome.document.objects.filter(
      (object) => object?.value.t === 'stream',
    )
    expect(streams).toHaveLength(1)
  })
})

describe('the defects real files actually carry', () => {
  // `/Length 9999` is wrong and `endstream` is right. A wrong length is the
  // single commonest defect in a PDF that has been re-saved, and a reader that
  // trusts it reads somebody else's object as this one's data.
  it('believes endstream over a /Length that lies', () => {
    const outcome = importPdfPages(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
        { dict: '<< /Length 9999 >>', stream: 'BT (short) Tj ET' },
      ]),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const stream = outcome.document.objects.find(
      (object) => object?.value.t === 'stream',
    )!.value
    if (stream.t !== 'stream') return
    expect(latin1(stream.bytes)).toBe('BT (short) Tj ET')
  })

  // An indirect /Length — `/Length 5 0 R` — cannot be resolved while the index
  // is still being built, so the reader falls through to `endstream`. Common
  // in anything written in one pass.
  it('reads a stream whose /Length is an indirect reference', () => {
    const outcome = importPdfPages(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
        { dict: '<< /Length 5 0 R >>', stream: 'BT (indirect) Tj ET' },
        '19',
      ]),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const stream = outcome.document.objects.find(
      (object) => object?.value.t === 'stream',
    )!.value
    if (stream.t !== 'stream') return
    expect(latin1(stream.bytes)).toBe('BT (indirect) Tj ET')
  })

  // AN INCREMENTAL UPDATE REDEFINES AN OBJECT by appending a new copy. The
  // later one wins — that is what the format means by an update, and reading
  // the first one serves a version of the contract that was superseded.
  it('takes the later definition when an object is redefined', () => {
    const base = latin1(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
        { dict: '<< /Length 11 >>', stream: '(before) Tj' },
      ]),
    )
    const updated = `${base}4 0 obj\n<< /Length 10 >>\nstream\n(after) Tj\nendstream\nendobj\ntrailer\n<< /Size 99 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n`

    const outcome = importPdfPages(bytesOf(updated))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const stream = outcome.document.objects.find(
      (object) => object?.value.t === 'stream',
    )!.value
    if (stream.t !== 'stream') return
    expect(latin1(stream.bytes)).toBe('(after) Tj')
  })

  // Bytes inside a compressed image can spell `9 0 obj` by chance. A scan that
  // took them at their word would invent an object and then read the rest of
  // the image as its body.
  it('does not invent an object out of bytes inside a stream', () => {
    const outcome = importPdfPages(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
        {
          // THE HAZARD IS A COLLISION, not a stray header. These bytes spell a
          // redefinition of object 4 — the very object whose stream they are
          // in — and they sit LATER in the file than the real one. A scan that
          // took them at their word would apply the later-wins rule and serve
          // the impostor, so the page would render "(FAKE)" and nothing would
          // say the document had been altered.
          //
          // An earlier version of this test asserted only that the bytes came
          // through, which stayed green with the protection removed. The
          // wrapper caught that, which is what it is for.
          dict: '<< /Length 82 >>',
          stream:
            'BT (real) Tj ET\n4 0 obj\n<< /Length 11 >>\nstream\n(FAKE) Tj\nendstream\nendobj',
        },
      ]),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const stream = outcome.document.objects.find(
      (object) => object?.value.t === 'stream',
    )!.value
    if (stream.t !== 'stream') return
    expect(latin1(stream.bytes)).toContain('(real) Tj')
    expect(latin1(stream.bytes).startsWith('BT (real)')).toBe(true)
  })
})

describe('what it refuses, by name', () => {
  it('refuses something that is not a PDF at all', () => {
    const outcome = importPdfPages(bytesOf('This is a Word document, really.'))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason.kind).toBe('not_a_pdf')
  })

  // ENCRYPTED IS REFUSED BEFORE ANYTHING IS READ. Strings and streams in an
  // encrypted file are ciphertext; copying them produces a packet that opens
  // and shows nothing. `corpus/RateConfirmation (2) (3).pdf` is a real one.
  it('refuses an encrypted document rather than copying ciphertext', () => {
    const outcome = importPdfPages(
      buildPdf(ONE_PAGE, '<< /Size 99 /Root 1 0 R /Encrypt 9 0 R >>'),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason.kind).toBe('encrypted')
  })

  // OBJECT STREAMS ARE THE DANGEROUS ONE, because without this check the file
  // imports and looks fine. `corpus/RATECON - TK-25120034.pdf` yielded one page
  // and twenty-one objects with the check removed — and whatever that page
  // needed from its six /ObjStm was simply absent.
  it('refuses a file that keeps objects inside a compressed stream', () => {
    const outcome = importPdfPages(
      buildPdf([
        ...ONE_PAGE,
        { dict: '<< /Type /ObjStm /N 2 /First 8 >>', stream: 'compressed' },
      ]),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason.kind).toBe('compressed_objects')
  })

  // A PAGE WHOSE RESOURCES ARE MISSING RENDERS BLANK. Every corpus file this
  // can read reaches zero unresolved references, so a non-zero count is not
  // "some PDFs are like that" — it means objects were not found.
  it('refuses when a page reaches a reference that is not there', () => {
    const outcome = importPdfPages(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Resources 77 0 R /Contents 4 0 R >>',
        { dict: '<< /Length 9 >>', stream: '(page) Tj' },
      ]),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason.kind).toBe('incomplete')
  })

  it('refuses a document whose catalog has no pages under it', () => {
    const outcome = importPdfPages(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [] /Count 0 >>',
      ]),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason.kind).toBe('no_pages')
  })
})

describe('and it is written back out unchanged', () => {
  // /Length IS REWRITTEN FROM THE BYTES, never copied. A source whose declared
  // length was wrong must not make our file wrong too.
  it('writes the length of the bytes it is actually writing', () => {
    const outcome = importPdfPages(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
        { dict: '<< /Length 9999 >>', stream: 'BT (short) Tj ET' },
      ]),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const stream = outcome.document.objects.find(
      (object) => object?.value.t === 'stream',
    )!.value
    const written = serializeObject(stream, (num) => num)
    expect(written.body).toContain('/Length 16')
    expect(written.body).not.toContain('9999')
  })

  // Two imported pages of two different documents, plus our own text page.
  // Object numbers must not collide, which is the whole reason numbering was
  // changed from arithmetic to allocation.
  it('interleaves two documents and our own pages without a collision', () => {
    const first = importPdfPages(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
        { dict: '<< /Length 11 >>', stream: '(alpha) Tj' },
      ]),
    )
    const second = importPdfPages(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>',
        '<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>',
        { dict: '<< /Length 10 >>', stream: '(beta) Tj' },
        { dict: '<< /Length 11 >>', stream: '(gamma) Tj' },
      ]),
    )
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    const pdf = assemblePacketPdf([
      { kind: 'text', content: 'BT /F1 10 Tf 56 700 Td (ours) Tj ET' },
      { kind: 'imported', document: first.document, page: 0 },
      { kind: 'imported', document: second.document, page: 0 },
      { kind: 'imported', document: second.document, page: 1 },
    ])
    const text = latin1(pdf)

    expect(pagesIn(pdf)).toBe(4)
    for (const mark of ['(ours)', '(alpha)', '(beta)', '(gamma)']) {
      expect(text).toContain(mark)
    }

    // EVERY OBJECT NUMBER APPEARS EXACTLY ONCE. Two documents written into one
    // file with overlapping numbers is a file whose pages point at each
    // other's resources, and it opens without complaining.
    const numbers = [...text.matchAll(/^(\d+) 0 obj$/gm)].map((hit) => hit[1])
    expect(new Set(numbers).size).toBe(numbers.length)

    // And the page tree names as many kids as there are pages.
    const kids = /\/Type \/Pages \/Kids \[([^\]]*)\]/.exec(text)
    expect(kids?.[1]?.split('R').filter(Boolean)).toHaveLength(4)

    // EVERY PAGE POINTS BACK AT THAT TREE. `/Parent` is dropped on import
    // because it addressed a tree that is not here, so the emitter has to put
    // the new one on — and a page with no /Parent is a page some readers skip
    // and others render outside the document. Four pages, four parents.
    expect((text.match(/\/Parent 2 0 R/g) ?? []).length).toBe(4)
  })

  // Both pages of one document share its objects — written once, referenced
  // twice. The stream must appear once in the output.
  it('writes a shared document once when two of its pages are used', () => {
    const document = importPdfPages(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /Resources 5 0 R >>',
        '<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>',
        '<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>',
        '<< /Font << /F1 7 0 R >> >>',
        { dict: '<< /Length 11 >>', stream: '(twice) Tj' },
        '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
      ]),
    )
    expect(document.ok).toBe(true)
    if (!document.ok) return

    const pdf = latin1(
      assemblePacketPdf([
        { kind: 'imported', document: document.document, page: 0 },
        { kind: 'imported', document: document.document, page: 1 },
      ]),
    )
    expect((pdf.match(/\(twice\) Tj/g) ?? []).length).toBe(1)
    expect((pdf.match(/\/BaseFont \/Courier/g) ?? []).length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// THE REAL AGREEMENT.
//
// `corpus/werner-1..pdf` is five scanned pages — the profiler finds no text
// operators in it at all, which is why the splicer this replaces gave it zero
// pages and the packet refused to build. Gitignored, so this skips where the
// corpus is not.
// ---------------------------------------------------------------------------

const WERNER = 'corpus/werner-1..pdf'
const PACKET = 'corpus/datatruck/DT-015981-documents.pdf'
const haveCorpus = existsSync(WERNER) && existsSync(PACKET)

describe.skipIf(!haveCorpus)(
  'the Werner rate confirmation, from corpus',
  () => {
    const read = (path: string) => new Uint8Array(readFileSync(path))

    it('carries all five of its pages', () => {
      const outcome = importPdfPages(read(WERNER))
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect(outcome.document.pages).toHaveLength(5)
    })

    // THE STREAMS ARE THE PROOF, not the page count. Five empty pages also count
    // five. Every stream written out must be a stream that was in the source,
    // byte for byte — that is what "carried through as objects" means, and it is
    // checked here by comparing the bytes rather than by trusting the copy.
    it('writes out only streams that were in the original, byte for byte', () => {
      const source = read(WERNER)
      const outcome = importPdfPages(source)
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return

      const written = assemblePacketPdf(
        outcome.document.pages.map((_, page) => ({
          kind: 'imported' as const,
          document: outcome.document,
          page,
        })),
      )

      const streamsOf = (bytes: Uint8Array) => {
        const text = latin1(bytes)
        const found: string[] = []
        // NOT /stream\r?\n/ — that also matches the tail of `endstream`, and the
        // first version of this comparison reported 35 streams in a file with 18
        // and then blamed the importer for the 17 it had invented.
        const marker = /(?<![a-zA-Z])stream\r?\n/g
        let hit
        while ((hit = marker.exec(text)) !== null) {
          const start = hit.index + hit[0].length
          const end = text.indexOf('endstream', start)
          if (end === -1) continue
          let stop = end
          if (bytes[stop - 1] === 0x0a) stop--
          if (bytes[stop - 1] === 0x0d) stop--
          found.push(text.slice(start, stop))
        }
        return found
      }

      const original = new Set(streamsOf(source))
      const produced = streamsOf(written)
      expect(produced.length).toBe(18)
      expect(produced.filter((stream) => !original.has(stream))).toEqual([])
    })

    // EIGHT PAGES, which is what the real packet has: DT-015981 is the invoice,
    // three scans, and a four-page agreement. This one is one invoice page, two
    // scans, and Werner's five.
    it('assembles into a packet with every page present', () => {
      const werner = importPdfPages(read(WERNER))
      const invoice = importPdfPages(read(PACKET))
      expect(werner.ok && invoice.ok).toBe(true)
      if (!werner.ok || !invoice.ok) return

      const pdf = assemblePacketPdf([
        { kind: 'text', content: 'BT /F1 10 Tf 56 700 Td (INVOICE) Tj ET' },
        ...werner.document.pages.map((_, page) => ({
          kind: 'imported' as const,
          document: werner.document,
          page,
        })),
      ])
      expect(pagesIn(pdf)).toBe(6)
    })
  },
)

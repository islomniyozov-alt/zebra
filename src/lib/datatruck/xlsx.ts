// ---------------------------------------------------------------------------
// ENOUGH XLSX TO READ A DATATRUCK EXPORT. NOT A SPREADSHEET LIBRARY.
//
// The exports arrive as .xlsx and the brief is to work from the raw file — a
// hand-cleaned CSV is a second artefact that can drift from the export it came
// from, and this session has already spent a turn on a summary that disagreed
// with its source.
//
// NO NEW DEPENDENCY. An .xlsx is a zip of XML, and zip entries are raw DEFLATE,
// which `DecompressionStream('deflate-raw')` handles — a web standard present
// in Node and on workerd. A spreadsheet library would be a large dependency
// bought for two files.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
//
// No formulas, no number formats, no dates-as-serial-numbers, no styles, no
// multiple sheets. It reads the FIRST worksheet as text and hands back rows of
// strings; everything after that is somebody else's parsing, done explicitly
// where it can be tested.
//
// THAT NARROWNESS IS THE POINT rather than a shortcut. A general reader would
// silently convert `Apr 11, 2031` into a Date in whichever timezone the
// process happens to run in — which is exactly the conversion the seed is
// required to do explicitly and state. Text in, text out.
// ---------------------------------------------------------------------------

/** A cell reference's column letters: `BC12` -> `BC`. */
function columnOf(ref: string): string {
  const match = /^([A-Z]+)/.exec(ref)
  return match ? match[1]! : ''
}

/** `A` -> 0, `Z` -> 25, `AA` -> 26. Sheets skip empty cells; rows must not. */
function columnIndex(letters: string): number {
  let index = 0
  for (const character of letters) {
    index = index * 26 + (character.charCodeAt(0) - 64)
  }
  return index - 1
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * The named entries of a zip, from its central directory.
 *
 * READ FROM THE CENTRAL DIRECTORY, not by scanning for local headers. A local
 * header may carry zeroed sizes with the real ones in a trailing data
 * descriptor, which is how a naive scanner reads a truncated entry and reports
 * a short sheet rather than an error.
 */
async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = new TextDecoder()

  let end = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('not a zip: no end-of-central-directory record')

  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const entries = new Map<string, Uint8Array>()

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('not a zip: bad central directory signature')
    }
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = text.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    )

    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(dataStart, dataStart + compressedSize)

    // 0 is stored, 8 is deflate. An export uses one or the other; anything
    // else is a file this reader should refuse rather than half-read.
    if (method === 0) entries.set(name, raw)
    else if (method === 8) entries.set(name, await inflate(raw))
    else throw new Error(`unsupported zip compression method ${method}`)

    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const unescapeXml = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    // LAST, always. Unescaping &amp; first would turn `&amp;lt;` into `<`.
    .replace(/&amp;/g, '&')

/** Every `<t>` run inside a shared-string entry, joined. */
export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((si) =>
    [...si[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => unescapeXml(t[1]!))
      .join(''),
  )
}

/**
 * A worksheet as rows of strings, empty cells included.
 *
 * EMPTY CELLS ARE PRESERVED BY POSITION. A sheet omits them entirely, so a row
 * with a blank third column arrives as two cells — and a reader that appends
 * in document order silently shifts every value left of it into the wrong
 * column. Cells are placed by their `r` reference instead.
 */
export function parseSheet(
  xml: string,
  shared: readonly string[],
  options: { trim?: boolean } = {},
): string[][] {
  // TRIMMING IS THE DEFAULT AND STAYS THE DEFAULT. Every existing caller is a
  // Datatruck seeder that wants a tidy value. The Amazon remittance reader
  // asks for `trim: false` because a header's exact spacing is part of the
  // contract it checks — a reader that tidies cannot tell a renamed column
  // from a re-spaced one.
  const trim = options.trim ?? true
  const rows: string[][] = []

  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []
    // ── A SELF-CLOSING CELL IS A CELL ───────────────────────────────────
    //
    // `<c r="A3" s="1"/>` is how a styled but empty cell is written, and this
    // pattern read `<c\b([^>]*)>([\s\S]*?)<\/c>` until 2026-09-10 — which
    // matched the self-closing tag's attributes, then ran the lazy body all
    // the way to the NEXT cell's `</c>`. The empty cell swallowed its
    // neighbour: it took the neighbour's `<v>`, lost the neighbour's `t="s"`,
    // and so wrote a raw shared-string INDEX into the grid as if it were text.
    //
    // Silent, and wrong in the worst way — `95` is a perfectly plausible cell
    // value. It never showed on a Datatruck export because those do not emit
    // empty cells at all; it corrupted every label on an Amazon remittance's
    // summary sheet, which is how it was found.
    for (const cell of row[1]!.matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const attributes = cell[1]!
      const body = cell[2] ?? ''
      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1] ?? ''
      const type = /t="([^"]+)"/.exec(attributes)?.[1]

      let value = ''
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
          .map((t) => unescapeXml(t[1]!))
          .join('')
      } else {
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1]
        if (raw !== undefined) {
          value = type === 's' ? (shared[Number(raw)] ?? '') : unescapeXml(raw)
        }
      }

      const at = reference ? columnIndex(columnOf(reference)) : cells.length
      while (cells.length < at) cells.push('')
      cells[at] = trim ? value.trim() : value
    }
    rows.push(cells)
  }
  return rows
}

/** The first worksheet of an .xlsx, as rows of trimmed strings. */
export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const entries = await unzip(bytes)
  const text = new TextDecoder()

  const sharedEntry = entries.get('xl/sharedStrings.xml')
  const shared = sharedEntry ? parseSharedStrings(text.decode(sharedEntry)) : []

  const sheetName = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()[0]
  if (!sheetName) throw new Error('no worksheet in this workbook')

  return parseSheet(text.decode(entries.get(sheetName)!), shared)
}

/** One worksheet, under the name a person sees on its tab. */
export interface NamedSheet {
  name: string
  rows: string[][]
}

/**
 * EVERY worksheet, by its tab name, untrimmed.
 *
 * ── WHY `readXlsx` COULD NOT BE REUSED ────────────────────────────────────
 *
 * It takes the first worksheet by FILE name — `xl/worksheets/sheet1.xml` —
 * which is not the first tab and need not exist. The Amazon remittances carry
 * `sheet3.xml` and `sheet4.xml`, so the "first" sheet by that rule is the
 * summary, and the detail sheet is unreachable. A workbook's tab order lives
 * in `xl/workbook.xml`, and the file each tab points at lives in the
 * relationships beside it; nothing about the file names is load-bearing.
 *
 * UNTRIMMED, because a header's exact spacing is part of the contract the
 * remittance reader checks. `readXlsx` keeps trimming for its own callers.
 */
export async function readNamedSheets(
  bytes: Uint8Array,
): Promise<NamedSheet[]> {
  const entries = await unzip(bytes)
  const text = new TextDecoder()
  const read = (name: string) => {
    const entry = entries.get(name)
    return entry ? text.decode(entry) : null
  }

  const sharedEntry = entries.get('xl/sharedStrings.xml')
  const shared = sharedEntry ? parseSharedStrings(text.decode(sharedEntry)) : []

  const targets = new Map<string, string>()
  for (const relationship of (
    read('xl/_rels/workbook.xml.rels') ?? ''
  ).matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = /Id="([^"]*)"/.exec(relationship[1]!)?.[1]
    const target = /Target="([^"]*)"/.exec(relationship[1]!)?.[1]
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, ''))
  }

  const sheets: NamedSheet[] = []
  for (const sheet of (read('xl/workbook.xml') ?? '').matchAll(
    /<sheet\b([^>]*)\/>/g,
  )) {
    const attributes = sheet[1]!
    const name = unescapeXml(/name="([^"]*)"/.exec(attributes)?.[1] ?? '')
    const id = /r:id="([^"]*)"/.exec(attributes)?.[1] ?? ''
    const target =
      targets.get(id) ?? `worksheets/sheet${String(sheets.length + 1)}.xml`
    const xml = read(`xl/${target}`)
    sheets.push({
      name,
      rows: xml ? parseSheet(xml, shared, { trim: false }) : [],
    })
  }

  if (sheets.length === 0) throw new Error('no worksheet in this workbook')
  return sheets
}

/** Rows keyed by the header row's own text, which is what the seeders read. */
export function asRecords(rows: readonly string[][]): Record<string, string>[] {
  const [header, ...body] = rows
  if (!header) return []
  return body.map((cells) => {
    const record: Record<string, string> = {}
    header.forEach((name, index) => {
      if (name) record[name] = cells[index] ?? ''
    })
    return record
  })
}

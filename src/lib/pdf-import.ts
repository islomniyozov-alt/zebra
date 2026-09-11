// ---------------------------------------------------------------------------
// A FOREIGN PDF'S PAGES, CARRIED THROUGH AS OBJECTS.
//
// MONEY-DESIGN.md §7 recorded this as owed. `contentStreamsOf` — the thing it
// replaces — read the content streams of documents THIS system wrote, spliced
// the text out, and drew it onto a fresh page. That works for exactly one kind
// of file: uncompressed, one stream per page, no fonts of its own, no images.
// A broker's rate confirmation is none of those, so it contributed no pages and
// the packet refused. A real Werner agreement could not be filed at all.
//
// ── THE PAGES ARE COPIED, NOT REDRAWN ────────────────────────────────────
//
// Re-splicing streams cannot work in general and should not be attempted: a
// page's marks depend on its resource dictionary — its fonts, its XObjects, its
// colour spaces — and a content stream pasted onto a page with different
// resources renders different marks, or none, and says nothing about it. The
// rate confirmation in a factoring packet is a CONTRACT. A version of it that
// renders differently from the one the broker sent is worse than no version.
//
// So this reads the source's object graph and copies each page's dictionary
// together with everything it reaches — resources, fonts, embedded font
// programs, images, colour spaces — renumbering references as it goes. Streams
// are carried BYTE FOR BYTE with their `/Filter` untouched. Nothing is
// inflated, nothing is re-encoded, and there is no code here that understands
// FlateDecode, because none is needed to copy a page.
//
// ── WHAT IT REFUSES, AND WHY EACH ONE IS NAMED ───────────────────────────
//
// Measured against the fifteen broker PDFs in `corpus/` on 2026-09-10:
//
//   13 of 15  classic cross-reference table, no encryption   — copied
//    1 of 15  cross-reference stream + object streams        — refused
//    1 of 15  cross-reference stream + /Encrypt              — refused
//
// `compressed_objects` is the honest name for the first: objects stored inside
// a Flate stream cannot be read without inflating it, and inflating belongs to
// a later pass — `DecompressionStream` is async, and making the whole assembly
// path async to reach one file in fifteen is a trade to make deliberately and
// not in passing. `encrypted` is the second, and decryption is a different
// promise entirely — key derivation, RC4 or AES, and a judgement about whether
// a document somebody locked should be forwarded to a factor at all.
//
// Both refuse BY NAME, and the packet refuses with them. What must never
// happen again is the silent version: a packet assembled without the agreement
// in it, five pages where the artefact has eight, and nothing said.
//
// ── THE OBJECT INDEX IS BUILT BY SCANNING, NOT FROM THE XREF ─────────────
//
// Deliberate, and the opposite of what a specification reading suggests. The
// cross-reference table is a table of byte offsets, and in files that have been
// through a mail gateway, a re-save, or an incremental update those offsets are
// the first thing to be wrong — every PDF reader in the world carries a repair
// path for exactly this. Scanning for `N G obj` is that repair path, used as
// the primary reading: it depends on the bytes rather than on a claim about
// where the bytes are.
//
// Later definitions win, which is what an incremental update means. And a
// candidate that falls inside a stream already parsed is skipped, so `5 0 obj`
// occurring by chance inside a compressed image cannot invent an object.
// ---------------------------------------------------------------------------

export type PdfValue =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  /** Raw bytes as latin1, plus how it was written. Never re-escaped. */
  | { t: 'str'; v: string; hex: boolean }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'array'; v: PdfValue[] }
  | { t: 'dict'; v: Map<string, PdfValue> }
  | { t: 'ref'; num: number; gen: number }
  | { t: 'stream'; dict: Map<string, PdfValue>; bytes: Uint8Array }

export type ImportRefusal =
  | { kind: 'not_a_pdf' }
  | { kind: 'encrypted' }
  | { kind: 'compressed_objects' }
  | { kind: 'no_catalog' }
  | { kind: 'no_pages' }
  /** A page reached references this reader could not resolve. */
  | { kind: 'incomplete'; missing: number }

/**
 * One object of an imported document, still numbered in that document's own
 * space. The emitter offsets those numbers when it writes them out.
 */
export interface ImportedObject {
  value: PdfValue
}

export interface ImportedDocument {
  /** Objects, indexed from 1. Index 0 is unused, as in a PDF. */
  objects: (ImportedObject | null)[]
  /** The page dictionaries, in document order, as object numbers. */
  pages: number[]
}

export type ImportOutcome =
  | { ok: true; document: ImportedDocument }
  | { ok: false; reason: ImportRefusal }

// ── lexing ────────────────────────────────────────────────────────────────

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20])
const DELIMITER = new Set([
  0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25,
])

class Reader {
  at = 0
  constructor(readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.at >= this.bytes.length
  }

  peek(offset = 0): number {
    return this.bytes[this.at + offset] ?? -1
  }

  /** Whitespace and `%` comments, which may appear between any two tokens. */
  skip(): void {
    for (;;) {
      while (!this.done && WHITESPACE.has(this.peek())) this.at++
      if (this.peek() !== 0x25) return
      while (!this.done && this.peek() !== 0x0a && this.peek() !== 0x0d) {
        this.at++
      }
    }
  }

  /** A run of regular characters — a number, a keyword, an operator. */
  token(): string {
    this.skip()
    const start = this.at
    while (
      !this.done &&
      !WHITESPACE.has(this.peek()) &&
      !DELIMITER.has(this.peek())
    ) {
      this.at++
    }
    return latin1(this.bytes.subarray(start, this.at))
  }

  looksLike(word: string): boolean {
    const save = this.at
    const found = this.token()
    this.at = save
    return found === word
  }
}

const latin1 = (bytes: Uint8Array): string =>
  new TextDecoder('latin1').decode(bytes)

const encodeLatin1 = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index++) {
    out[index] = text.charCodeAt(index) & 0xff
  }
  return out
}

/** A PDF name, after `/`. `#41` escapes are left exactly as written. */
function readName(reader: Reader): string {
  reader.at++ // the slash
  const start = reader.at
  while (
    !reader.done &&
    !WHITESPACE.has(reader.peek()) &&
    !DELIMITER.has(reader.peek())
  ) {
    reader.at++
  }
  return latin1(reader.bytes.subarray(start, reader.at))
}

/**
 * A literal string, kept as its RAW bytes including the escapes as written.
 *
 * NOT DECODED AND RE-ENCODED. A string in a copied object is never inspected,
 * only moved, and every decode/encode round trip is a chance to change a byte
 * in somebody's contract.
 */
function readLiteralString(reader: Reader): string {
  const start = reader.at
  reader.at++ // (
  let depth = 1
  while (!reader.done && depth > 0) {
    const byte = reader.peek()
    if (byte === 0x5c) {
      reader.at += 2
      continue
    }
    if (byte === 0x28) depth++
    if (byte === 0x29) depth--
    reader.at++
  }
  return latin1(reader.bytes.subarray(start + 1, reader.at - 1))
}

function readHexString(reader: Reader): string {
  const start = reader.at
  reader.at++ // <
  while (!reader.done && reader.peek() !== 0x3e) reader.at++
  reader.at++ // >
  return latin1(reader.bytes.subarray(start + 1, reader.at - 1))
}

/** One object, from wherever the reader is. Returns null at a structural end. */
function readValue(reader: Reader): PdfValue | null {
  reader.skip()
  if (reader.done) return null
  const byte = reader.peek()

  if (byte === 0x2f) return { t: 'name', v: readName(reader) }
  if (byte === 0x28)
    return { t: 'str', v: readLiteralString(reader), hex: false }

  if (byte === 0x3c) {
    if (reader.peek(1) === 0x3c) {
      reader.at += 2
      const dict = new Map<string, PdfValue>()
      for (;;) {
        reader.skip()
        if (reader.done) break
        if (reader.peek() === 0x3e && reader.peek(1) === 0x3e) {
          reader.at += 2
          break
        }
        if (reader.peek() !== 0x2f) {
          // A key that is not a name means the dictionary is malformed. Step
          // over one byte rather than spinning forever on it.
          reader.at++
          continue
        }
        const key = readName(reader)
        const value = readValue(reader)
        if (value === null) break
        dict.set(key, value)
      }
      return { t: 'dict', v: dict }
    }
    return { t: 'str', v: readHexString(reader), hex: true }
  }

  if (byte === 0x5b) {
    reader.at++
    const items: PdfValue[] = []
    for (;;) {
      reader.skip()
      if (reader.done) break
      if (reader.peek() === 0x5d) {
        reader.at++
        break
      }
      const value = readValue(reader)
      if (value === null) break
      items.push(value)
    }
    return { t: 'array', v: items }
  }

  if (byte === 0x5d || byte === 0x3e || byte === 0x29 || byte === 0x7d) {
    return null
  }

  const save = reader.at
  const word = reader.token()
  if (word === '') {
    reader.at = save + 1
    return null
  }
  if (word === 'true') return { t: 'bool', v: true }
  if (word === 'false') return { t: 'bool', v: false }
  if (word === 'null') return { t: 'null' }
  if (word === 'endobj' || word === 'stream' || word === 'obj') {
    reader.at = save
    return null
  }

  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
    // `12 0 R` is a reference and `12 0 obj` starts one. Both need two more
    // tokens of lookahead, and both must put the reader back if they are not
    // what they looked like — `[1 0 2]` is three numbers.
    if (/^\d+$/.test(word)) {
      const afterNumber = reader.at
      reader.skip()
      const second = reader.token()
      if (/^\d+$/.test(second)) {
        const afterGen = reader.at
        reader.skip()
        const third = reader.token()
        if (third === 'R') {
          return { t: 'ref', num: Number(word), gen: Number(second) }
        }
        reader.at = afterGen
      }
      reader.at = afterNumber
    }
    return { t: 'num', v: Number(word) }
  }

  // An operator or a keyword this does not know. Treated as null so the caller
  // moves on rather than looping.
  return { t: 'null' }
}

// ── the object index ──────────────────────────────────────────────────────

interface Indexed {
  value: PdfValue
}

const OBJECT_HEADER = /(?:^|[\s>\]])(\d+)\s+(\d+)\s+obj\b/g

function dictNumber(
  dict: Map<string, PdfValue>,
  key: string,
  resolve: (value: PdfValue | undefined) => PdfValue | undefined,
): number | null {
  const value = resolve(dict.get(key))
  return value && value.t === 'num' ? value.v : null
}

/**
 * Every object in the file, by `num gen`, found by scanning.
 *
 * Later definitions win — that is what an incremental update means — and a
 * header inside a stream already consumed is skipped, so bytes that happen to
 * spell `5 0 obj` inside a compressed image cannot invent an object.
 */
function indexObjects(bytes: Uint8Array): Map<string, Indexed> {
  const text = latin1(bytes)
  const found = new Map<string, Indexed>()
  const pending: { key: string; start: number }[] = []

  OBJECT_HEADER.lastIndex = 0
  let match
  while ((match = OBJECT_HEADER.exec(text)) !== null) {
    const headerAt = match.index + match[0].indexOf(match[1]!)
    pending.push({
      key: `${match[1]!} ${match[2]!}`,
      start: headerAt + match[0].length - match[0].indexOf(match[1]!),
    })
  }

  let consumedTo = 0
  for (const entry of pending) {
    if (entry.start < consumedTo) continue

    const reader = new Reader(bytes)
    reader.at = entry.start
    // Past `N G obj` itself: the scan matched it, the reader starts after.
    reader.skip()
    reader.token() // num
    reader.token() // gen
    reader.token() // obj

    const value = readValue(reader)
    if (value === null) continue

    reader.skip()
    if (value.t === 'dict' && reader.looksLike('stream')) {
      reader.token()
      // Exactly one EOL after the keyword, per the specification, but files
      // written by hand and by old tools disagree, so both forms are allowed.
      if (reader.peek() === 0x0d) reader.at++
      if (reader.peek() === 0x0a) reader.at++

      const start = reader.at
      const declared = dictNumber(value.v, 'Length', (candidate) => {
        if (!candidate) return undefined
        if (candidate.t === 'num') return candidate
        if (candidate.t !== 'ref') return undefined
        // AN INDIRECT /Length IS COMMON and resolving it needs the index this
        // function is still building. Rather than a second pass, fall through
        // to the endstream search below, which does not need it.
        return undefined
      })

      let end = declared === null ? -1 : start + declared
      const endsHere = (at: number) =>
        at >= start &&
        at <= bytes.length &&
        latin1(bytes.subarray(at, at + 20))
          .trimStart()
          .startsWith('endstream')

      if (end === -1 || !endsHere(end)) {
        // THE DECLARED LENGTH IS A CLAIM, `endstream` IS THE FILE. When they
        // disagree the file wins — a wrong /Length is the single most common
        // defect in PDFs that have been through a re-save.
        const marker = text.indexOf('endstream', start)
        end = marker === -1 ? bytes.length : marker
        // Back off the EOL that belongs to the keyword, not to the data.
        if (bytes[end - 1] === 0x0a) end--
        if (bytes[end - 1] === 0x0d) end--
      }

      found.set(entry.key, {
        value: {
          t: 'stream',
          dict: value.v,
          bytes: bytes.slice(start, Math.max(start, end)),
        },
      })
      consumedTo = end
      continue
    }

    found.set(entry.key, { value })
  }

  return found
}

// ── reading the document ──────────────────────────────────────────────────

/** Inheritable page attributes, per the specification's table. */
const INHERITED = ['Resources', 'MediaBox', 'CropBox', 'Rotate'] as const

/**
 * Copy each page of a PDF, with everything it reaches.
 *
 * The returned document is self-contained: its objects reference only each
 * other, numbered from 1, and every stream carries the source's bytes.
 */
export function importPdfPages(bytes: Uint8Array): ImportOutcome {
  if (bytes.length < 8 || !latin1(bytes.subarray(0, 5)).startsWith('%PDF-')) {
    return { ok: false, reason: { kind: 'not_a_pdf' } }
  }

  const text = latin1(bytes)

  // ENCRYPTION IS REFUSED BEFORE ANYTHING IS READ. Strings and streams in an
  // encrypted file are ciphertext, and copying them into a packet would
  // produce a document that opens and shows nothing.
  if (/\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(text)) {
    return { ok: false, reason: { kind: 'encrypted' } }
  }

  // OBJECT STREAMS ARE REFUSED UP FRONT, AND THE REASON IS THE WHOLE POINT OF
  // THIS FILE.
  //
  // `corpus/RATECON - TK-25120034.pdf` keeps six `/Type /ObjStm` and imports
  // WITHOUT THIS CHECK: one page, twenty-one objects, a plausible-looking
  // result. The objects inside those streams are Flate-compressed and this
  // reader cannot see them, so whatever the page needed from them — its fonts,
  // very likely — is simply absent, and the page renders blank or wrong with
  // nothing said.
  //
  // That is the exact failure §7 was written about: a packet that looks
  // complete and is not. A file that keeps ANY object in a stream is refused,
  // even though many of its objects are readable, because "many" is not a
  // claim anyone can act on.
  //
  // `/Type /XRef` alone is NOT refused: a cross-reference stream with plain
  // objects behind it is completely readable, and refusing it would turn a
  // correct import into a support call.
  if (/\/Type\s*\/ObjStm/.test(text)) {
    return { ok: false, reason: { kind: 'compressed_objects' } }
  }

  const index = indexObjects(bytes)
  const resolve = (value: PdfValue | undefined): PdfValue | undefined => {
    let current = value
    // A reference chain longer than this is a cycle, not a document.
    for (let hops = 0; hops < 32 && current?.t === 'ref'; hops++) {
      current = index.get(
        `${String(current.num)} ${String(current.gen)}`,
      )?.value
    }
    return current?.t === 'ref' ? undefined : current
  }

  const dictOf = (
    value: PdfValue | undefined,
  ): Map<string, PdfValue> | null => {
    const found = resolve(value)
    if (!found) return null
    if (found.t === 'dict') return found.v
    if (found.t === 'stream') return found.dict
    return null
  }

  // THE CATALOG, FROM THE TRAILER IF THERE IS ONE AND BY SEARCH IF NOT. A file
  // whose xref is a stream has no `trailer` keyword at all, and one that has
  // been truncated may have lost it — but the catalog object is still in the
  // bytes, and `/Type /Catalog` names it unambiguously.
  let catalog: Map<string, PdfValue> | null = null
  const trailers = [...text.matchAll(/\btrailer\b/g)].map((hit) => hit.index)
  for (const at of trailers.reverse()) {
    const reader = new Reader(bytes)
    reader.at = at + 'trailer'.length
    const value = readValue(reader)
    if (value?.t !== 'dict') continue
    const root = dictOf(value.v.get('Root'))
    if (root) {
      catalog = root
      break
    }
  }
  if (!catalog) {
    for (const entry of index.values()) {
      const dict = entry.value.t === 'dict' ? entry.value.v : null
      const type = dict?.get('Type')
      if (type?.t === 'name' && type.v === 'Catalog') {
        catalog = dict
        break
      }
    }
  }

  if (!catalog) {
    // A file with no readable catalog and object streams in it is the
    // compressed case, not a corrupt one — say which.
    return {
      ok: false,
      reason: {
        kind: /\/Type\s*\/ObjStm|\/Type\s*\/XRef/.test(text)
          ? 'compressed_objects'
          : 'no_catalog',
      },
    }
  }

  // ── the page tree, in order, with inheritance applied ──────────────────
  const leaves: {
    dict: Map<string, PdfValue>
    inherited: Map<string, PdfValue>
  }[] = []
  const walk = (
    node: Map<string, PdfValue> | null,
    inherited: Map<string, PdfValue>,
    depth: number,
  ): void => {
    if (!node || depth > 64 || leaves.length > 2048) return

    const carried = new Map(inherited)
    for (const key of INHERITED) {
      const value = node.get(key)
      if (value !== undefined) carried.set(key, value)
    }

    const kids = resolve(node.get('Kids'))
    const type = node.get('Type')
    if (kids?.t === 'array') {
      for (const kid of kids.v) walk(dictOf(kid), carried, depth + 1)
      return
    }
    if (type?.t === 'name' && type.v === 'Pages') return
    leaves.push({ dict: node, inherited: carried })
  }

  walk(dictOf(catalog.get('Pages')), new Map(), 0)

  if (leaves.length === 0) {
    return {
      ok: false,
      reason: /\/Type\s*\/ObjStm|\/Type\s*\/XRef/.test(text)
        ? { kind: 'compressed_objects' }
        : { kind: 'no_pages' },
    }
  }

  // ── the deep copy ──────────────────────────────────────────────────────
  //
  // Numbered from 1 in this document's own space. `/Parent` is never followed:
  // it points back up a tree that is not being copied, and following it would
  // drag in every other page of the source.
  const objects: (ImportedObject | null)[] = [null]
  const renumbered = new Map<string, number>()
  const dangling = new Set<string>()

  const copy = (value: PdfValue, depth: number): PdfValue => {
    if (depth > 96) return { t: 'null' }
    switch (value.t) {
      case 'ref': {
        const key = `${String(value.num)} ${String(value.gen)}`
        const already = renumbered.get(key)
        if (already !== undefined) return { t: 'ref', num: already, gen: 0 }
        const target = index.get(key)
        // A reference to an object that is not in the file is legal and means
        // null. Copying it as a dangling reference would make OUR file the
        // broken one — but it is COUNTED, because a page whose resources are
        // missing is the failure this whole file exists to make loud.
        if (!target) {
          dangling.add(key)
          return { t: 'null' }
        }
        const assigned = objects.length
        objects.push(null)
        renumbered.set(key, assigned)
        objects[assigned] = { value: copy(target.value, depth + 1) }
        return { t: 'ref', num: assigned, gen: 0 }
      }
      case 'array':
        return { t: 'array', v: value.v.map((item) => copy(item, depth + 1)) }
      case 'dict': {
        const out = new Map<string, PdfValue>()
        for (const [key, item] of value.v) {
          if (key === 'Parent') continue
          out.set(key, copy(item, depth + 1))
        }
        return { t: 'dict', v: out }
      }
      case 'stream': {
        const out = new Map<string, PdfValue>()
        for (const [key, item] of value.dict) {
          if (key === 'Parent') continue
          out.set(key, copy(item, depth + 1))
        }
        return { t: 'stream', dict: out, bytes: value.bytes }
      }
      default:
        return value
    }
  }

  const pages: number[] = []
  for (const leaf of leaves) {
    const dict = new Map<string, PdfValue>()
    for (const [key, value] of leaf.dict) {
      // `/Parent` is rewritten by the emitter, which owns the new page tree.
      if (key === 'Parent') continue
      // ANNOTATIONS ARE DROPPED. A widget annotation belongs to an /AcroForm
      // that is not being copied, and a link annotation can address a page
      // that is not in the packet. What is lost is clickability; what is kept
      // is that every page renders exactly what the broker sent.
      if (key === 'Annots') continue
      dict.set(key, copy(value, 0))
    }
    // Inherited attributes are written onto the page, because the page tree it
    // is about to join is ours and inherits nothing from its old one.
    for (const key of INHERITED) {
      if (dict.has(key)) continue
      const value = leaf.inherited.get(key)
      if (value !== undefined) dict.set(key, copy(value, 0))
    }
    if (!dict.has('MediaBox')) {
      // US Letter, which is what every document in the corpus uses and what a
      // reader assumes when a page says nothing.
      dict.set('MediaBox', {
        t: 'array',
        v: [
          { t: 'num', v: 0 },
          { t: 'num', v: 0 },
          { t: 'num', v: 612 },
          { t: 'num', v: 792 },
        ],
      })
    }
    dict.set('Type', { t: 'name', v: 'Page' })

    const number = objects.length
    objects.push({ value: { t: 'dict', v: dict } })
    pages.push(number)
  }

  // EVERY REFERENCE A PAGE REACHES MUST HAVE RESOLVED.
  //
  // Measured across the corpus on 2026-09-10: every file this can read reaches
  // ZERO dangling references — 5 pages of `werner-1..pdf`, 8 of DT-015981, 2
  // of `broker-x-1..pdf`, the three-page RCs, the two order confirmations.
  // So a non-zero count is not "some PDFs are like that"; it means this reader
  // did not find objects the document says it has, and a page missing its
  // resources renders blank.
  //
  // THE COUNT IS THE INSTRUMENT AND THE REFUSAL IS THE POINT. Assembling
  // anyway is the 2026-09-10 defect wearing a new hat.
  if (dangling.size > 0) {
    return { ok: false, reason: { kind: 'incomplete', missing: dangling.size } }
  }

  return { ok: true, document: { objects, pages } }
}

// ── writing them back out ─────────────────────────────────────────────────

/**
 * One value as PDF syntax, with references sent through `renumber`.
 *
 * Streams are NOT handled here: their bytes are binary and must be pushed to
 * the output directly. `serializeObject` returns the two halves separately.
 */
export function serializeValue(
  value: PdfValue,
  renumber: (num: number) => number,
): string {
  switch (value.t) {
    case 'num':
      return Number.isInteger(value.v)
        ? String(value.v)
        : String(Number(value.v.toFixed(6)))
    case 'name':
      return `/${value.v}`
    case 'str':
      return value.hex ? `<${value.v}>` : `(${value.v})`
    case 'bool':
      return value.v ? 'true' : 'false'
    case 'null':
      return 'null'
    case 'ref':
      return `${String(renumber(value.num))} 0 R`
    case 'array':
      return `[${value.v
        .map((item) => serializeValue(item, renumber))
        .join(' ')}]`
    case 'dict':
      return serializeDict(value.v, renumber)
    case 'stream':
      return serializeDict(value.dict, renumber)
  }
}

function serializeDict(
  dict: Map<string, PdfValue>,
  renumber: (num: number) => number,
): string {
  const parts: string[] = []
  for (const [key, value] of dict) {
    parts.push(`/${key} ${serializeValue(value, renumber)}`)
  }
  return `<< ${parts.join(' ')} >>`
}

/**
 * An imported object as the bytes to write: a body, and a stream if it has one.
 *
 * `/Length` IS REWRITTEN from the bytes actually being written, never copied.
 * A source whose declared length was wrong — the commonest defect there is —
 * must not make our file wrong too.
 */
export function serializeObject(
  value: PdfValue,
  renumber: (num: number) => number,
): { body: string; stream: Uint8Array | null } {
  if (value.t !== 'stream') {
    return { body: serializeValue(value, renumber), stream: null }
  }
  const dict = new Map(value.dict)
  dict.set('Length', { t: 'num', v: value.bytes.length })
  return { body: serializeDict(dict, renumber), stream: value.bytes }
}

/** Exposed for the tests, which read a page's dictionary back out. */
export const __testing = { indexObjects, readValue, Reader, encodeLatin1 }

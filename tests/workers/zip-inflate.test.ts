import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// CAN WORKERD OPEN AN .XLSX AT ALL? (Phase 6 §4 step 3b, feasibility.)
//
// An .xlsx is a ZIP of XML. Everything else about step 3b — which cell holds
// the appointment, how many stops a sheet lays out — waits for the corpus, but
// THIS does not: if the deployment engine cannot inflate a deflate stream, the
// whole step needs a different shape (parse in the browser, or a dependency),
// and that is a decision the owner should have before the step starts rather
// than in the middle of it.
//
// RUN INSIDE WORKERD, not Node. `zlib` exists under `nodejs_compat` and proves
// nothing about the deployed Worker's own primitives; `DecompressionStream` is
// what the runtime actually offers, and this asserts the exact constructor
// argument a ZIP needs — `deflate-raw`, headerless, which is NOT the same as
// `deflate` and is the one that would fail late and confusingly.
//
// The payload below is built by deflating in the same test, so this is a round
// trip rather than a fixture somebody has to trust.
// ---------------------------------------------------------------------------

// Typed against what the RUNTIME hands back rather than against a
// `TransformStream<Uint8Array, Uint8Array>` this environment's ambient types
// do not consider `CompressionStream` to be. The looser signature is the
// honest one: these are the platform's own stream classes, not ours.
async function through(
  stream: ReadableStream<Uint8Array>,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream
    .pipeThrough(transform as ReadableWritablePair<Uint8Array, Uint8Array>)
    .getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

const source = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })

describe('the runtime primitives an .xlsx needs', () => {
  it('offers DecompressionStream', () => {
    expect(typeof DecompressionStream).toBe('function')
  })

  // THE ONE THAT MATTERS. ZIP entries are stored with method 8 — raw DEFLATE,
  // with no zlib header and no trailing checksum. `new DecompressionStream(
  // 'deflate')` expects that header and fails on a ZIP member; 'deflate-raw'
  // is the correct argument and its absence would be the whole step's problem.
  it('round-trips a payload through deflate-raw, which is what ZIP stores', async () => {
    const text =
      '<?xml version="1.0"?><sst><si><t>Load Information</t></si></sst>'
    const original = new TextEncoder().encode(text)

    const squashed = await through(
      source(original),
      new CompressionStream('deflate-raw'),
    )
    // Worth asserting: if this were not smaller, the stream would be a
    // pass-through and the test would prove nothing.
    expect(squashed.length).toBeLessThan(original.length)

    const restored = await through(
      source(squashed),
      new DecompressionStream('deflate-raw'),
    )
    expect(new TextDecoder().decode(restored)).toBe(text)
  })

  // A sheet's XML is bigger than one chunk, so the reader has to reassemble.
  it('handles a payload larger than a single chunk', async () => {
    const text = '<c r="A1" t="s"><v>0</v></c>'.repeat(4000)
    const original = new TextEncoder().encode(text)

    const squashed = await through(
      source(original),
      new CompressionStream('deflate-raw'),
    )
    const restored = await through(
      source(squashed),
      new DecompressionStream('deflate-raw'),
    )
    expect(restored.length).toBe(original.length)
    expect(new TextDecoder().decode(restored)).toBe(text)
  })

  // The other half of reading a ZIP: finding the entries. No DOM parser is
  // needed for either — the central directory is byte offsets, which is what
  // `DataView` is for, and it is here on workerd.
  it('reads little-endian integers, which the ZIP directory is made of', () => {
    const buffer = new ArrayBuffer(4)
    new DataView(buffer).setUint32(0, 0x04034b50, true)
    expect(new DataView(buffer).getUint32(0, true)).toBe(0x04034b50)
  })
})

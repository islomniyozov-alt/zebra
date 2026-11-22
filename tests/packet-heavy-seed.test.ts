import { describe, expect, it } from 'vitest'
import { FILES, PREFIX, parseArgs } from '../scripts/packet-heavy-seed.mjs'

// ---------------------------------------------------------------------------
// The heavy-load seed for the packet probe (R9; GAPS 44): preview unless told,
// one load named, every file packet paper and marked SYNTHETIC.
// ---------------------------------------------------------------------------

describe('the heavy-load seed', () => {
  it('previews by default and takes one mode', () => {
    expect(parseArgs(['--load', '1177'])).toEqual({
      load: '1177',
      mode: 'preview',
    })
    expect(parseArgs(['--load', '1177', '--write']).mode).toBe('write')
    expect(() => parseArgs(['--load', '1177', '--write', '--remove'])).toThrow(
      /unknown argument --remove/,
    )
    expect(() => parseArgs([])).toThrow(/--load <loadNumber> is required/)
    expect(() => parseArgs(['--lod', '1'])).toThrow(/unknown argument/)
  })

  it('writes only packet paper, every name marked', () => {
    expect(PREFIX).toBe('SYNTHETIC-')
    expect(new Set(FILES.map((file) => file.type))).toEqual(
      new Set(['POD', 'BOL', 'RATE_CONFIRMATION']),
    )
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  orientationPlan,
  quarterTurnsFor,
  readExifOrientation,
} from '@/lib/image-orientation'

// ---------------------------------------------------------------------------
// AGAINST REAL JPEG BYTES, NOT A HAND-BUILT HEADER.
//
// The fixtures in `tests/fixtures/orientation` were produced by an encoder
// writing genuine EXIF — the same shape a phone writes — rather than by this
// project assembling the bytes it expects to parse. An instrument built from
// its own belief about the artefact is the failure `AGENTS.md` names twice,
// and a hand-made EXIF block would have tested the parser against the parser.
//
// WHY THIS IS GUARDED AT ALL: on 2026-09-12 a medical certificate photographed
// on its side produced four different examiner names in four reads from one
// engine, while its dates stayed stable and correct. Orientation decided
// whether the reading was a reading.
// ---------------------------------------------------------------------------

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(join(process.cwd(), 'tests/fixtures/orientation', name)),
  )

describe('the EXIF orientation a phone writes', () => {
  it('reads the three rotations, and upright', () => {
    expect(readExifOrientation(fixture('exif-1.jpg'))).toBe(1)
    expect(readExifOrientation(fixture('exif-3.jpg'))).toBe(3)
    expect(readExifOrientation(fixture('exif-6.jpg'))).toBe(6)
    expect(readExifOrientation(fixture('exif-8.jpg'))).toBe(8)
  })

  it('turns each one upright by the right number of quarter turns', () => {
    expect(quarterTurnsFor(1)).toBe(0)
    // 6 is the commonest: a phone held upright with the sensor on its side.
    expect(quarterTurnsFor(6)).toBe(1)
    expect(quarterTurnsFor(3)).toBe(2)
    expect(quarterTurnsFor(8)).toBe(3)
  })

  // NULL IS A FINDING, NOT A DEFAULT. Returning 1 for a file with no tag would
  // be a guess dressed as a reading — and it is exactly the guess that sends an
  // unrotated card to an engine.
  it('says nothing rather than assuming upright when there is no tag', () => {
    expect(readExifOrientation(fixture('exif-none.jpg'))).toBeNull()
    expect(readExifOrientation(fixture('plain.png'))).toBeNull()
  })

  it('survives bytes that are not an image, and never throws', () => {
    expect(readExifOrientation(new Uint8Array([]))).toBeNull()
    expect(readExifOrientation(new Uint8Array([0xff, 0xd8]))).toBeNull()
    // A JPEG header with a length that runs past the end of the buffer — the
    // shape a truncated upload has.
    expect(
      readExifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])),
    ).toBeNull()
    expect(readExifOrientation(fixture('exif-6.jpg').slice(0, 12))).toBeNull()
  })
})

describe('what happens before an engine is asked', () => {
  it('normalises on its own when the file says which way up it is', () => {
    expect(orientationPlan(fixture('exif-6.jpg'))).toEqual({
      exif: 6,
      quarterTurns: 1,
      needsPerson: false,
    })
  })

  it('asks a person when the file says nothing', () => {
    // The medical card in the corpus is exactly this case: a photograph with
    // no orientation tag, lying on its side, which one engine read four
    // different ways.
    expect(orientationPlan(fixture('exif-none.jpg'))).toEqual({
      exif: null,
      quarterTurns: 0,
      needsPerson: true,
    })
  })

  // A MIRRORED CARD IS A FAULT, NOT AN ORIENTATION. Un-mirroring it quietly
  // would hide a scanner set up wrong; a person should look at it.
  it('refuses to silently un-mirror, and hands it to a person', () => {
    expect(orientationPlan(fixture('exif-2.jpg'))).toEqual({
      exif: 2,
      quarterTurns: 0,
      needsPerson: true,
    })
  })

  it('is upright with nothing to do when the tag says so', () => {
    expect(orientationPlan(fixture('exif-1.jpg'))).toEqual({
      exif: 1,
      quarterTurns: 0,
      needsPerson: false,
    })
  })
})

// ---------------------------------------------------------------------------
// WHICH WAY UP IS THIS PHOTOGRAPH?
//
// ── WHY THIS EXISTS, MEASURED RATHER THAN ASSUMED ─────────────────────────
//
// On 2026-09-12 the same medical certificate was read five times by each of
// two engines, as photographed and rotated upright. Rotated upright, both were
// perfect: 25 of 25 field-observations identical and correct. Left lying on
// its side, `deepseek-v4-flash-vision-exp` returned FOUR different examiner
// names in four runs — one of them the driver's surname — and four different
// registry numbers, one at high confidence and eleven digits long.
//
// The dates survived either way, which is the trap: the spine looked stable
// while the identity of the doctor who signed the card did not. A refusal rule
// keyed on dates cannot see that, and a person checking the expiry would not
// either.
//
// So orientation is not a nicety. It is the difference between a reading and
// an invention, and it is decided BEFORE the engine is asked (owner's ruling,
// 2026-09-12): EXIF first; where there is no EXIF, a person turns the card
// upright in the upload UI.
//
// ── WHY THE PARSING LIVES HERE AND NOT IN THE CANVAS CODE ─────────────────
//
// This module is bytes in, number out. No DOM, no canvas, no `Image` — so it
// runs in the node test project against real JPEG bytes rather than only in a
// browser nobody automates. `downscale.ts` owns the pixels; this owns the
// question.
// ---------------------------------------------------------------------------

/**
 * The EXIF orientation values, as the standard numbers them.
 *
 * 1 is upright. 3, 6 and 8 are the three rotations a phone records. The
 * mirrored cases (2, 4, 5, 7) exist and are DELIBERATELY NOT HANDLED as
 * rotations — a mirrored licence is a scanning fault, not an orientation, and
 * quietly un-mirroring one would hide it.
 */
export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/** Clockwise quarter-turns needed to bring each orientation upright. */
const QUARTER_TURNS: Record<Orientation, number> = {
  1: 0,
  2: 0,
  3: 2,
  4: 0,
  5: 0,
  6: 1,
  7: 0,
  8: 3,
}

export function quarterTurnsFor(orientation: Orientation): number {
  return QUARTER_TURNS[orientation]
}

/** Whether this orientation is a mirror rather than a rotation. */
export function isMirrored(orientation: Orientation): boolean {
  return (
    orientation === 2 ||
    orientation === 4 ||
    orientation === 5 ||
    orientation === 7
  )
}

/**
 * The EXIF orientation tag, or null when the file does not carry one.
 *
 * NULL IS A FINDING, NOT A DEFAULT. A file with no orientation tag is one
 * nobody can normalise automatically, and the ruling says a person turns those
 * by hand. Returning 1 here — "assume upright" — would be a guess wearing the
 * clothes of a reading, and it is precisely the guess that produced four
 * different doctors.
 *
 * ── WHAT IT WALKS ─────────────────────────────────────────────────────────
 *
 * A JPEG is `FFD8` then a chain of markers, each `FF <kind> <2-byte length>`.
 * EXIF lives in APP1 (`FFE1`) behind the string `Exif\0\0`, which opens a TIFF
 * header: `II` or `MM` for endianness, `42`, then the offset of IFD0. IFD0 is a
 * count followed by 12-byte entries, and tag `0x0112` is the orientation.
 *
 * Everything here is bounds-checked against the buffer rather than trusted,
 * because this parses a file somebody uploaded: a truncated or hostile JPEG
 * must return null, never read past the end, and never throw into an upload.
 */
export function readExifOrientation(bytes: Uint8Array): Orientation | null {
  // Not a JPEG. PNGs carry no EXIF orientation and neither does anything else
  // a phone hands us — so this is "no answer", the same as a missing tag.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]!

    // Standalone markers carry no length. SOS (DA) means the entropy-coded
    // scan has begun and no more headers follow.
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2
      continue
    }
    if (marker === 0xda || marker === 0xd9) return null

    const length = view.getUint16(offset + 2, false)
    if (length < 2 || offset + 2 + length > bytes.length) return null

    if (marker === 0xe1) {
      const found = orientationInApp1(view, bytes, offset + 4, length - 2)
      if (found !== null) return found
    }
    offset += 2 + length
  }
  return null
}

/** The orientation inside one APP1 segment, or null if it is not there. */
function orientationInApp1(
  view: DataView,
  bytes: Uint8Array,
  start: number,
  length: number,
): Orientation | null {
  // `Exif\0\0`. An APP1 that is XMP rather than EXIF starts differently and is
  // skipped rather than misparsed — both can be present, in either order.
  if (length < 14) return null
  const header = 'Exif\0\0'
  for (let index = 0; index < header.length; index++) {
    if (bytes[start + index] !== header.charCodeAt(index)) return null
  }

  const tiff = start + 6
  const endian = view.getUint16(tiff, false)
  if (endian !== 0x4949 && endian !== 0x4d4d) return null
  const little = endian === 0x4949

  if (view.getUint16(tiff + 2, little) !== 42) return null
  const ifdOffset = view.getUint32(tiff + 4, little)
  const ifd = tiff + ifdOffset
  if (ifd + 2 > start + length) return null

  const entries = view.getUint16(ifd, little)
  for (let index = 0; index < entries; index++) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > start + length) return null
    if (view.getUint16(entry, little) !== 0x0112) continue

    // A SHORT, per the standard, sitting in the value field — which is four
    // bytes wide and read from its own start whatever the endianness.
    const value = view.getUint16(entry + 8, little)
    return value >= 1 && value <= 8 ? (value as Orientation) : null
  }
  return null
}

export interface OrientationPlan {
  /** What the file says about itself, or null when it says nothing. */
  exif: Orientation | null
  /**
   * Clockwise quarter-turns to apply. Zero when nothing is known.
   *
   * FOR CONSUMERS WITHOUT A BROWSER. `createImageBitmap(file, {
   * imageOrientation: 'from-image' })` already applies EXIF, so the upload path
   * must NOT add this on top — that rotates the card twice. It is here for a
   * script or a worker doing the turn itself.
   */
  quarterTurns: number
  /**
   * Whether a PERSON still has to answer the question.
   *
   * True when the file carries no orientation tag, or carries a mirrored one
   * this system will not silently undo. The upload UI turns this into the
   * rotate step; nothing reaches an engine until it is false or the person has
   * confirmed the card is upright.
   */
  needsPerson: boolean
}

/**
 * What to do with this file before anybody reads it.
 *
 * ONE FUNCTION FOR BOTH HALVES OF THE RULING, so the UI and any runner agree
 * about what "normalised" means rather than each deciding.
 */
export function orientationPlan(bytes: Uint8Array): OrientationPlan {
  const exif = readExifOrientation(bytes)
  if (exif === null) return { exif: null, quarterTurns: 0, needsPerson: true }
  if (isMirrored(exif)) return { exif, quarterTurns: 0, needsPerson: true }
  return { exif, quarterTurns: quarterTurnsFor(exif), needsPerson: false }
}

// ---------------------------------------------------------------------------
// A LICENCE AT 1600px IS A BETTER INPUT THAN A 4MB ORIGINAL.
//
// A phone camera produces 2–5MB; the text on a CDL is legible far below that,
// and every byte past legible is transfer time and model cost for no accuracy.
// So the browser shrinks it before it is sent — the fix at the source, rather
// than moving more bytes and raising a limit to receive them.
//
// PDFs PASS THROUGH UNTOUCHED. A canvas cannot open one, and a PDF of a
// licence is already a small file. They are the reason the handler's cap has
// headroom at all.
//
// IT FAILS OPEN, DELIBERATELY. If the image cannot be decoded — an exotic
// format, a browser without `createImageBitmap` — the original is sent and the
// handler's own limit decides. A downscaler that refused the upload when it
// could not shrink it would turn a size optimisation into a new way to fail.
// ---------------------------------------------------------------------------

/** The long edge a licence is legible at, with room to spare. */
export const MAX_EDGE = 1600

/**
 * Shrink, and turn the right way up.
 *
 * ── ORIENTATION IS NOW PART OF THIS PASS (owner's ruling, 2026-09-12) ──────
 *
 * Measured on 2026-09-12: a medical certificate photographed on its side made
 * one engine return four different examiner names in four reads, one of them
 * the driver's own surname, while its dates stayed stable and correct. Upright,
 * the same engine was perfect across five reads. So orientation decides whether
 * a reading is a reading, and it is settled before anything is sent.
 *
 * `imageOrientation: 'from-image'` is the EXIF half, and it is passed
 * EXPLICITLY rather than relied on: the default changed between specification
 * revisions, so a browser that does nothing and a browser that rotates would
 * both be "correct" and only one of them legible.
 *
 * `quarterTurns` is the other half — what a PERSON said, when the file carried
 * no EXIF to go on. `orientationPlan` decides which case a file is in; this
 * function only applies the answer.
 *
 * A TURNED IMAGE IS ALWAYS RE-ENCODED, even when it is already small enough to
 * skip the downscale and even when the result is bigger. The early returns
 * below exist to avoid pointless work, and shipping a correctly-sized file
 * lying on its side is not the work being avoided.
 */
export async function downscaleImage(
  file: File,
  options: {
    /**
     * Quarter-turns a PERSON asked for, clockwise.
     *
     * NEVER THE EXIF TURNS. `createImageBitmap` below already applies those,
     * and passing `orientationPlan().quarterTurns` here as well would rotate
     * the card twice — which is why that field is documented as being for
     * consumers that do NOT have a browser.
     */
    quarterTurns?: number
    /**
     * Whether EXIF said this file is not upright, so the canvas output
     * legitimately differs from the source bytes.
     *
     * Passed in rather than read here because reading it needs the bytes and
     * `orientationPlan` has already done that once; a second read would be a
     * second answer that could disagree.
     */
    reoriented?: boolean
  } = {},
): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  const turns = (((options.quarterTurns ?? 0) % 4) + 4) % 4
  const changed = turns !== 0 || options.reoriented === true

  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    })
    const longest = Math.max(bitmap.width, bitmap.height)
    if (longest <= MAX_EDGE && !changed) {
      bitmap.close()
      return file
    }

    const scale = longest <= MAX_EDGE ? 1 : MAX_EDGE / longest
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    // A QUARTER OR THREE-QUARTER TURN SWAPS THE CANVAS. Drawing a landscape
    // bitmap rotated onto a landscape canvas crops it to a strip, which looks
    // like a bad photograph rather than like a bug in this function.
    const sideways = turns === 1 || turns === 3
    const canvas = document.createElement('canvas')
    canvas.width = sideways ? height : width
    canvas.height = sideways ? width : height
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return file
    }
    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate((turns * Math.PI) / 2)
    context.drawImage(bitmap, -width / 2, -height / 2, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      // JPEG at 0.85: a licence is a photograph of print, and PNG of a
      // photograph is larger than the original for no gain.
      canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.85),
    )
    if (!blob) return file

    // A SMALLER FILE OR THE ORIGINAL, never a bigger one. Re-encoding a
    // heavily compressed source can grow it, and shipping a worse-and-larger
    // file would be the optimisation doing harm in both directions.
    //
    // UNLESS IT WAS TURNED. Then the bytes on the canvas are the only ones
    // that are the right way up, and size is not the question being answered.
    if (blob.size >= file.size && !changed) return file

    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
    })
  } catch {
    return file
  }
}

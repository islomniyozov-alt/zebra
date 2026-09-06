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

export async function downscaleImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  try {
    const bitmap = await createImageBitmap(file)
    const longest = Math.max(bitmap.width, bitmap.height)
    if (longest <= MAX_EDGE) {
      bitmap.close()
      return file
    }

    const scale = MAX_EDGE / longest
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return file
    }
    context.drawImage(bitmap, 0, 0, width, height)
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
    if (blob.size >= file.size) return file

    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
    })
  } catch {
    return file
  }
}

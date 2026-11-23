import { assemblePacketPdf, jpegSize } from './pdf'

// ---------------------------------------------------------------------------
// SEVERAL PHOTOS, ONE DOCUMENT (TMS §9 and §7.8, v11.50; owner's ruling
// 2026-11-23, "a document is one or more photos; the reader reads all pages
// and the office sees them as one document").
//
// Phase 7 flag 9 ruled "one capture per upload" because no PDF assembler was
// in the dependencies. One was in the repository all along: `pdf.ts`'s packet
// writer, plain TypeScript with no Node API, so it runs on the phone and in
// the office's browser alike. This is the rule both callers share; the
// pixels — orientation, scaling, re-encoding to JPEG — are the browser's job
// in `upload-client.ts`, and arrive here as JPEG bytes.
//
// ONE PAGE PER PHOTO, IN THE ORDER GIVEN, each fitted to the page and never
// stretched (`assemblePacketPdf`'s own rule). Nothing is re-encoded here.
// ---------------------------------------------------------------------------

/** Ten pages per document; the eleventh is refused by name (v11.50). */
export const MAX_PAGES = 10

export type PhotoPagesRefusal = 'no_pages' | 'too_many_pages' | 'not_jpeg'

export type PhotoPagesOutcome =
  | { ok: true; pdf: Uint8Array; pageCount: number }
  | { ok: false; reason: PhotoPagesRefusal; page?: number }

/**
 * One PDF from several JPEG photos. Refuses rather than emitting a page it
 * cannot measure: `page` names the first photo (1-based) that is not a JPEG.
 */
export function photosToPdf(jpegs: readonly Uint8Array[]): PhotoPagesOutcome {
  if (jpegs.length === 0) return { ok: false, reason: 'no_pages' }
  if (jpegs.length > MAX_PAGES) return { ok: false, reason: 'too_many_pages' }
  const bad = jpegs.findIndex((jpeg) => jpegSize(jpeg) === null)
  if (bad !== -1) return { ok: false, reason: 'not_jpeg', page: bad + 1 }
  return {
    ok: true,
    pdf: assemblePacketPdf(jpegs.map((jpeg) => ({ kind: 'image', jpeg }))),
    pageCount: jpegs.length,
  }
}

/**
 * The assembled file's name: the first photo's stem and the page count, so a
 * row on the load reads "IMG_2041-3-pages.pdf" rather than a bare hash.
 */
export function pagesFilename(firstName: string, pageCount: number): string {
  const stem =
    firstName.replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '-') || 'pages'
  return `${stem}-${String(pageCount)}-pages.pdf`
}

/** The words a refusal is shown in, as an i18n key. */
export function photoPagesRefusalKey(
  reason: PhotoPagesRefusal,
): 'pages.error.none' | 'pages.error.tooMany' | 'pages.error.notPhoto' {
  return reason === 'no_pages'
    ? 'pages.error.none'
    : reason === 'too_many_pages'
      ? 'pages.error.tooMany'
      : 'pages.error.notPhoto'
}

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MAX_PAGES,
  pagesFilename,
  photoPagesRefusalKey,
  photosToPdf,
} from '@/lib/photo-pages'
import { translator } from '@/lib/i18n'
import { importPdfPages } from '@/lib/pdf-import'

const en = translator('en')
const ru = translator('ru')

// TMS §9 and §7.8, v11.50 (owner's ruling 2026-11-23): a document is one or
// more photos; the reader reads all pages and the office sees one document.

/** A JPEG header `jpegSize` can measure: SOI, then an SOF0 frame. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ])
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')

describe('several photos, one document (v11.50)', () => {
  it('makes one PDF with a page per photo, in the order taken', () => {
    const built = photosToPdf([jpeg(111, 222), jpeg(333, 44), jpeg(55, 66)])
    if (!built.ok) throw new Error(`refused: ${built.reason}`)
    expect(built.pageCount).toBe(3)
    const text = latin1(built.pdf)
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text).toMatch(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count 3 >>/)
    const widths = [...text.matchAll(/\/Subtype \/Image \/Width (\d+)/g)].map(
      (match) => Number(match[1]),
    )
    expect(widths).toEqual([111, 333, 55])
    // Read back by the repository's own PDF reader, which walks the
    // cross-reference table: three pages, or the file is not a PDF at all.
    const read = importPdfPages(built.pdf)
    if (!read.ok) throw new Error(`unreadable PDF: ${read.reason}`)
    expect(read.document.pages).toHaveLength(3)
  })

  it('a single photo is a one-page PDF when asked, never an empty one', () => {
    const built = photosToPdf([jpeg(10, 10)])
    expect(built.ok && built.pageCount).toBe(1)
    expect(photosToPdf([])).toEqual({ ok: false, reason: 'no_pages' })
  })

  it('holds at most ten pages and refuses the eleventh by name', () => {
    expect(MAX_PAGES).toBe(10)
    const ten = Array.from({ length: 10 }, () => jpeg(20, 20))
    expect(photosToPdf(ten).ok).toBe(true)
    expect(photosToPdf([...ten, jpeg(20, 20)])).toEqual({
      ok: false,
      reason: 'too_many_pages',
    })
  })

  it('refuses a page that is not a JPEG, naming which', () => {
    expect(photosToPdf([jpeg(20, 20), PNG])).toEqual({
      ok: false,
      reason: 'not_jpeg',
      page: 2,
    })
  })

  it('names the file after the first photo and the page count', () => {
    expect(pagesFilename('IMG_2041.jpg', 3)).toBe('IMG_2041-3-pages.pdf')
    expect(pagesFilename('inspection page.HEIC', 2)).toBe(
      'inspection-page-2-pages.pdf',
    )
    expect(pagesFilename('.jpg', 2)).toBe('pages-2-pages.pdf')
  })

  it('words every refusal in both languages', () => {
    for (const reason of ['no_pages', 'too_many_pages', 'not_jpeg'] as const) {
      const key = photoPagesRefusalKey(reason)
      expect(en(key)).toEqual(expect.stringMatching(/\S/))
      expect(ru(key)).not.toBe(en(key))
    }
    expect(en('pages.error.pdfAmong')).toEqual(expect.stringMatching(/\S/))
    expect(ru('pages.error.pdfAmong')).not.toBe(en('pages.error.pdfAmong'))
  })
})

describe('the callers assemble rather than sending page by page', () => {
  const client = readFileSync('src/lib/upload-client.ts', 'utf8')
  const capture = readFileSync(
    'src/app/(portal)/portal/documents/CaptureUpload.tsx',
    'utf8',
  )
  const intake = readFileSync(
    'src/app/(app)/safety/ComplianceIntake.tsx',
    'utf8',
  )

  it('a page is always re-encoded through the canvas, never handed back as picked', () => {
    const body = client.slice(
      client.indexOf('export async function jpegPage'),
      client.indexOf('export async function photosAsDocument'),
    )
    expect(body).toContain("type: 'image/jpeg'")
    expect(body).not.toContain('return file')
    expect(client).toMatch(
      /for \(const photo of photos\) pages\.push\(await jpegPage\(photo\)\)/,
    )
  })

  it('the portal collects pages and sends one document', () => {
    expect(capture).toContain('photosAsDocument(pages)')
    expect(capture).toContain('labels.addPage')
    expect(capture).toMatch(/multiple\s/)
    // The pages survive a refusal: cleared only after the send succeeded.
    expect(capture).toContain('if (await send(built.file)) setPages([])')
  })

  it('the Safety intake reads several photos as one document', () => {
    expect(intake).toContain('onFiles={(files) => void take(files)}')
    expect(intake).toContain('photosAsDocument(files)')
    expect(intake).toContain("setNotice('pages.error.pdfAmong')")
  })
})

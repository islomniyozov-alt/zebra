import { describe, expect, it } from 'vitest'
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOAD_URL_TTL_SECONDS,
  DOWNLOAD_URL_TTL_SECONDS,
  buildObjectKey,
  isTargetEntity,
  sanitizeFilename,
} from '@/lib/documents'

const ORG = 'cms59hb1s0000tgvsyq75inm2'

describe('sanitizeFilename', () => {
  it('keeps an ordinary name recognisable', () => {
    expect(sanitizeFilename('rate-confirmation.pdf')).toBe(
      'rate-confirmation.pdf',
    )
  })

  it('drops any path the client sends', () => {
    // Both separators, because the client might be on either platform and
    // neither belongs in an object key.
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('C:\\Users\\me\\POD.pdf')).toBe('POD.pdf')
    expect(sanitizeFilename('/absolute/path/scan.jpg')).toBe('scan.jpg')
  })

  it('collapses anything that would need escaping later', () => {
    // The name is echoed in Content-Disposition, so a quote or a newline there
    // is a header-injection attempt. An allowlist cannot be under-enumerated.
    expect(sanitizeFilename('in voice "final";.pdf')).toBe(
      'in-voice-final-.pdf',
    )
    expect(sanitizeFilename('two\nlines.pdf')).toBe('two-lines.pdf')
    expect(sanitizeFilename('null\u0000byte.pdf')).toBe('null-byte.pdf')
  })

  it('refuses to produce a name that is only dots', () => {
    // '.' and '..' are the two names that mean something else entirely.
    expect(sanitizeFilename('..')).toBe('upload')
    expect(sanitizeFilename('.')).toBe('upload')
    expect(sanitizeFilename('')).toBe('upload')
  })

  it('bounds the length', () => {
    expect(sanitizeFilename('a'.repeat(500)).length).toBe(120)
  })
})

describe('buildObjectKey', () => {
  it('puts the tenant first, so a bucket policy stays expressible', () => {
    const key = buildObjectKey({
      organizationId: ORG,
      entity: 'load',
      entityId: 'cms5load0000000000000000x',
      filename: 'POD.pdf',
      uuid: 'fixed-uuid',
    })

    expect(key).toBe(`${ORG}/load/cms5load0000000000000000x/fixed-uuid-POD.pdf`)
    expect(key.startsWith(`${ORG}/`)).toBe(true)
  })

  it('cannot be walked out of its own prefix', () => {
    const key = buildObjectKey({
      organizationId: ORG,
      entity: 'load',
      entityId: 'cms5load0000000000000000x',
      filename: '../../other-org/secret.pdf',
      uuid: 'u',
    })
    expect(key.split('/')[0]).toBe(ORG)
    expect(key).not.toContain('..')
  })

  it('is unique per upload even for the same file', () => {
    const of = () =>
      buildObjectKey({
        organizationId: ORG,
        entity: 'load',
        entityId: 'x',
        filename: 'POD.pdf',
      })
    expect(of()).not.toBe(of())
  })
})

describe('target entities', () => {
  it('accepts the things a document can hang off', () => {
    for (const entity of ['load', 'invoice', 'driver', 'truck', 'claim']) {
      expect(isTargetEntity(entity), entity).toBe(true)
    }
  })

  it('refuses anything else, including prototype keys', () => {
    // A bare `in` check would say yes to these.
    for (const entity of [
      'user',
      'organization',
      'session',
      '__proto__',
      'constructor',
      'toString',
    ]) {
      expect(isTargetEntity(entity), entity).toBe(false)
    }
  })
})

describe('upload policy', () => {
  it('keeps the upload URL short-lived', () => {
    // It is a bearer capability while it lives.
    expect(UPLOAD_URL_TTL_SECONDS).toBeLessThanOrEqual(15 * 60)
    expect(DOWNLOAD_URL_TTL_SECONDS).toBeLessThanOrEqual(5 * 60)
  })

  it('allows what a phone camera and a scanner produce, and no markup', () => {
    expect(ALLOWED_MIME_TYPES).toContain('application/pdf')
    expect(ALLOWED_MIME_TYPES).toContain('image/jpeg')
    expect(ALLOWED_MIME_TYPES).toContain('image/heic')
    // Anything the browser would render from our own origin stays out.
    expect(ALLOWED_MIME_TYPES).not.toContain('text/html')
    expect(ALLOWED_MIME_TYPES).not.toContain('image/svg+xml')
    expect(ALLOWED_MIME_TYPES).not.toContain('application/octet-stream')
  })

  it('caps the size at something a truck stop can actually upload', () => {
    expect(MAX_UPLOAD_BYTES).toBeGreaterThan(5 * 1024 * 1024)
    expect(MAX_UPLOAD_BYTES).toBeLessThanOrEqual(50 * 1024 * 1024)
  })
})

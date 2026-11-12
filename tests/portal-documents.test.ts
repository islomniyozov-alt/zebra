import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isPortalDocumentType,
  PORTAL_DOCUMENT_TYPES,
} from '@/lib/portal-documents'
import { STOP_CLOCK_FOR_STEP } from '@/lib/portal-status'

// ---------------------------------------------------------------------------
// THE DRIVER'S UPLOAD AND THE DRIVER'S CHECK-IN (Phase 7 steps 4–5).
// ---------------------------------------------------------------------------

describe('the seven types a driver may attach', () => {
  it('are the seven the brief names, and the rate confirmation is not one', () => {
    expect([...PORTAL_DOCUMENT_TYPES]).toEqual([
      'POD',
      'BOL',
      'LUMPER_RECEIPT',
      'SCALE_TICKET',
      'FUEL_RECEIPT',
      'DETENTION_PROOF',
      'PHOTO',
    ])
    expect(isPortalDocumentType('RATE_CONFIRMATION')).toBe(false)
    expect(isPortalDocumentType('SETTLEMENT_PDF')).toBe(false)
    expect(isPortalDocumentType('POD')).toBe(true)
    expect(isPortalDocumentType(42)).toBe(false)
  })
})

describe('the tap is the stop’s check-in (flag 8, ruled 2026-11-12)', () => {
  it('maps the four rungs to the four clocks, and the other two to none', () => {
    expect(STOP_CLOCK_FOR_STEP).toEqual({
      AT_PICKUP: { type: 'PICKUP', clock: 'arrivedAt' },
      LOADED: { type: 'PICKUP', clock: 'departedAt' },
      AT_DELIVERY: { type: 'DELIVERY', clock: 'arrivedAt' },
      DELIVERED: { type: 'DELIVERY', clock: 'departedAt' },
    })
  })
})

describe('the portal’s upload routes ask the portal’s gate and the predicates', () => {
  const read = (...parts: string[]) =>
    readFileSync(join(process.cwd(), ...parts), 'utf8')
  const mint = read(
    'src',
    'app',
    'api',
    'portal',
    'documents',
    'upload-url',
    'route.ts',
  )
  const confirm = read(
    'src',
    'app',
    'api',
    'portal',
    'documents',
    'confirm',
    'route.ts',
  )
  const capture = read(
    'src',
    'app',
    '(portal)',
    'portal',
    'documents',
    'CaptureUpload.tsx',
  )

  it('mint: portal.document:create, the own-load predicate, the seven types, the office’s mintUpload', () => {
    expect(mint).toMatch(/withCurrentOrg\(\s*'create',\s*'portal\.document'/)
    expect(mint).toMatch(/uploadTargetFor\(tx, session, loadId\)/)
    expect(mint).toMatch(/isPortalDocumentType\(documentType\)/)
    expect(mint).toMatch(/entity: 'load'/)
    expect(mint).not.toMatch(/'create',\s*'document'/)
  })

  it('confirm: the own-pending check before the HEAD, through the office’s confirmUpload', () => {
    expect(confirm).toMatch(/ownPendingUpload\(tx, current, pendingUploadId\)/)
    expect(confirm).toMatch(
      /confirmUpload\(\s*\(fn\) => withCurrentOrg\('create', 'portal\.document', fn\)/,
    )
  })

  it('the capture is camera-first, through the portal’s endpoints', () => {
    expect(capture).toMatch(/capture="environment"/)
    // Named once in the upload client (step 6), so the live capture and the
    // queue's replay cannot send to different routes.
    expect(capture).toMatch(/endpoints: PORTAL_ENDPOINTS/)
    const client = read('src', 'lib', 'upload-client.ts')
    expect(client).toMatch(
      /PORTAL_ENDPOINTS: UploadEndpoints = \{\s*mint: '\/api\/portal\/documents\/upload-url',\s*confirm: '\/api\/portal\/documents\/confirm',/,
    )
  })
})

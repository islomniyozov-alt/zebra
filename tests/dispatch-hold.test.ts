import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { photoStageForStatus } from '@/lib/load-photos'

// ---------------------------------------------------------------------------
// TMS §7.14 items 3–4, v11.43 (owner's rulings 2026-11-22), the parts that
// read source or need no database. The paths themselves are proven against
// Postgres in tests/integration/dispatch-hold.test.ts.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, 'utf8')

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })

describe('a portal photo’s folder', () => {
  it('is Pickup only At pickup and Delivery only At delivery', () => {
    expect(photoStageForStatus('AT_PICKUP')).toBe('PICKUP')
    expect(photoStageForStatus('AT_DELIVERY')).toBe('DELIVERY')
    for (const status of [
      'AVAILABLE',
      'BOOKED',
      'DISPATCHED',
      'LOADED',
      'IN_TRANSIT',
      'DELIVERED',
      'POD_RECEIVED',
    ] as const) {
      expect(photoStageForStatus(status)).toBeNull()
    }
    expect(photoStageForStatus(null)).toBeNull()
  })

  it('is asked only by the portal’s confirm', () => {
    const askers = sources('src').filter((path) =>
      read(path).includes('photoStageFromLoad: true'),
    )
    expect(askers.map((path) => path.replaceAll('\\', '/'))).toEqual([
      'src/app/api/portal/documents/confirm/route.ts',
    ])
  })
})

describe('the rate-con gate has one home', () => {
  it('nothing in src moves a load to Dispatched except the assignment writer', () => {
    // Every transitionOperational call, with what it passes as the target.
    const calls = sources('src').flatMap((path) =>
      [
        ...read(path).matchAll(
          /transitionOperational\(\s*tx,\s*[\w.]+,\s*([^,]+),/g,
        ),
      ].map((match) => `${path.replaceAll('\\', '/')} ${match[1]!.trim()}`),
    )
    const dispatching = calls.filter(
      (call) => call.includes("'DISPATCHED'") || call.endsWith(' move.to'),
    )
    expect(dispatching.sort()).toEqual([
      "src/lib/load-status.ts 'DISPATCHED'",
      'src/lib/load-status.ts move.to',
    ])
  })

  it('the writer holds on the one predicate, and only a written reason passes it', () => {
    const writer = read('src/lib/load-status.ts')
    const body = writer.slice(
      writer.indexOf('export async function applyAssignmentStatus'),
      writer.indexOf('export type DispatchWithReasonOutcome'),
    )
    expect(body).toContain('await rateConMissingForDispatch(tx, loadId)')
    expect(body).toMatch(
      /if \(override === ''\) \{\s*return \{\s*result: 'held'/,
    )
  })

  it('the board hands its reason to the writer and decides nothing itself', () => {
    const board = read('src/app/(app)/dispatch/actions.ts')
    expect(board).toMatch(
      /applyAssignmentStatus\(tx, loadId, session\.userId, undefined, \{\s*rateConOverride: overrideReason,/,
    )
    expect(board).not.toContain('rateConReasonRequired')
  })

  it('a rate con landing re-runs the writer', () => {
    const documents = read('src/lib/documents.ts')
    expect(documents).toMatch(
      /pending\.type === 'RATE_CONFIRMATION' && targetEntity === 'load'\) \{\s*await applyAssignmentStatus\(/,
    )
  })
})

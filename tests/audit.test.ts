import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  diffRows,
  getAuditHealth,
  isUnattributed,
  onAuditEvent,
  resetAuditHealth,
  unattributed,
  type AuditEvent,
} from '@/lib/audit'

afterEach(() => {
  resetAuditHealth()
  vi.restoreAllMocks()
})

describe('diffRows', () => {
  it('reports only the fields that changed', () => {
    // §8: one row per write, not one per field, and the row says what moved.
    expect(
      diffRows(
        { id: 'c1', linehaulCents: 250000, commodity: 'Steel' },
        { id: 'c1', linehaulCents: 275000, commodity: 'Steel' },
      ),
    ).toEqual({ linehaulCents: { from: 250000, to: 275000 } })
  })

  it('is empty when nothing moved', () => {
    expect(diffRows({ id: 'c1', a: 1 }, { id: 'c1', a: 1 })).toEqual({})
  })

  it('never mentions updatedAt', () => {
    // It changes on every single write. Leaving it in would put it in every
    // diff and bury the field that actually mattered.
    const changes = diffRows(
      { id: 'c1', a: 1, updatedAt: new Date('2026-01-01') },
      { id: 'c1', a: 2, updatedAt: new Date('2026-07-29') },
    )
    expect(Object.keys(changes)).toEqual(['a'])
  })

  it('records a create as every field arriving from nothing', () => {
    expect(diffRows(null, { id: 'c1', name: 'RAM Haulage' })).toEqual({
      id: { from: null, to: 'c1' },
      name: { from: null, to: 'RAM Haulage' },
    })
  })

  it('records a delete as every field going to nothing', () => {
    expect(diffRows({ id: 'c1', name: 'RAM Haulage' }, null)).toEqual({
      id: { from: 'c1', to: null },
      name: { from: 'RAM Haulage', to: null },
    })
  })

  it('treats undefined and null as the same absence', () => {
    expect(
      diffRows({ id: 'c1', note: null }, { id: 'c1', note: undefined }),
    ).toEqual({})
  })

  it('serialises dates so the diff survives JSON', () => {
    expect(
      diffRows(
        { id: 'c1', deletedAt: null },
        { id: 'c1', deletedAt: new Date('2026-07-29T12:00:00.000Z') },
      ),
    ).toEqual({
      deletedAt: { from: null, to: '2026-07-29T12:00:00.000Z' },
    })
  })

  it('does not report a date that stayed the same instant', () => {
    expect(
      diffRows(
        { id: 'c1', at: new Date('2026-07-29T12:00:00Z') },
        { id: 'c1', at: new Date('2026-07-29T12:00:00Z') },
      ),
    ).toEqual({})
  })

  it('compares arrays by value', () => {
    expect(
      diffRows(
        { id: 'c1', scopes: ['a', 'b'] },
        { id: 'c1', scopes: ['a', 'b'] },
      ),
    ).toEqual({})
    expect(
      diffRows({ id: 'c1', scopes: ['a'] }, { id: 'c1', scopes: ['a', 'b'] }),
    ).toEqual({
      scopes: { from: ['a'], to: ['a', 'b'] },
    })
  })

  it('does not put a binary column in the log', () => {
    const changes = diffRows(
      { id: 'c1', blob: new Uint8Array(4) },
      { id: 'c1', blob: null },
    )
    expect(changes['blob']).toEqual({ from: '<4 bytes>', to: null })
  })
})

describe('audit health', () => {
  it('starts clean and stays countable', () => {
    // The point of the counter: failures are expected to be zero forever,
    // which is what makes a non-zero value worth alerting on.
    expect(getAuditHealth()).toEqual({
      written: 0,
      failures: 0,
      lastFailure: null,
      gaps: { noContext: 0, unattributed: 0, unfollowableOperation: 0 },
    })
  })

  it('hands back a copy, not the live counters', () => {
    const snapshot = getAuditHealth()
    snapshot.failures = 99
    snapshot.gaps.noContext = 99
    expect(getAuditHealth().failures).toBe(0)
    expect(getAuditHealth().gaps.noContext).toBe(0)
  })
})

describe('unattributed', () => {
  it('carries its reason, so the gap says why', () => {
    const declared = unattributed('nightly reconciliation job')
    expect(declared).toEqual({
      kind: 'unattributed',
      reason: 'nightly reconciliation job',
    })
    expect(isUnattributed(declared)).toBe(true)
  })

  it('is distinguishable from a real actor', () => {
    // The discriminant is what lets runInOrg accept either and still know
    // which it got.
    expect(isUnattributed({ userId: 'cms59hb1s0000tgvsyq75inm2' })).toBe(false)
  })
})

describe('audit event sinks', () => {
  it('can be subscribed and unsubscribed', () => {
    const seen: AuditEvent[] = []
    const unsubscribe = onAuditEvent((event) => seen.push(event))
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
    expect(seen).toEqual([])
  })

  it('survives a sink that throws', () => {
    // A broken alerting hook must not become a broken write.
    const unsubscribe = onAuditEvent(() => {
      throw new Error('sink is down')
    })
    expect(() => unsubscribe()).not.toThrow()
  })
})

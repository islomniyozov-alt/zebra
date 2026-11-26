import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  undoVerdict,
  UNDO_WINDOW_MS,
  type AuditRowLite,
  type LastChange,
} from '@/lib/load-undo'

// ---------------------------------------------------------------------------
// UNDO'S ONE PREDICATE, BRANCH BY BRANCH (TMS §7.14 part 7, v11.60).
//
// The agreement with the real writers is `tests/integration/load-undo.test.ts`;
// this file pins each refusal and each kind on rows small enough to read, so
// a change to the rule fails here by name before it reaches the database.
// ---------------------------------------------------------------------------

const LOAD = { id: 'load1', childIds: new Set(['stop1', 'stop2', 'acc1']) }
const ME = { userId: 'me' }
const NOW = new Date('2026-11-26T12:00:00Z')

let n = 0
const row = (
  entityType: string,
  action: string,
  changes: Record<string, { from: unknown; to: unknown }>,
  entityId = entityType === 'Load' ? 'load1' : `${entityType}-${(n += 1)}`,
): AuditRowLite => ({
  id: `a${(n += 1)}`,
  entityType,
  entityId,
  action,
  changes,
})

const change = (
  rows: AuditRowLite[],
  over: Partial<LastChange> = {},
): LastChange => ({
  userId: 'me',
  at: new Date(NOW.getTime() - 60_000),
  rows,
  truncated: false,
  ...over,
})

const verdict = (c: LastChange | null) => undoVerdict(c, LOAD, ME, NOW)

describe('what is offered, and named', () => {
  it('a field edit', () => {
    expect(
      verdict(
        change([row('Load', 'UPDATE', { poNumber: { from: null, to: 'P' } })]),
      ),
    ).toEqual({ ok: true, kind: 'edit' })
  })

  it('an assignment, with the dispatch it caused', () => {
    expect(
      verdict(
        change([
          row('Load', 'UPDATE', { truckId: { from: null, to: 't1' } }),
          row('Load', 'UPDATE', {
            operationalStatus: { from: 'BOOKED', to: 'DISPATCHED' },
          }),
          row('LoadStatusEvent', 'CREATE', {
            loadId: { from: null, to: 'load1' },
          }),
        ]),
      ),
    ).toEqual({ ok: true, kind: 'assignment' })
  })

  it('a status move, with the billing axis that followed it', () => {
    expect(
      verdict(
        change([
          row('Load', 'UPDATE', {
            operationalStatus: { from: 'BOOKED', to: 'DELIVERED' },
            billingStatus: { from: 'UNINVOICED', to: 'READY' },
          }),
          row('LoadStatusEvent', 'CREATE', {
            loadId: { from: null, to: 'load1' },
          }),
        ]),
      ),
    ).toEqual({ ok: true, kind: 'status' })
  })

  it('an accessorial line, with the totals it moved', () => {
    expect(
      verdict(
        change([
          row('LoadAccessorial', 'CREATE', {
            loadId: { from: null, to: 'load1' },
          }),
          row('Load', 'UPDATE', {
            accessorialsCents: { from: 0, to: 15000 },
            totalRevenueCents: { from: 100000, to: 115000 },
          }),
        ]),
      ),
    ).toEqual({ ok: true, kind: 'accessorial' })
  })

  it('a removed accessorial line, found by the loadId its DELETE recorded', () => {
    expect(
      verdict(
        change([
          row(
            'LoadAccessorial',
            'DELETE',
            { loadId: { from: 'load1', to: null } },
            'gone',
          ),
        ]),
      ),
    ).toEqual({ ok: true, kind: 'accessorial' })
  })

  it('a stop rewrite is an edit', () => {
    expect(
      verdict(
        change([
          row(
            'LoadStop',
            'DELETE',
            { loadId: { from: 'load1', to: null } },
            'old',
          ),
          row(
            'LoadStop',
            'CREATE',
            { loadId: { from: null, to: 'load1' } },
            'stop1',
          ),
        ]),
      ),
    ).toEqual({ ok: true, kind: 'edit' })
  })
})

describe('a dock or broker created on the way (create-on-miss)', () => {
  it('rides along as a CREATE, and the edit is still offered', () => {
    expect(
      verdict(
        change([
          row('Location', 'CREATE', {
            name: { from: null, to: 'Memphis, TN' },
          }),
          row(
            'LoadStop',
            'CREATE',
            { loadId: { from: null, to: 'load1' } },
            'stop2',
          ),
        ]),
      ),
    ).toEqual({ ok: true, kind: 'edit' })
  })

  it('but a change TO the book is never undone', () => {
    expect(
      verdict(
        change([
          row('Load', 'UPDATE', { poNumber: { from: null, to: 'P' } }),
          row('Location', 'UPDATE', {
            timezone: { from: null, to: 'America/Chicago' },
          }),
        ]),
      ),
    ).toEqual({ ok: false, reason: 'never' })
  })
})

describe('what is refused, and why', () => {
  it('nothing in the window', () => {
    expect(verdict(null)).toEqual({ ok: false, reason: 'nothing' })
  })

  it("somebody else's change", () => {
    expect(
      verdict(
        change([row('Load', 'UPDATE', { poNumber: { from: null, to: 'P' } })], {
          userId: 'them',
        }),
      ),
    ).toEqual({ ok: false, reason: 'notYours' })
  })

  it('older than 24 hours, by a second', () => {
    const rows = [row('Load', 'UPDATE', { poNumber: { from: null, to: 'P' } })]
    expect(
      verdict(change(rows, { at: new Date(NOW.getTime() - UNDO_WINDOW_MS) })),
    ).toEqual({ ok: true, kind: 'edit' })
    expect(
      verdict(
        change(rows, { at: new Date(NOW.getTime() - UNDO_WINDOW_MS - 1000) }),
      ),
    ).toEqual({ ok: false, reason: 'tooOld' })
  })

  it('an Undo', () => {
    expect(
      verdict(
        change([
          row('Load', 'UPDATE', { poNumber: { from: 'P', to: null } }),
          row(
            'LoadUndo',
            'UPDATE',
            { undo: { from: 'x', to: 'edit' } },
            'load1',
          ),
        ]),
      ),
    ).toEqual({ ok: false, reason: 'undo' })
  })

  it.each([
    ['an invoice', row('Invoice', 'CREATE', {})],
    ['a payment', row('PaymentLoadApplication', 'CREATE', {})],
    ['a document', row('Document', 'CREATE', {})],
    ['a settlement line', row('SettlementLine', 'CREATE', {})],
    [
      'factoring',
      row('Load', 'UPDATE', { isFactored: { from: false, to: true } }),
    ],
    [
      'a send stamp',
      row('Load', 'UPDATE', { filedAt: { from: null, to: 'x' } }),
    ],
    [
      'another load',
      row('Load', 'UPDATE', { poNumber: { from: null, to: 'P' } }, 'load2'),
    ],
    [
      "another load's stop",
      row('LoadStop', 'UPDATE', { city: { from: 'A', to: 'B' } }, 'elsewhere'),
    ],
    [
      'the creation',
      row('Load', 'CREATE', { loadNumber: { from: null, to: '7' } }),
    ],
  ])('anything that touched %s — never', (_name, extra) => {
    expect(
      verdict(
        change([
          row('Load', 'UPDATE', { poNumber: { from: null, to: 'P' } }),
          extra,
        ]),
      ),
    ).toEqual({ ok: false, reason: 'never' })
  })

  it('a save too large to be a load edit', () => {
    expect(
      verdict(
        change([row('Load', 'UPDATE', { poNumber: { from: null, to: 'P' } })], {
          truncated: true,
        }),
      ),
    ).toEqual({ ok: false, reason: 'never' })
  })

  it('a save that changed nothing Undo would write back', () => {
    expect(
      verdict(
        change([
          row('LoadStatusEvent', 'CREATE', {
            loadId: { from: null, to: 'load1' },
          }),
        ]),
      ),
    ).toEqual({ ok: false, reason: 'nothing' })
  })
})

describe('one predicate: the menu and the write both ask it', () => {
  const lib = readFileSync('src/lib/load-undo.ts', 'utf8')
  const page = readFileSync('src/app/(app)/loads/[id]/page.tsx', 'utf8')
  const actions = readFileSync('src/app/(app)/loads/[id]/actions.ts', 'utf8')

  it('the page renders undoStateFor, which is undoVerdict over lastChange', () => {
    expect(page).toContain('undoStateFor(')
    const asked = lib.slice(lib.indexOf('export async function undoStateFor('))
    expect(asked.slice(0, asked.indexOf('\n}\n'))).toMatch(
      /lastChange\([\s\S]*undoVerdict\(/,
    )
  })

  it('the action posts applyUndo, which asks undoVerdict over lastChange before any write', () => {
    expect(actions).toContain('applyUndo(tx, loadId, session.userId)')
    const body = lib.slice(lib.indexOf('export async function applyUndo('))
    const verdictAt = body.indexOf('undoVerdict(')
    expect(body.indexOf('lastChange(')).toBeLessThan(verdictAt)
    expect(verdictAt).toBeGreaterThan(0)
    expect(verdictAt).toBeLessThan(body.indexOf('.update('))
    expect(verdictAt).toBeLessThan(body.indexOf('.deleteMany('))
  })
})

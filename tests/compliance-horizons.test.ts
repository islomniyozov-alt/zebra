import { describe, expect, it } from 'vitest'
import { PANEL_HORIZON_DAYS, complianceHorizons } from '@/lib/compliance'
import type { TxClient } from '@/lib/tenancy'

// ---------------------------------------------------------------------------
// THE PANEL'S 30/60/90 FIGURES ARE THE QUEUE, READ ONCE AT 90 DAYS.
// §6.1.1, queue item 20 (8).
//
// ── WHY A STUB TRANSACTION ──────────────────────────────────────────────
//
// The claim has two halves and only one of them is about the database's reply.
// That the figures AGREE with the Needs-you row over real rows — sold trucks,
// superseded records — is `tests/integration/dashboard.test.ts`. That the
// reader ASKED the queue at ninety days, and did not read the authorities'
// warning days to do it, is a claim about the call, and the only witness to a
// call is a transaction that records it.
//
// A `tx` that answers `complianceItem.findMany` with canned rows and records
// `companySettings.findMany` is enough: the horizon arrives in the `where`, and
// the bucketing runs over the rows that come back.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-02T12:00:00Z')
const DAY = 86_400_000
const at = (days: number) => new Date(NOW.getTime() + days * DAY)

type StoredRow = Parameters<
  typeof import('@/lib/compliance').shapeRecords
>[0][number]

const base = {
  companyId: 'alpha',
  identifier: null,
  issuer: null,
  issuedAt: null,
  notes: null,
  company: { name: 'Alpha' },
  trailer: null,
  _count: { documents: 0 },
}
const truck = (id: string) => ({ truck: { id, unitNumber: id }, driver: null })
const driver = (id: string) => ({
  truck: null,
  driver: { id, firstName: 'D', lastName: id },
})

/** Five rows the horizon query would return, one of them superseded. */
const ROWS: StoredRow[] = [
  // Expired three days ago, never renewed: in all three horizons.
  { id: 'a', type: 'REGISTRATION', expiresAt: at(-3), ...base, ...truck('T1') },
  // Twenty days out: in all three.
  {
    id: 'b',
    type: 'ANNUAL_INSPECTION',
    expiresAt: at(20),
    ...base,
    ...truck('T1'),
  },
  // Forty-five days out: in 60 and 90, not in 30.
  {
    id: 'c',
    type: 'MEDICAL_CARD',
    expiresAt: at(45),
    ...base,
    ...driver('D1'),
  },
  // Eighty days out: in 90 only.
  { id: 'd', type: 'REGISTRATION', expiresAt: at(80), ...base, ...truck('T2') },
  // Lapsed five days ago AND RENEWED (the renewal is in the latest query
  // below, a year out): superseded, in none.
  { id: 'e', type: 'REGISTRATION', expiresAt: at(-5), ...base, ...truck('T3') },
]

/** What the "latest expiry per subject and type" read answers. */
const LATEST = [
  ...ROWS.map((row) => ({
    type: row.type,
    expiresAt: row.expiresAt,
    truckId: row.truck?.id ?? null,
    trailerId: null,
    driverId: row.driver?.id ?? null,
  })),
  {
    type: 'REGISTRATION' as const,
    expiresAt: at(400),
    truckId: 'T3',
    trailerId: null,
    driverId: null,
  },
]

function recordingTx() {
  const calls: { model: string; args: Record<string, unknown> }[] = []
  const tx = {
    companySettings: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ model: 'companySettings', args })
        return []
      },
    },
    complianceItem: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        calls.push({ model: 'complianceItem', args })
        // The horizon read carries `take`; the latest-per-key read carries OR.
        return 'take' in args ? ROWS : LATEST
      },
    },
  } as unknown as TxClient
  return { tx, calls }
}

describe('the panel reads the queue once, at ninety days', () => {
  it('asks the compliance table with a 90-day horizon and never reads warning days', async () => {
    const { tx, calls } = recordingTx()
    await complianceHorizons(tx, [], NOW)

    // NOT THE AUTHORITIES' WARNING DAYS. A fixed horizon is the caller's, and
    // a reader that consulted CompanySettings first would be answering "within
    // the warn-days" and labelling it "within 90".
    expect(calls.filter((call) => call.model === 'companySettings')).toEqual([])

    const horizonRead = calls.find(
      (call) => call.model === 'complianceItem' && 'take' in call.args,
    )
    expect(horizonRead).toBeDefined()
    const where = horizonRead!.args.where as {
      expiresAt: { lte: Date }
    }
    // The queue's boundary is generous by a day: 90 + 1.
    expect(where.expiresAt.lte.getTime()).toBe(
      at(PANEL_HORIZON_DAYS[2] + 1).getTime(),
    )
  })

  it('buckets the rows cumulatively, expired in all three, superseded in none', async () => {
    const { tx } = recordingTx()
    const figures = await complianceHorizons(tx, [], NOW)

    expect(figures).toEqual({ d30: 2, d60: 3, d90: 4 })
  })

  it('is one read of the queue, not three', async () => {
    const { tx, calls } = recordingTx()
    await complianceHorizons(tx, [], NOW)

    // The queue costs two statements (the horizon read and the latest-per-key
    // read). Three horizons asked separately would be six, and the reader
    // would be back to costing what the SQL it replaced was meant to save.
    expect(
      calls.filter((call) => call.model === 'complianceItem'),
    ).toHaveLength(2)
  })
})

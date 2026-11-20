import { describe, expect, it } from 'vitest'
import { openPeriodOnReactivation, reactivates } from '@/lib/asset-transfer'
import { setRosterStatus, updateDriver } from '@/lib/fleet'
import type { TxClient } from '@/lib/tenancy'

// ---------------------------------------------------------------------------
// LEAVING TERMINATED OPENS THE PERIOD, IN THE SAME WRITE (TMS §6.4 part 1
// v11.39; owner's ruling 2026-11-20, GAPS 48).
//
// On 2026-11-19 three drivers were set INACTIVE → AVAILABLE through the app
// on dev, neither status writer opened an `AssetAssignment` period, and
// `findAuthorityDrift` failed every CI run on them. These tests drive BOTH
// writers — the record form's `updateDriver` and the bulk bar's
// `setRosterStatus` — through a recording transaction and read what each
// wrote to the period table, so a writer that stops calling the helper fails
// here by name, before an integration run or a production gate finds it.
// ---------------------------------------------------------------------------

const ORG = 'org_1'
const COMPANY = 'co_1'
const DRIVER = 'drv_1'

type Created = { data: Record<string, unknown> }

function recordingTx(input: { status: string; openPeriod: boolean }): {
  tx: TxClient
  created: Created[]
  updates: unknown[]
} {
  const created: Created[] = []
  const updates: unknown[] = []
  const row = {
    id: DRIVER,
    organizationId: ORG,
    companyId: COMPANY,
    dispatcherUserId: null,
    // No linked sign-in, so a termination's deactivation finds nothing.
    userId: null,
    status: input.status,
    firstName: 'Shukhrat',
    lastName: 'Fazliev',
    deletedAt: null,
    terminationDate: input.status === 'INACTIVE' ? new Date(0) : null,
  }
  const tx = {
    driver: {
      findUnique: async () => row,
      update: async (args: unknown) => {
        updates.push(args)
        return row
      },
    },
    assetAssignment: {
      findFirst: async (args: { where: { driverId?: string } }) =>
        input.openPeriod && args.where.driverId === DRIVER
          ? { id: 'period_open' }
          : null,
      create: async (args: Created) => {
        created.push(args)
        return args.data
      },
    },
  }
  return { tx: tx as unknown as TxClient, created, updates }
}

const form = { firstName: 'Shukhrat', lastName: 'Fazliev' }

describe('reactivates', () => {
  it('is true only for INACTIVE to a working status', () => {
    expect(reactivates('INACTIVE', 'AVAILABLE')).toBe(true)
    expect(reactivates('INACTIVE', 'VACATION')).toBe(true)
    expect(reactivates('INACTIVE', 'INACTIVE')).toBe(false)
    expect(reactivates('INACTIVE', undefined)).toBe(false)
    expect(reactivates('AVAILABLE', 'VACATION')).toBe(false)
    expect(reactivates('AVAILABLE', 'INACTIVE')).toBe(false)
  })
})

describe('the bulk bar (setRosterStatus)', () => {
  it('opens one period under the driver’s own authority when a terminated driver comes back', async () => {
    const { tx, created } = recordingTx({
      status: 'INACTIVE',
      openPeriod: false,
    })
    const outcome = await setRosterStatus(tx, DRIVER, 'AVAILABLE')
    expect(outcome.ok).toBe(true)
    expect(created).toHaveLength(1)
    expect(created[0]?.data).toMatchObject({
      organizationId: ORG,
      companyId: COMPANY,
      driverId: DRIVER,
    })
    // Dated by the schema's default, the moment of the write.
    expect(created[0]?.data).not.toHaveProperty('effectiveFrom')
  })

  it('leaves an open period alone, and opens nothing for a driver already at work', async () => {
    const already = recordingTx({ status: 'INACTIVE', openPeriod: true })
    await setRosterStatus(already.tx, DRIVER, 'AVAILABLE')
    expect(already.created).toHaveLength(0)

    const working = recordingTx({ status: 'AVAILABLE', openPeriod: false })
    await setRosterStatus(working.tx, DRIVER, 'VACATION')
    expect(working.created).toHaveLength(0)
  })

  it('opens nothing on a termination', async () => {
    const { tx, created } = recordingTx({
      status: 'AVAILABLE',
      openPeriod: false,
    })
    const outcome = await setRosterStatus(tx, DRIVER, 'INACTIVE')
    expect(outcome.ok).toBe(true)
    expect(created).toHaveLength(0)
  })
})

describe('the record form (updateDriver)', () => {
  it('opens one period when the form takes a terminated driver back to work', async () => {
    const { tx, created } = recordingTx({
      status: 'INACTIVE',
      openPeriod: false,
    })
    await updateDriver(tx, DRIVER, { ...form, status: 'AVAILABLE' })
    expect(created).toHaveLength(1)
    expect(created[0]?.data).toMatchObject({
      companyId: COMPANY,
      driverId: DRIVER,
    })
  })

  it('opens nothing when the form leaves the status as it is', async () => {
    const { tx, created } = recordingTx({
      status: 'INACTIVE',
      openPeriod: false,
    })
    await updateDriver(tx, DRIVER, form)
    expect(created).toHaveLength(0)
  })
})

describe('openPeriodOnReactivation', () => {
  it('says whether it opened one', async () => {
    const fresh = recordingTx({ status: 'INACTIVE', openPeriod: false })
    const driver = { id: DRIVER, organizationId: ORG, companyId: COMPANY }
    expect(
      await openPeriodOnReactivation(fresh.tx, driver, 'INACTIVE', 'AVAILABLE'),
    ).toBe(true)
    const open = recordingTx({ status: 'INACTIVE', openPeriod: true })
    expect(
      await openPeriodOnReactivation(open.tx, driver, 'INACTIVE', 'AVAILABLE'),
    ).toBe(false)
  })
})

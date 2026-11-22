import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadRowsFrom, type LoadRowSource } from '@/lib/load-list-rows'
import { isAssigned } from '@/lib/load-readiness'
import { trackerStep } from '@/lib/load-tracker'
import { loadStatusWord, loadStatusWordKey } from '@/lib/status'
import { translator } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// TMS §3.4 v11.44 (owner's ruling 2026-11-22): a Booked load with truck and
// driver reads "Assigned". A word, not a status — derived from `isAssigned`,
// the fact the tracker's third step reads, by one function both screens call.
// ---------------------------------------------------------------------------

const seats = [
  { driverId: null, truckId: null },
  { driverId: 'd1', truckId: null },
  { driverId: null, truckId: 't1' },
  { driverId: 'd1', truckId: 't1' },
] as const

const STATUSES = [
  'AVAILABLE',
  'BOOKED',
  'DISPATCHED',
  'AT_PICKUP',
  'LOADED',
  'IN_TRANSIT',
  'AT_DELIVERY',
  'DELIVERED',
  'POD_RECEIVED',
] as const

describe('loadStatusWord', () => {
  it('is Assigned only for Booked with both truck and driver', () => {
    expect(
      loadStatusWord({
        operationalStatus: 'BOOKED',
        driverId: 'd1',
        truckId: 't1',
      }),
    ).toBe('ASSIGNED')
    expect(
      loadStatusWord({
        operationalStatus: 'BOOKED',
        driverId: 'd1',
        truckId: null,
      }),
    ).toBe('BOOKED')
    expect(
      loadStatusWord({
        operationalStatus: 'BOOKED',
        driverId: null,
        truckId: 't1',
      }),
    ).toBe('BOOKED')
    expect(
      loadStatusWord({
        operationalStatus: 'DISPATCHED',
        driverId: 'd1',
        truckId: 't1',
      }),
    ).toBe('DISPATCHED')
  })

  it('agrees with the tracker: Assigned exactly when the step is the third', () => {
    let assignedSeen = 0
    for (const status of STATUSES) {
      for (const seat of seats) {
        const word = loadStatusWord({ operationalStatus: status, ...seat })
        const step = trackerStep({
          operationalStatus: status,
          billingStatus: 'UNINVOICED',
          assigned: isAssigned(seat),
        })
        expect(word === 'ASSIGNED', `${status} ${JSON.stringify(seat)}`).toBe(
          step === 3,
        )
        if (word === 'ASSIGNED') assignedSeen++
      }
    }
    // Both sides above zero: the agreement is not "neither ever says it".
    expect(assignedSeen).toBe(1)
  })

  it('has its word in both locales', () => {
    const en = translator('en')
    const ru = translator('ru')
    expect(en(loadStatusWordKey('ASSIGNED'))).toBe('Assigned')
    expect(ru(loadStatusWordKey('ASSIGNED'))).toBe('Назначен')
    expect(en(loadStatusWordKey('BOOKED'))).toBe('Booked')
  })
})

describe('the screens read the one word', () => {
  const source = (driver: boolean, truck: boolean): LoadRowSource => ({
    id: 'l1',
    loadNumber: '1001',
    referenceNumber: null,
    isCancelled: false,
    directSettled: false,
    operationalStatus: 'BOOKED',
    billingStatus: 'UNINVOICED',
    linehaulCents: 100_000,
    company: { name: 'RAM', timezone: 'America/Chicago' },
    customer: { id: 'c1', name: 'Werner' },
    driver: driver ? { id: 'd1', firstName: 'A', lastName: 'B' } : null,
    coDriver: null,
    truck: truck ? { id: 't1', unitNumber: '212' } : null,
    trailer: null,
    documents: [],
    stops: [],
  })
  const word = (driver: boolean, truck: boolean) =>
    loadRowsFrom([source(driver, truck)], new Map(), {
      now: new Date('2026-11-22T12:00:00Z'),
      locale: 'en',
    })[0]!.statusWord

  it('the loads list row carries it, the stored status untouched', () => {
    expect(word(true, true)).toBe('ASSIGNED')
    expect(word(true, false)).toBe('BOOKED')
    expect(word(false, true)).toBe('BOOKED')
  })

  it('the list labels by the word and the load page header asks the function', () => {
    const table = readFileSync('src/app/(app)/loads/LoadsTable.tsx', 'utf8')
    expect(table).toContain(
      'label={statusLabels[row.statusWord] ?? row.statusWord}',
    )
    const list = readFileSync('src/app/(app)/loads/page.tsx', 'utf8')
    expect(list).toContain("[...ALL_OPERATIONAL, 'ASSIGNED' as const]")
    const page = readFileSync('src/app/(app)/loads/[id]/page.tsx', 'utf8')
    expect(page).toContain('label={t(loadStatusWordKey(loadStatusWord(load)))}')
  })
})

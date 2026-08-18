import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { planSignature, planTrips } from '@/lib/trips-import'
import type { TripLeg } from '@/lib/trips-csv'

// ---------------------------------------------------------------------------
// THE PREVIEW-CONFIRM SCREEN.
//
// Two round trips, one write. Everything here is about the gap between them:
// what the second submit is allowed to write, and what it must refuse because
// nobody looked at it.
//
// The rules being guarded are the build's own, and each one is cheap to break
// by accident in a file this size:
//
//   RULE 6 — no money on this path. Relay's "Estimated Cost" is an internal
//            allocation (legs summing to ~$310 on a $1,776 trip) and writing
//            it near `rate` would put a number that is not the payout onto a
//            load that will be invoiced.
//   RULE 7 — nothing is auto-assigned. Driver and equipment are strings from
//            a CSV; matching them to records is a separate feature.
//   The permission — this screen books freight in bulk and is gated on
//            `load:create`, decided by `permissions.ts` like everything else.
// ---------------------------------------------------------------------------

const ACTIONS = 'src/app/(app)/loads/import/trips/actions.ts'
const FORM = 'src/app/(app)/loads/import/trips/TripsImportForm.tsx'
const PAGE = 'src/app/(app)/loads/import/trips/page.tsx'

/**
 * A file with its comments removed.
 *
 * A rule about what code does must be asserted against code. The first version
 * of the money test in `trips-writer.test.ts` matched the word "rate" inside a
 * comment explaining that rates are never touched — an assertion that punishes
 * the documentation making the rule findable.
 */
const codeOf = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const stop = (facilityCode: string) => ({
  facilityCode,
  plannedArrival: null,
  plannedDeparture: null,
  actualArrival: null,
  actualDeparture: null,
})

const leg = (over: Partial<TripLeg> = {}): TripLeg => ({
  tripId: 'T-115HXB4HH',
  loadId: '115HXB4HH',
  facilitySequence: 'DEN7->MKC6',
  status: 'Completed',
  distance: 583,
  distanceUnit: 'mi',
  shipperAccount: 'OutboundAmazonManaged',
  driverName: 'A DRIVER',
  trailerId: 'HV1',
  tractorId: 'ZP1',
  stops: [stop('DEN7'), stop('MKC6')],
  ...over,
})

const second = leg({
  loadId: '115HXB4HH-2',
  facilitySequence: 'MKC6->ORD5',
  stops: [stop('MKC6'), stop('ORD5')],
})

describe('the confirm writes only what the preview showed', () => {
  it('gives one file the same signature twice', () => {
    const legs = [leg(), second]
    expect(planSignature(planTrips(legs))).toBe(planSignature(planTrips(legs)))
  })

  it('changes when a trip is added', () => {
    const one = planSignature(planTrips([leg()]))
    const two = planSignature(
      planTrips([leg(), leg({ tripId: 'T-999ZZZ', loadId: '999ZZZ' })]),
    )
    expect(two).not.toBe(one)
  })

  it('changes when the mileage changes', () => {
    expect(planSignature(planTrips([leg({ distance: 600 })]))).not.toBe(
      planSignature(planTrips([leg({ distance: 583 })])),
    )
  })

  // A CANCELLED LEG APPEARING IS A DIFFERENT FILE even though the write drops
  // it — the preview COUNTED it out loud, so the sentence someone confirmed
  // was different.
  it('changes when a cancelled leg appears', () => {
    const withCancelled = planTrips([leg(), { ...second, status: 'Cancelled' }])
    expect(planSignature(withCancelled)).not.toBe(
      planSignature(planTrips([leg()])),
    )
  })

  // THE STALE PATH MUST NOT WRITE. Asserted against the source because the
  // branch is upstream of every database call in the action: if the guard is
  // deleted, nothing else in this suite notices.
  it('refuses a confirm whose signature does not match', () => {
    const code = codeOf(ACTIONS)
    expect(code).toContain('acknowledged !== signature')
    expect(code).toContain('stale: true')

    // The write happens after both gates, never before.
    const stale = code.indexOf('stale: true')
    const write = code.indexOf('createLoad(')
    expect(stale).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(stale)
  })
})

describe('rule 6 — no money reaches this screen', () => {
  it('never names a money field or the estimated cost', () => {
    for (const path of [ACTIONS, FORM, PAGE]) {
      const code = codeOf(path)
      for (const field of [
        'linehaulCents',
        'totalRevenueCents',
        'fuelSurchargeCents',
        'accessorialsCents',
        'Cost',
      ]) {
        expect(code, `${path} uses ${field}`).not.toContain(field)
      }
    }
  })
})

describe('rule 7 — nothing is auto-assigned', () => {
  // AS A KEY, NOT AS A SUBSTRING. The first version searched for the bare word
  // and failed on `trip.trailerIds` — the preview READING equipment, which is
  // the rule being obeyed rather than broken. What rule 7 forbids is writing
  // one, so the pattern is the assignment.
  const assignsField = (code: string, field: string) =>
    new RegExp(String.raw`\b${field}\b\s*:`).test(code)

  it('never sets a driver, truck or trailer', () => {
    const code = codeOf(ACTIONS)
    for (const field of ['driverId', 'truckId', 'trailerId']) {
      expect(assignsField(code, field), `the action sets ${field}`).toBe(false)
    }
  })

  // The pattern above can fail — proven here rather than assumed, because a
  // guard that matches nothing looks exactly like a rule being kept.
  it('has a pattern that catches an assignment', () => {
    expect(
      assignsField('await tx.load.update({ driverId: id })', 'driverId'),
    ).toBe(true)
    expect(assignsField('trip.trailerIds.join()', 'trailerId')).toBe(false)
  })

  // Shown, not assigned — and the screen says so where a dispatcher will read
  // it rather than only in a comment they will not.
  it('tells the dispatcher that in words', () => {
    expect(readFileSync(FORM, 'utf8')).toContain('labels.notAssigned')
  })
})

describe('the permission', () => {
  // BOTH ENDS. A page that hides the screen while the action still writes is
  // a lock on a door beside an open window; the action is the one that acts,
  // and it is the one this asserts hardest.
  it('gates the page and the action on load:create', () => {
    for (const path of [ACTIONS, PAGE]) {
      expect(codeOf(path)).toContain("currentUserCan('create', 'load')")
    }
  })

  // Every database call goes through the org-scoped helper, so row-level
  // security answers "whose loads?" before a query runs.
  it('reaches the database only through withCurrentOrg', () => {
    const code = codeOf(ACTIONS)
    expect(code).toContain('withCurrentOrg')
    expect(code).not.toMatch(/\bgetPrisma\b|\bnew PrismaClient\b/)
  })
})

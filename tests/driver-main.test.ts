import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DISPATCHER_ROLES,
  isDispatcherRole,
  photoOf,
  teamMatesFor,
  tenureOf,
} from '@/lib/driver-main'
import { REFERENCE_ERROR_KEYS } from '@/lib/reference'

// ---------------------------------------------------------------------------
// THE DRIVER RECORD'S MAIN TAB (§6.4 part 2, v11.22), WITHOUT A DATABASE.
//
// The derived facts — tenure, the photo, the team-mate — are pure functions and
// are tested as such. The wiring that could quietly lose data is tested against
// the source: a field `updateDriver` always writes and the new form does not
// render would be posted as absent and CLEARED on every save.
// ---------------------------------------------------------------------------

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

describe('tenure', () => {
  const now = utc(2026, 11, 17)

  it('is whole years and months from the hire date to today', () => {
    expect(tenureOf(utc(2024, 8, 17), null, now)).toEqual({
      years: 2,
      months: 3,
    })
  })

  it('counts a month only once its day has come', () => {
    expect(tenureOf(utc(2026, 10, 18), null, now)).toEqual({
      years: 0,
      months: 0,
    })
    expect(tenureOf(utc(2026, 10, 17), null, now)).toEqual({
      years: 0,
      months: 1,
    })
  })

  it('stops at the termination date', () => {
    expect(tenureOf(utc(2025, 1, 1), utc(2026, 1, 1), now)).toEqual({
      years: 1,
      months: 0,
    })
  })

  it('is nothing without a hire date, not zero', () => {
    expect(tenureOf(null, null, now)).toBeNull()
  })

  it('reads a termination before the hire as zero, never negative', () => {
    expect(tenureOf(utc(2026, 6, 1), utc(2026, 1, 1), now)).toEqual({
      years: 0,
      months: 0,
    })
  })
})

describe('the photo', () => {
  it('is the newest PHOTO document and nothing else', () => {
    const documents = [
      { id: 'cdl', type: 'CDL_COPY', uploadedAt: utc(2026, 11, 10) },
      { id: 'old', type: 'PHOTO', uploadedAt: utc(2026, 1, 1) },
      { id: 'new', type: 'PHOTO', uploadedAt: utc(2026, 6, 1) },
    ]
    expect(photoOf(documents)?.id).toBe('new')
    expect(photoOf(documents.slice(0, 1))).toBeNull()
  })
})

describe('the Team column', () => {
  const crew = (
    ...members: [string, string?][]
  ): { id: string; firstName: string; lastName: string; kind: string }[] =>
    members.map(([id, kind]) => ({
      id,
      firstName: id,
      lastName: 'X',
      kind: kind ?? 'PERSON',
    }))
  const crews = new Map([
    ['t1', crew(['a'], ['b'])],
    ['t2', crew(['c'], ['p', 'PAYEE'])],
    ['t3', crew(['d'])],
  ])

  it('names the other person on the same truck, both ways', () => {
    const mates = teamMatesFor(
      [
        { id: 'a', truckId: 't1' },
        { id: 'b', truckId: 't1' },
      ],
      crews,
    )
    expect(mates.get('a')?.id).toBe('b')
    expect(mates.get('b')?.id).toBe('a')
  })

  it('names nobody for a referral payee in the other seat, or a crew of one', () => {
    const mates = teamMatesFor(
      [
        { id: 'c', truckId: 't2' },
        { id: 'd', truckId: 't3' },
        { id: 'e', truckId: null },
      ],
      crews,
    )
    expect(mates.get('c')).toBeNull()
    expect(mates.get('d')).toBeNull()
    expect(mates.get('e')).toBeNull()
  })

  // A REMOVED OR TERMINATED DRIVER STILL CARRYING THE TRUCK'S ID does not hold
  // a seat (`HOLDS_SEAT`), so the crew does not list them and they have no
  // team-mate — whoever else is on the truck.
  it('names nobody for a driver who does not hold a seat themselves', () => {
    const mates = teamMatesFor([{ id: 'gone', truckId: 't1' }], crews)
    expect(mates.get('gone')).toBeNull()
  })

  it('reads the crews from the facts call, by team.ts own spelling', () => {
    const facts = readFileSync('src/lib/drivers-page.ts', 'utf8')
    expect(facts).toContain('crewOfTrucksSql(')
    expect(facts).toContain('crews: crewOfTrucksFrom(truckIds, row.crews)')
    const page = readFileSync('src/app/(app)/drivers/page.tsx', 'utf8')
    expect(page).toContain('teamMatesFor(')
    expect(page).toContain("key: 'team'")
  })
})

describe('the assigned dispatcher', () => {
  it('is one of the four roles that dispatch', () => {
    expect([...DISPATCHER_ROLES]).toEqual([
      'OWNER',
      'ADMIN',
      'MANAGER',
      'DISPATCHER',
    ])
    expect(isDispatcherRole('DISPATCHER')).toBe(true)
    expect(isDispatcherRole('ACCOUNTING')).toBe(false)
    expect(isDispatcherRole('DRIVER')).toBe(false)
  })

  it('is refused by the writer in words, from the same list the picker offers', () => {
    const fleet = readFileSync('src/lib/fleet.ts', 'utf8')
    expect(fleet).toContain('!isDispatcherRole(membership.role)')
    expect(fleet).toContain("new ReferenceError('dispatcher_not_member'")
    expect(REFERENCE_ERROR_KEYS.dispatcher_not_member).toBe(
      'ref.error.dispatcherNotMember',
    )
    const head = readFileSync('src/lib/driver-record-head.ts', 'utf8')
    expect(head).toContain('${[...DISPATCHER_ROLES]}::text[]')
  })

  it('may stay when it is the value already held', () => {
    const fleet = readFileSync('src/lib/fleet.ts', 'utf8')
    expect(fleet).toContain('if (userId === currentId) return userId')
  })
})

describe('the Main form posts what updateDriver writes', () => {
  const fleet = readFileSync('src/lib/fleet.ts', 'utf8')
  const update = fleet.slice(
    fleet.indexOf('export async function updateDriver('),
    fleet.indexOf('async function assignedDispatcher('),
  )
  const page = readFileSync('src/app/(app)/drivers/[id]/page.tsx', 'utf8')

  // THE HAZARD A NEW FORM BRINGS. `updateDriver` writes these columns on
  // every save, from whatever the form posts; a field the form stopped
  // rendering posts nothing and the column is CLEARED. So every one must be a
  // field on Main.
  it('renders every column updateDriver writes unconditionally', () => {
    const data = update.slice(update.indexOf('data: {'))
    const always = [...data.matchAll(/^ {6}(\w+): /gm)].map((m) => m[1]!)
    expect(always.length).toBeGreaterThan(10)
    for (const name of always) {
      expect(page, name).toContain(`name: '${name}'`)
    }
  })

  // THE FOUR NEW COLUMNS ARE WRITTEN ONLY WHEN SENT, so the import and the
  // seeds — which call `updateDriver` without them — clear nothing.
  it('writes the four new columns only when the caller sends them', () => {
    for (const name of ['middleName', 'birthDate', 'telegram']) {
      expect(update).toContain(`input.${name} !== undefined`)
    }
    expect(update).toContain('input.dispatcherUserId === undefined')
    const actions = readFileSync('src/app/(app)/drivers/actions.ts', 'utf8')
    for (const name of [
      'middleName',
      'birthDate',
      'telegram',
      'dispatcherUserId',
    ]) {
      expect(actions).toContain(`${name}: sent(formData, '${name}')`)
    }
    expect(actions).toContain(
      'formData.has(name) ? formData.get(name) : undefined',
    )
  })

  it('shows driver status and tenure as derived text, never a field', () => {
    expect(page).toContain('`dispatch.status.${driverStatus}`')
    expect(page).toContain('tenureOf(driver.hireDate, driver.terminationDate')
    expect(page).not.toContain("name: 'driverStatus'")
    expect(page).not.toContain("name: 'tenure'")
  })

  it('links Safety for the CDL expiry and has no SSN field', () => {
    expect(page).toContain("t('drivers.safetyLink')")
    expect(page).not.toContain("name: 'cdlExpiresAt'")
    expect(page.toLowerCase()).not.toMatch(/name: 'ssn'|socialsecurity/)
  })

  // OWNER'S RULING 2026-11-17, "keep derived": no stored pairing, no Main
  // flag, no co-driver picker, no percent salary.
  it('keeps the team derived, with nothing to set', () => {
    expect(page).not.toMatch(/name: '(coDriverId|teamMain|teamPercent\w*)'/)
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    expect(schema).not.toMatch(/teamPercent|teamMain|percentSalary/)
  })
})

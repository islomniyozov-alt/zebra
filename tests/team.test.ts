import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seatIsFree, teamMateOf, TRUCK_SEATS } from '@/lib/team'

// ---------------------------------------------------------------------------
// §6.4 PART 3 — TEAM DRIVERS. The pure halves, and the surfaces held to them.
// ---------------------------------------------------------------------------

describe('a truck carries up to two drivers', () => {
  it('has two seats, and the third is refused', () => {
    expect(TRUCK_SEATS).toBe(2)
    expect(seatIsFree(0)).toBe(true)
    expect(seatIsFree(1)).toBe(true)
    expect(seatIsFree(2)).toBe(false)
    expect(seatIsFree(3)).toBe(false)
  })

  it('applies the cap where the pairing is written, not on the form', () => {
    const fleet = readFileSync(join('src', 'lib', 'fleet.ts'), 'utf8')
    expect(fleet).toContain('assertSeatFree(')
    // Both writers — create and update — go through the one gate, and the
    // update names the driver so they are not counted against themselves.
    expect(fleet.match(/pairedTruck\(/g)?.length).toBeGreaterThanOrEqual(3)
    const fields = readFileSync(
      join('src', 'app', '(app)', 'drivers', 'fields.ts'),
      'utf8',
    )
    expect(fields).not.toMatch(/TRUCK_SEATS|seatIsFree/)
  })
})

describe('the team-mate', () => {
  const me = { id: 'a', kind: 'PERSON' }
  const you = { id: 'b', kind: 'PERSON' }
  const payee = { id: 'p', kind: 'PAYEE' }

  it('is the other person on the crew', () => {
    expect(teamMateOf([me, you], 'a')).toBe(you)
    expect(teamMateOf([me, you], 'b')).toBe(me)
  })

  it('is nobody on a crew of one', () => {
    expect(teamMateOf([me], 'a')).toBeNull()
    expect(teamMateOf([], 'a')).toBeNull()
  })

  it('is never a referral payee — the statement prints those apart', () => {
    expect(teamMateOf([me, payee], 'a')).toBeNull()
  })
})

describe('shown on both records, and offered on the load', () => {
  const driverPage = readFileSync(
    join('src', 'app', '(app)', 'drivers', '[id]', 'page.tsx'),
    'utf8',
  )
  const truckPage = readFileSync(
    join('src', 'app', '(app)', 'trucks', '[id]', 'page.tsx'),
    'utf8',
  )
  const loadPage = readFileSync(
    join('src', 'app', '(app)', 'loads', '[id]', 'page.tsx'),
    'utf8',
  )
  const doc = readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8')

  it('names the team-mate on the driver record and the crew on the truck', () => {
    expect(driverPage).toContain('teamMateFor(')
    expect(truckPage).toContain('crewOfTruck(')
    expect(doc).toContain('**3 — Team drivers.**')
  })

  it('suggests the second seat on the load and lets the dispatcher save it', () => {
    expect(loadPage).toContain('teamMateFor(')
    expect(loadPage).toContain('suggestedCoDriverId=')
    // A suggestion, not a write: the engine does not fill the seat.
    const loads = readFileSync(join('src', 'lib', 'loads.ts'), 'utf8')
    expect(loads).not.toMatch(/teamMateFor|crewOfTruck/)
  })
})

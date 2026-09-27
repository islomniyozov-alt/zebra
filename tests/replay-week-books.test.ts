import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// THE REPLAY SCRIPT, READ AS SOURCE — BECAUSE DEV CANNOT EXERCISE IT.
//
// Owner's ruling, 2026-09-27: "the replay's reclassify runs
// `terminatedYieldsToTruck`."
//
// ── WHY A SOURCE GREP AND NOT A BEHAVIOUR TEST ────────────────────────────
//
// The rule needs a truck with exactly one linked driver, and `Driver.
// assignedTruckId` IS UNPOPULATED ON DEV. Measured with
// `repair-terminated-attribution.ts` against dev on 2026-09-27: 3,489 loads name
// a terminated driver and every single one is left alone, "unit … linked to 0
// driver(s)". Production has those links and the same sweep moved ten loads
// there in September.
//
// So on dev the yield cannot fire, and three replayed weeks — 652 loads —
// produced zero reattributions. THAT IS NOT EVIDENCE THE WIRING WORKS. A
// passing suite is exactly what a silently-unwired call looks like, which is
// flag 47's whole lesson, so what can be checked is checked: the call exists,
// it is reached before the load's status moves, and its outcome is written.
//
// The DECISION itself is tested where it lives, against constructed drivers, in
// the Datatruck rules suite. This is about the call site only.
// ---------------------------------------------------------------------------

const SOURCE = readFileSync(
  join(process.cwd(), 'scripts', 'replay-week-books.ts'),
  'utf8',
)

describe('the reclassify runs the seat rule', () => {
  it('calls terminatedYieldsToTruck', () => {
    expect(SOURCE).toContain("from '@/lib/datatruck/loads'")
    expect(SOURCE).toContain('terminatedYieldsToTruck({')
  })

  // ── BEFORE THE POD, WHICH IS THE ORDER THAT MATTERS ─────────────────────
  //
  // Once the POD is stamped the load is settleable, and a settleable load
  // against a departed driver is a blocked statement somebody unpicks by hand.
  // Reattributing afterwards would leave a window — short, but the window is
  // the whole week for anything that reads the draft in between.
  it('decides the seat before it moves the status', () => {
    const yieldAt = SOURCE.indexOf('terminatedYieldsToTruck({')
    const transitionAt = SOURCE.indexOf('await transitionOperational(')
    expect(yieldAt).toBeGreaterThan(-1)
    expect(transitionAt).toBeGreaterThan(-1)
    expect(yieldAt).toBeLessThan(transitionAt)
  })

  // A REATTRIBUTION THAT IS NOT RECORDED IS UNAUDITABLE: the load would name
  // somebody the export never named, with nothing to compare against.
  it('writes the driver and an event carrying the original name', () => {
    const block = SOURCE.slice(
      SOURCE.indexOf('terminatedYieldsToTruck({'),
      SOURCE.indexOf('await transitionOperational('),
    )
    expect(block).toContain("if (yielded.kind === 'yield')")
    expect(block).toContain('data: { driverId: linked[0]!.id }')
    expect(block).toContain('REPLAY_REATTRIBUTION_NOTE')
    expect(block).toContain('yielded.note')
  })

  // MORE THAN ONE DRIVER ON THE TRUCK IS NOT A YIELD — which of them drove it
  // is a guess, and this script does not guess about pay.
  it('refuses to guess when the truck has two drivers', () => {
    expect(SOURCE).toContain('linked.length === 1')
  })

  // ── AND IT STILL CANNOT REACH PRODUCTION ────────────────────────────────
  //
  // Asserted here as well as in the prod-URL fence, because that fence checks
  // one variable name and this checks the posture: the script reads dev's
  // connection string and pins dev's organisation id.
  it('reads only the dev connection and pins the dev organisation', () => {
    expect(SOURCE).toContain('process.env.DIRECT_DATABASE_URL')
    expect(SOURCE).not.toContain('PROD_DIRECT_DATABASE_URL')
    expect(SOURCE).toContain('expectOrganizationId: DEV_ORGANIZATION_ID')
  })
})

import { describe, expect, it } from 'vitest'
import { COMPUTED_STATUSES, DECIDED_STATUSES } from '@/lib/billing-status'
import type { LoadBillingStatus } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// EVERY STATUS IS EITHER COMPUTED OR DECIDED — AND SAYING SO IS THE GUARD.
//
// `findBillingStatusDrift` filters on `COMPUTED_STATUSES`, positively. That
// shape exists because the negative one broke: `notIn: [...DECIDED]` sends
// every decided name to the database, and on 2026-09-10 adding
// `FILED_WITH_FACTOR` made `check:drift` — which reads PRODUCTION by design —
// fail on every machine with:
//
//   invalid input value for enum "LoadBillingStatus": "FILED_WITH_FACTOR"
//
// A new enum member is unusable in a query until its migration has reached
// production, and the window between writing the code and shipping the
// migration is exactly when `npm run check` runs most.
//
// The positive filter has no such window, and it carries one obligation in
// exchange: a new member must be put in one set or the other. This test makes
// forgetting impossible, and it fails by NAME so nobody has to diff two lists
// by eye.
//
// THE ENUM IS LISTED HERE RATHER THAN IMPORTED AS A VALUE. Prisma's generated
// enum object is a runtime import that drags the client into a pure test; the
// TYPE is enough to make the compiler check this list is complete, and the
// compiler is a better place for that than a test anyway.
// ---------------------------------------------------------------------------

/**
 * Every `LoadBillingStatus`, typed so the compiler enforces completeness.
 *
 * `satisfies` is doing the work: add a member to the schema and this stops
 * type-checking until it is listed, which is a build failure rather than a
 * test that quietly passes over it.
 */
const EVERY_STATUS = [
  'UNINVOICED',
  'READY_TO_INVOICE',
  'INVOICED',
  'PARTIALLY_PAID',
  'PAID',
  'DISPUTED',
  'WRITTEN_OFF',
  'FILED_WITH_FACTOR',
  'CLOSED_IN_DATATRUCK',
] as const satisfies readonly LoadBillingStatus[]

describe('the two status sets cover the enum exactly', () => {
  it('classifies every LoadBillingStatus as computed or decided', () => {
    const classified: readonly string[] = [
      ...COMPUTED_STATUSES,
      ...DECIDED_STATUSES,
    ]
    const unclassified = EVERY_STATUS.filter(
      (value) => !classified.includes(value),
    )
    expect(
      unclassified,
      `neither computed nor decided: ${unclassified.join(', ')}`,
    ).toEqual([])
  })

  it('never puts a status in both sets', () => {
    const both = COMPUTED_STATUSES.filter((value) =>
      DECIDED_STATUSES.includes(value),
    )
    expect(both, `in both sets: ${both.join(', ')}`).toEqual([])
  })

  // A COMPUTED STATUS MUST EXIST WHEREVER THE RULE HAS RUN. That is the
  // property the drift query leans on: it only ever sends these names.
  it('holds only statuses billingStatusFor can return', () => {
    expect([...COMPUTED_STATUSES]).toEqual([
      'UNINVOICED',
      'READY_TO_INVOICE',
      'INVOICED',
      'PARTIALLY_PAID',
      'PAID',
    ])
  })

  // THE NEW ONE, NAMED. Filing is a decision somebody made; arithmetic over
  // invoices and payments can neither produce it nor take it back.
  it('treats FILED_WITH_FACTOR as decided, never computed', () => {
    expect(DECIDED_STATUSES).toContain('FILED_WITH_FACTOR')
    expect(COMPUTED_STATUSES).not.toContain('FILED_WITH_FACTOR')
  })
})

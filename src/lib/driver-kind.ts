// ---------------------------------------------------------------------------
// A PERSON, OR SOMEBODY WHO TAKES A CUT.
//
// Owner's ruling, 2026-09-24. Production holds driver rows that are not
// people — `7 Star`, `Said truck 3609` — imported from Datatruck alongside the
// real ones. They are REFERRAL PAYEES: they take a commission on another
// driver's loads, and they settle exactly like anyone else.
//
// ── WHAT THE RULING DOES NOT SAY ──────────────────────────────────────────
//
// It does not say to inactivate them, and it says so explicitly. That is the
// obvious move and it is wrong: `INACTIVE` is a roster value that stops a
// person being dispatched, and these rows are not waiting to be dispatched —
// they are waiting to be paid. Marking them INACTIVE would have stopped the
// money, quietly, in a system where the driver finds out on Friday.
//
// So `kind` is a separate axis from `status`, for the same reason the schema
// keeps a load's operational and billing status apart: two questions that move
// independently must not share a column.
//
// ── WHAT IT EXCLUDES THEM FROM, AND WHY EACH ──────────────────────────────
//
//   DQF (49 CFR 391.51)      A qualification file for `7 Star` is a medical
//                            certificate and a road test nobody will ever
//                            produce. The file would be permanently
//                            incomplete and correctly so.
//   Compliance warnings      A warning that CANNOT be cleared is worse than
//                            no warning: it teaches people to scroll past the
//                            ones that can. Phase 4's whole argument.
//   Dispatch pickers         Nobody assigns a load to a commission.
//   Roster counts            "How many drivers do we have" is a question about
//                            people, and the answer is used for insurance and
//                            for CSA exposure.
//
// And what it does NOT exclude them from: pay rules, settlement, their own
// statement. Those are the point of the row existing.
//
// ── TEXT AGAINST A CODE LIST, LIKE `Truck.fleetStatus` ────────────────────
//
// Not a Prisma enum. The list and the four exclusions it drives live in one
// file, so the rule can be read in one place; an enum puts the values in the
// schema and the meaning here, and the two drift. `assertDriverKind` is the
// gate, at the one place a kind is written.
// ---------------------------------------------------------------------------

export const DRIVER_KINDS = ['PERSON', 'PAYEE'] as const

export type DriverKind = (typeof DRIVER_KINDS)[number]

/** What a row means when nobody said. Every existing row is a person. */
export const DEFAULT_DRIVER_KIND = 'PERSON' satisfies DriverKind

export function isDriverKind(value: string): value is DriverKind {
  return (DRIVER_KINDS as readonly string[]).includes(value)
}

/**
 * The gate. Refuses a kind outside the list, by name.
 *
 * `Truck.fleetStatus` learned this the same way: a text column with a code
 * list is only a code list if something refuses the values outside it, or it
 * is a free-text column with documentation.
 */
export function assertDriverKind(value: unknown): DriverKind {
  if (typeof value !== 'string' || !isDriverKind(value)) {
    throw new Error(
      `Not a driver kind: ${JSON.stringify(value)}. One of ${DRIVER_KINDS.join(', ')}.`,
    )
  }
  return value
}

/**
 * True for a row that is a commission rather than a person.
 *
 * TAKES THE FACTS, NOT A DRIVER ROW, so the four callers can each pass
 * whatever they already selected. Every one of them is a query that must not
 * grow a second definition of this.
 */
export function isReferralPayee(facts: { kind: string }): boolean {
  return facts.kind === 'PAYEE'
}

/**
 * The Prisma filter for "a person, for the purposes of being a driver".
 *
 * ONE SPELLING OF THE EXCLUSION, imported by DQF, the warnings, the pickers
 * and the roster counts. Four hand-written `kind: 'PERSON'` clauses would be
 * four places to miss when a third kind arrives, and the one that gets missed
 * is discovered as a DQF nobody filed.
 *
 * `not: 'PAYEE'` RATHER THAN `equals: 'PERSON'`, deliberately. A row carrying
 * some future kind — an agency, a leasing company — should keep showing up as
 * a person until somebody decides otherwise, because appearing wrongly in a
 * compliance list gets noticed and vanishing from one does not.
 */
export const PERSON_DRIVER = { kind: { not: 'PAYEE' } } as const

/**
 * How a payee is printed where a co-driver would be.
 *
 * The statement prints "Team with X" under the driver. For a commission that
 * is a lie about who was in the truck, and it is the line a driver reads when
 * they are checking their own pay.
 */
export function crewLabelFor(facts: { kind: string }): string {
  return isReferralPayee(facts) ? 'Referral' : 'Team with'
}

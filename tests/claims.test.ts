import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLAIM_LADDER,
  CLAIM_PARTY_ROLES,
  CLAIM_STATUSES,
  CLAIM_TYPES,
  mayTransition,
} from '@/lib/claims'
import {
  DATAQS_LADDER,
  DATAQS_OUTCOMES,
  DATAQS_STATUSES,
  mayTransition as mayChallengeTransition,
} from '@/lib/dataqs'
import type { ClaimStatus } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE TWO LADDERS.
//
// A claim's is not a rank — denied → disputed is an appeal and happens
// constantly — so it is an explicit table, and an explicit table is exactly the
// kind of thing that acquires a wrong row nobody notices. These tests are the
// notice.
//
// The screens read the same tables to build their selects, so a bad row here
// would produce a control that offers a move the service refuses. That is worse
// than a missing option: it teaches people the screen is guessing.
// ---------------------------------------------------------------------------

const schema = readFileSync(
  join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
)

const membersOf = (name: string) =>
  [
    ...(new RegExp(`^enum\\s+${name}\\s*\\{([\\s\\S]*?)^\\}`, 'm')
      .exec(schema)?.[1]
      ?.matchAll(/^\s{2}(\w+)\s*$/gm) ?? []),
  ].map((match) => match[1]!)

describe('the lists the screens offer', () => {
  it('found the enums at all', () => {
    // Without this the comparisons below pass vacuously if the regex breaks.
    expect(membersOf('ClaimStatus')).toHaveLength(6)
    expect(membersOf('DataQsStatus')).toHaveLength(4)
  })

  it('cover every member of every enum', () => {
    expect([...CLAIM_TYPES].sort()).toEqual(membersOf('ClaimType').sort())
    expect([...CLAIM_STATUSES].sort()).toEqual(membersOf('ClaimStatus').sort())
    expect([...CLAIM_PARTY_ROLES].sort()).toEqual(
      membersOf('ClaimPartyRole').sort(),
    )
    expect([...DATAQS_STATUSES].sort()).toEqual(
      membersOf('DataQsStatus').sort(),
    )
    expect([...DATAQS_OUTCOMES].sort()).toEqual(
      membersOf('DataQsOutcome').sort(),
    )
  })
})

describe('where a claim may go', () => {
  it('has a row for every status, and only real statuses in it', () => {
    // A missing key is a runtime crash the moment somebody opens a claim in
    // that status; an invented destination is a select offering a refusal.
    const known = new Set<string>(CLAIM_STATUSES)
    for (const status of CLAIM_STATUSES) {
      expect(CLAIM_LADDER[status], status).toBeDefined()
      for (const next of CLAIM_LADDER[status]) {
        expect(known.has(next), `${status} -> ${next}`).toBe(true)
      }
    }
  })

  it('never offers a status its own destination', () => {
    // Moving to where you already are is `unchanged`, not a move — and
    // offering it in the select would produce a timeline row saying nothing.
    for (const status of CLAIM_STATUSES) {
      expect(CLAIM_LADDER[status], status).not.toContain(status)
    }
  })

  it('lets a denial be appealed', () => {
    // The reason this is a table and not a rank. DENIED → DISPUTED goes
    // BACKWARDS by any ordering, and it is the most common move a claims desk
    // makes.
    expect(mayTransition('DENIED', 'DISPUTED')).toBe(true)
    expect(mayTransition('RESOLVED', 'DISPUTED')).toBe(true)
  })

  it('makes closed the end of it', () => {
    // A claim that comes back after closing is a NEW claim. Reopening would
    // destroy the meaning of the closing date on every report already run.
    expect(CLAIM_LADDER.CLOSED).toEqual([])
    for (const status of CLAIM_STATUSES) {
      expect(mayTransition('CLOSED', status), status).toBe(false)
    }
  })

  it('lets every other status reach closed', () => {
    // The pair for the rule above: if closing were unreachable from somewhere,
    // a claim could get stuck in a state with no way out.
    for (const status of CLAIM_STATUSES) {
      if (status === 'CLOSED') continue
      expect(mayTransition(status as ClaimStatus, 'CLOSED'), status).toBe(true)
    }
  })
})

describe('where a DataQs challenge may go', () => {
  it('only ever goes forward', () => {
    // FMCSA does not un-submit a filing. Withdrawing is not a step back
    // either — it is a CLOSED carrying the WITHDRAWN outcome.
    expect(mayChallengeTransition('SUBMITTED', 'DRAFT')).toBe(false)
    expect(mayChallengeTransition('UNDER_REVIEW', 'SUBMITTED')).toBe(false)
    expect(mayChallengeTransition('CLOSED', 'UNDER_REVIEW')).toBe(false)
  })

  it('lets a draft be closed without ever being filed', () => {
    // Written up, thought better of. The service leaves `submittedAt` null,
    // which is the truth about a filing that never happened.
    expect(mayChallengeTransition('DRAFT', 'CLOSED')).toBe(true)
  })

  it('has a row for every status and only real destinations in it', () => {
    const known = new Set<string>(DATAQS_STATUSES)
    for (const status of DATAQS_STATUSES) {
      expect(DATAQS_LADDER[status], status).toBeDefined()
      for (const next of DATAQS_LADDER[status]) {
        expect(known.has(next), `${status} -> ${next}`).toBe(true)
        expect(next, status).not.toBe(status)
      }
    }
  })

  it('makes closed terminal', () => {
    expect(DATAQS_LADDER.CLOSED).toEqual([])
  })
})

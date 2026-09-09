import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { extractionSpend, recordExtractionUsage } from '@/lib/extraction-usage'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE COST LEDGER, AGAINST REAL POSTGRES.
//
// Three things are worth proving here and none of them is "a row can be
// inserted":
//
//   A REFUSED READ IS STILL BILLED. The tokens were spent and the answer was
//   thrown away; a ledger that counted only accepted reads would understate by
//   exactly the refusal rate, which is the number a prompt change moves.
//
//   THE SUM IS THE QUESTION THE TABLE EXISTS FOR. "What did extraction cost
//   last month, by document type" was a note in a markdown file. If
//   `extractionSpend` cannot answer it over rows this test wrote, the table
//   has not replaced the note.
//
//   THE TENANT WALL HOLDS. A leak here does not show a wrong load — it shows
//   one carrier what another carrier costs to serve, which is commercial
//   information about a third party and the input to what they are charged.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let otherOrganizationId = ''
const nonce = Math.random().toString(36).slice(2, 8)

let userId = ''

/** The audited extension wants an actor; these writes have a real one. */
const attribution = () => ({
  userId,
  ip: null,
  userAgent: 'extraction-usage.test',
})

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: attribution(),
    maxWaitMs: 20_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const inOther = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(otherOrganizationId, fn, {
    attribution: attribution(),
    maxWaitMs: 20_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

/** A read that cost what the engine table measured for one rate confirmation. */
const RATE_CON_COST = {
  usage: { inputTokens: 4_593, outputTokens: 1_076 },
  model: 'gemini-3.6-flash',
  milliCents: 1_496,
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const mine = await owner.organization.create({
    data: { name: `Usage ${nonce}`, slug: `usage-${nonce}` },
  })
  organizationId = mine.id
  const theirs = await owner.organization.create({
    data: { name: `Rival ${nonce}`, slug: `rival-${nonce}` },
  })
  otherOrganizationId = theirs.id

  const user = await owner.user.create({
    data: { email: `usage-${nonce}@example.test`, name: 'Ledger Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.organization
    .delete({ where: { id: otherOrganizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('one row per engine call', () => {
  it('records an accepted read with its tokens and its money', async () => {
    await inOrg((tx) =>
      recordExtractionUsage(tx, organizationId, {
        documentType: 'RATE_CONFIRMATION',
        cost: RATE_CON_COST,
      }),
    )

    const row = await owner.extractionUsage.findFirstOrThrow({
      where: { organizationId, documentType: 'RATE_CONFIRMATION' },
    })
    expect(row.inputTokens).toBe(4_593)
    expect(row.outputTokens).toBe(1_076)
    expect(row.milliCents).toBe(1_496)
    expect(row.model).toBe('gemini-3.6-flash')
    // Not a fallback, so there is no second model to name. Storing the same
    // string twice would make "how often did we fall back" a comparison
    // instead of a filter.
    expect(row.askedModel).toBeNull()
    expect(row.refused).toBe(false)
    expect(row.reason).toBeNull()
  }, 300_000)

  // ── THE ONE THAT MATTERS ────────────────────────────────────────────────
  //
  // The medical reader refuses an unreadable expiry rather than guessing at
  // it, so this branch is not an edge case for that document — it is a
  // material share of its reads.
  it('records a REFUSED read, because the tokens were spent either way', async () => {
    await inOrg((tx) =>
      recordExtractionUsage(tx, organizationId, {
        documentType: 'MEDICAL_CARD',
        cost: {
          usage: { inputTokens: 2_000, outputTokens: 300 },
          model: 'gemini-3.6-flash',
          milliCents: 525,
        },
        refused: 'low_confidence_expiry',
      }),
    )

    const row = await owner.extractionUsage.findFirstOrThrow({
      where: { organizationId, documentType: 'MEDICAL_CARD' },
    })
    expect(row.refused).toBe(true)
    expect(row.reason).toBe('low_confidence_expiry')
    expect(row.milliCents).toBe(525)
  }, 300_000)

  it('names who was ASKED when somebody else answered', async () => {
    await inOrg((tx) =>
      recordExtractionUsage(tx, organizationId, {
        documentType: 'CDL_COPY',
        cost: {
          usage: {
            inputTokens: 1_500,
            outputTokens: 400,
            cacheWriteTokens: 900,
            cacheReadTokens: 8_000,
          },
          model: 'claude-sonnet-5',
          milliCents: 1_400,
          fellBackFrom: { model: 'gemini-3.6-flash', reason: 'http_error' },
        },
      }),
    )

    const row = await owner.extractionUsage.findFirstOrThrow({
      where: { organizationId, documentType: 'CDL_COPY' },
    })
    expect(row.model).toBe('claude-sonnet-5')
    expect(row.askedModel).toBe('gemini-3.6-flash')
    // Cache tokens are billed at different multiples of the input rate, so a
    // ledger that dropped them could not reproduce its own money figure.
    expect(row.cacheWriteTokens).toBe(900)
    expect(row.cacheReadTokens).toBe(8_000)
  }, 300_000)
})

describe('what did extraction cost, as a query', () => {
  it('sums by document type, dearest first, refusals counted', async () => {
    const spend = await inOrg((tx) =>
      extractionSpend(tx, {
        from: new Date('2020-01-01T00:00:00.000Z'),
        to: new Date('2100-01-01T00:00:00.000Z'),
      }),
    )

    expect(spend.map((row) => row.documentType)).toEqual([
      'RATE_CONFIRMATION',
      'CDL_COPY',
      'MEDICAL_CARD',
    ])

    const rateCon = spend.find((r) => r.documentType === 'RATE_CONFIRMATION')!
    expect(rateCon.reads).toBe(1)
    expect(rateCon.refused).toBe(0)
    expect(rateCon.milliCents).toBe(1_496)

    const medical = spend.find((r) => r.documentType === 'MEDICAL_CARD')!
    expect(medical.reads).toBe(1)
    // The refused read is IN the reads and IN the money, and countable on its
    // own. All three at once is the whole point of the column.
    expect(medical.refused).toBe(1)
    expect(medical.milliCents).toBe(525)
  }, 300_000)

  // HALF-OPEN, SO CONSECUTIVE MONTHS DO NOT DOUBLE-COUNT. A closed upper bound
  // counts a row written exactly at midnight in both months, which is the kind
  // of error that makes a cost report quietly disagree with itself.
  it('excludes the upper bound', async () => {
    const written = await owner.extractionUsage.findFirstOrThrow({
      where: { organizationId, documentType: 'RATE_CONFIRMATION' },
      select: { createdAt: true },
    })

    const upTo = await inOrg((tx) =>
      extractionSpend(tx, {
        from: new Date('2020-01-01T00:00:00.000Z'),
        to: written.createdAt,
      }),
    )
    expect(
      upTo.find((r) => r.documentType === 'RATE_CONFIRMATION'),
    ).toBeUndefined()

    const including = await inOrg((tx) =>
      extractionSpend(tx, {
        from: written.createdAt,
        to: new Date('2100-01-01T00:00:00.000Z'),
      }),
    )
    expect(
      including.find((r) => r.documentType === 'RATE_CONFIRMATION'),
    ).toBeDefined()
  }, 300_000)
})

describe('the tenant wall', () => {
  it('shows one organization nothing of what another spent', async () => {
    // The rival writes its own row, so this is not "an empty table sees
    // nothing" — which is true of every table with no rows in it and is the
    // most comfortable way to be wrong.
    await inOther((tx) =>
      recordExtractionUsage(tx, otherOrganizationId, {
        documentType: 'RATE_CONFIRMATION',
        cost: { ...RATE_CON_COST, milliCents: 99_999 },
      }),
    )

    const mine = await inOrg((tx) =>
      extractionSpend(tx, {
        from: new Date('2020-01-01T00:00:00.000Z'),
        to: new Date('2100-01-01T00:00:00.000Z'),
      }),
    )
    const rateCon = mine.find((r) => r.documentType === 'RATE_CONFIRMATION')!
    expect(rateCon.milliCents).toBe(1_496)
    expect(rateCon.reads).toBe(1)

    // And the owner, bypassing row-level security, can see both — which is
    // what proves the rival's row exists and was hidden rather than absent.
    const both = await owner.extractionUsage.count({
      where: {
        organizationId: { in: [organizationId, otherOrganizationId] },
        documentType: 'RATE_CONFIRMATION',
      },
    })
    expect(both).toBe(2)
  }, 300_000)

  // ── THE WALL, WATCHED REFUSING ──────────────────────────────────────────
  //
  // Every assertion above is about READING, and a read test passes just as
  // happily against a table whose policy was never applied — it would simply
  // find nothing, because nothing of the rival's was written into this
  // connection's view in the first place. That is the "sees no rows from the
  // other organization is true of an empty table" trap, one level up.
  //
  // So this asks the database to do the thing the policy exists to forbid:
  // write a row billed to ANOTHER tenant from inside this tenant's
  // transaction. `FORCE ROW LEVEL SECURITY` with a USING-only policy applies
  // that expression as the INSERT check, so Postgres must refuse. If this ever
  // passes, the ledger can be made to charge the wrong customer.
  it('REFUSES a row billed to another organization', async () => {
    await expect(
      inOrg((tx) =>
        recordExtractionUsage(tx, otherOrganizationId, {
          documentType: 'RATE_CONFIRMATION',
          cost: RATE_CON_COST,
        }),
      ),
    ).rejects.toThrow()

    // And nothing landed. A refusal that still wrote would be the worse of the
    // two failures, since the error would look like the wall working.
    const rivalRows = await owner.extractionUsage.count({
      where: { organizationId: otherOrganizationId },
    })
    expect(rivalRows).toBe(1)
  }, 300_000)
})

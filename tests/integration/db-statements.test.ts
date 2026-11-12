import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient, statementsOf } from '@/lib/db'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE STATEMENT COUNTER (GAPS 42, owner's instruction 2026-11-12: a
// `page.timing` line with the statement count on every request, so the next
// accounting pass ranks by count). The count is read from the client's own
// query events, the same source the two-statement budget in portal.test.ts
// reads — so what the tail prints and what the budget counts agree.
//
// Counted against a REAL client over a REAL socket, because the event log is
// a Prisma option and an option that is not set counts nothing while looking
// exactly like a request that ran no statements.
// ---------------------------------------------------------------------------

let client: PrismaClient

beforeAll(() => {
  client = createPrismaClient(process.env.DIRECT_DATABASE_URL!)
})

afterAll(async () => {
  await client.$disconnect()
})

/** The same sequence on a plain logging client, so the names are known. */
async function namesOf(sequence: (db: PrismaClient) => Promise<void>) {
  const { PrismaClient } = await import('@/generated/prisma/client')
  const { PrismaNeon } = await import('@prisma/adapter-neon')
  const logging = new PrismaClient({
    adapter: new PrismaNeon({
      connectionString: process.env.DIRECT_DATABASE_URL!,
    }),
    log: [{ emit: 'event', level: 'query' }],
  })
  const names: string[] = []
  logging.$on('query', (event) => void names.push(event.query.slice(0, 80)))
  await sequence(logging as unknown as PrismaClient)
  await logging.$disconnect()
  return names
}

const transaction = async (db: PrismaClient) => {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${'none'}, true)`
    await tx.organization.findFirst({ select: { id: true } })
  })
}

describe('every statement the client sends is counted, from its first', () => {
  it('starts at zero and counts a raw statement', async () => {
    expect(statementsOf(client)).toBe(0)
    await client.$queryRaw`select 1`
    expect(statementsOf(client)).toBe(1)
  })

  it('counts a transaction as exactly the statements the event log names', async () => {
    const names = await namesOf(transaction)
    // The setting and the read are in there by name; what Prisma logs around
    // them is whatever it logs — read on 2026-11-12: COMMIT is an event and
    // BEGIN is not, so a tenant transaction with one read costs THREE on the
    // line. The count is held to the log, not to a belief about the log.
    expect(
      names.some((sql) => sql.includes('set_config')),
      `names: ${names.join(' | ')}`,
    ).toBe(true)
    expect(
      names.some((sql) => /Organization/i.test(sql)),
      `names: ${names.join(' | ')}`,
    ).toBe(true)
    const before = statementsOf(client)!
    await transaction(client)
    expect(statementsOf(client)! - before, names.join(' | ')).toBe(names.length)
  })

  it('a relation read under relationJoins is ONE statement', async () => {
    const before = statementsOf(client)!
    await client.organization.findFirst({
      select: { id: true, companies: { select: { id: true }, take: 1 } },
    })
    expect(statementsOf(client)! - before).toBe(1)
  })

  it('a client not built here has no count — null, never zero', () => {
    expect(statementsOf({} as PrismaClient)).toBeNull()
  })
})

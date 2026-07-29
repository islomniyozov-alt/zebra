import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '@/lib/db'
import { runInOrg } from '@/lib/tenancy'
import { unattributed, type Attribution } from '@/lib/audit'
import {
  CounterAllocationError,
  allocateNumber,
  ensureCounters,
  peekCounter,
} from '@/lib/counters'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// §10. The interesting test is the concurrent one — the whole reason this
// goes through a counter rather than MAX(id) + 1 is what happens when two
// dispatchers book at the same moment.
// ---------------------------------------------------------------------------

let app: PrismaClient
let owner: PrismaClient

let orgA = ''
let orgB = ''
let companyA1 = ''
let companyA2 = ''
let companyB = ''
let attribution: Attribution

beforeAll(async () => {
  app = createPrismaClient(process.env.DATABASE_URL!)
  owner = createPrismaClient(process.env.DIRECT_DATABASE_URL!)
  const nonce = Math.random().toString(36).slice(2, 10)

  const a = await owner.organization.create({
    data: {
      name: 'Counters A',
      slug: `counters-a-${nonce}`,
      companies: { create: [{ name: 'RAM' }, { name: 'Dolphins' }] },
    },
    include: { companies: { orderBy: { name: 'asc' } } },
  })
  orgA = a.id
  companyA1 = a.companies[1]!.id // RAM
  companyA2 = a.companies[0]!.id // Dolphins

  const b = await owner.organization.create({
    data: {
      name: 'Counters B',
      slug: `counters-b-${nonce}`,
      companies: { create: { name: 'Other' } },
    },
    include: { companies: true },
  })
  orgB = b.id
  companyB = b.companies[0]!.id

  const user = await owner.user.create({
    data: { email: `counters-${nonce}@example.test`, name: 'Dispatcher' },
  })
  attribution = { userId: user.id }
})

afterAll(async () => {
  for (const id of [orgA, orgB]) {
    if (id) await owner.organization.delete({ where: { id } }).catch(() => {})
  }
  await owner.user.deleteMany({ where: { email: { startsWith: 'counters-' } } })
  await app.$disconnect()
  await owner.$disconnect()
})

// Each interactive transaction holds a pooled connection for its whole life,
// so a hundred at once queue behind the pool rather than running at once.
// Prisma gives up after 2s by default; batch() says "wait your turn" instead,
// which is what a caller doing bulk work has to say out loud.
// A function, because `attribution` is not assigned until beforeAll runs.
const batch = () =>
  ({ attribution, maxWaitMs: 60_000, timeoutMs: 15_000 }) as const

const allocate = (companyId: string, orgId = orgA) =>
  runInOrg(app, orgId, (tx) => allocateNumber(tx, companyId, 'LOAD_NUMBER'), {
    attribution,
  })

describe('allocateNumber', () => {
  it('creates the series on first use and then counts up', async () => {
    const first = await allocate(companyA1)
    const second = await allocate(companyA1)
    const third = await allocate(companyA1)

    expect(second).toBe(first + 1)
    expect(third).toBe(second + 1)
  })

  it('gives each authority its own series', async () => {
    // RAM Haulage's load 1001 and Dolphins Transport's load 1001 are different
    // loads. A shared series would leak one carrier's volume to the other's
    // brokers.
    const ram = await allocate(companyA1)
    const dolphins = await allocate(companyA2)

    const ramCounter = await runInOrg(
      app,
      orgA,
      (tx) => peekCounter(tx, companyA1, 'LOAD_NUMBER'),
      { attribution: unattributed('read-only counter check') },
    )
    const dolphinsCounter = await runInOrg(
      app,
      orgA,
      (tx) => peekCounter(tx, companyA2, 'LOAD_NUMBER'),
      { attribution: unattributed('read-only counter check') },
    )

    expect(ramCounter).toBe(ram)
    expect(dolphinsCounter).toBe(dolphins)
    // Dolphins started fresh regardless of how far RAM had counted.
    expect(dolphins).toBeLessThan(ram)
  })

  it('keeps the three keys independent', async () => {
    const load = await runInOrg(
      app,
      orgA,
      (tx) => allocateNumber(tx, companyA1, 'LOAD_NUMBER'),
      { attribution },
    )
    const invoice = await runInOrg(
      app,
      orgA,
      (tx) => allocateNumber(tx, companyA1, 'INVOICE_NUMBER'),
      { attribution },
    )
    expect(invoice).toBeLessThan(load)
  })

  it('refuses a company in another organization', async () => {
    // Row-level security filters the company out of the insert's SELECT, so
    // there is nothing to increment and nothing to guess.
    await expect(allocate(companyB, orgA)).rejects.toThrow(
      CounterAllocationError,
    )
  })

  it('refuses a company that does not exist', async () => {
    await expect(allocate('cms5nope000000000000000zz')).rejects.toThrow(
      CounterAllocationError,
    )
  })

  it('fails rather than allocating with no tenant set', async () => {
    // Counter is behind RLS. A transaction with no org set updates nothing,
    // and the company lookup finds nothing either — so it throws instead of
    // inventing a number.
    await expect(
      app.$transaction((tx) => allocateNumber(tx, companyA1, 'LOAD_NUMBER')),
    ).rejects.toThrow(CounterAllocationError)
  })
})

describe('ensureCounters', () => {
  it('creates all three series without consuming a number', async () => {
    await runInOrg(app, orgA, (tx) => ensureCounters(tx, companyA2), {
      attribution,
    })

    const values = await runInOrg(
      app,
      orgA,
      async (tx) => ({
        load: await peekCounter(tx, companyA2, 'LOAD_NUMBER'),
        invoice: await peekCounter(tx, companyA2, 'INVOICE_NUMBER'),
        settlement: await peekCounter(tx, companyA2, 'SETTLEMENT_NUMBER'),
      }),
      { attribution: unattributed('read-only counter check') },
    )

    expect(values.invoice).toBe(1000)
    expect(values.settlement).toBe(1000)
    // LOAD_NUMBER was already in use from an earlier test and must not reset.
    expect(values.load).toBeGreaterThanOrEqual(1000)
  })

  it('is idempotent', async () => {
    const before = await runInOrg(
      app,
      orgA,
      (tx) => peekCounter(tx, companyA2, 'INVOICE_NUMBER'),
      { attribution: unattributed('read-only counter check') },
    )
    await runInOrg(app, orgA, (tx) => ensureCounters(tx, companyA2), {
      attribution,
    })
    const after = await runInOrg(
      app,
      orgA,
      (tx) => peekCounter(tx, companyA2, 'INVOICE_NUMBER'),
      { attribution: unattributed('read-only counter check') },
    )
    expect(after).toBe(before)
  })
})

describe('under concurrency', () => {
  it('survives 100 simultaneous allocations with no duplicates', async () => {
    // The acceptance criterion, and the reason the Telegram bot's invoice
    // numbering broke. Each call is its own transaction, so they genuinely
    // race; Postgres serialises them on the row lock.
    const company = await owner.company.create({
      data: { organizationId: orgA, name: `Race ${Date.now()}` },
    })

    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        runInOrg(
          app,
          orgA,
          (tx) => allocateNumber(tx, company.id, 'INVOICE_NUMBER'),
          batch(),
        ),
      ),
    )

    expect(results).toHaveLength(100)
    expect(new Set(results).size).toBe(100)

    // Not merely distinct — a contiguous run, which is what a numbering series
    // has to be for an accountant to trust it.
    const sorted = [...results].sort((a, b) => a - b)
    expect(sorted[99]! - sorted[0]!).toBe(99)

    const final = await runInOrg(
      app,
      orgA,
      (tx) => peekCounter(tx, company.id, 'INVOICE_NUMBER'),
      { attribution: unattributed('read-only counter check') },
    )
    expect(final).toBe(sorted[99])
  }, 180_000)

  it('does not let two authorities racing interfere', async () => {
    const [first, second] = await Promise.all([
      owner.company.create({
        data: { organizationId: orgA, name: `P ${Date.now()}` },
      }),
      owner.company.create({
        data: { organizationId: orgA, name: `Q ${Date.now()}` },
      }),
    ])

    const results = await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        runInOrg(
          app,
          orgA,
          (tx) =>
            allocateNumber(
              tx,
              index % 2 === 0 ? first.id : second.id,
              'SETTLEMENT_NUMBER',
            ),
          batch(),
        ).then((value) => ({
          company: index % 2 === 0 ? 'first' : 'second',
          value,
        })),
      ),
    )

    for (const which of ['first', 'second']) {
      const values = results
        .filter((r) => r.company === which)
        .map((r) => r.value)
      expect(new Set(values).size).toBe(values.length)
    }
  }, 120_000)
})

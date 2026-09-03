import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createLoad, LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE REPAIR SCRIPT, RUN — AND NOT FOR THE FIRST TIME ON PRODUCTION.
//
// `backfill-direct-pod.mjs` stamps the POD on direct-settled loads already
// sitting at DELIVERED, which the 2026-09-03 ruling cannot reach on its own:
// `transitionOperational` returns `unchanged` when `from === to`, before the
// follow-on, so those loads stay outside `settleableWhere` forever while
// reading Delivered on every screen.
//
// IT WRITES TO MONEY-BEARING ROWS AND HAD NEVER EXECUTED. A dev dry run
// returned zero candidates, which proved the SELECT parses and nothing else —
// the listing loop, the driverless warning and the whole `--apply` path were
// unexercised, and the first execution would have been on production during an
// attempt to fix pay. That is the shape this repository avoids everywhere else
// and there is no reason this path is the exception.
//
// SO IT RUNS HERE, against the worker database this suite already builds and
// throws away. `tests/setup-integration.ts` has routed `DIRECT_DATABASE_URL` to
// that database, so spawning the script with `ZEBRA_TARGET=dev` points it at a
// disposable copy carrying fixtures shaped like the real problem.
//
// THE SCRIPT IS SPAWNED, NOT IMPORTED. Its SQL, its transaction, its argument
// parsing and its output are the subject; importing a function out of it would
// test a different program from the one the owner will run.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let directCustomerId = ''
let brokerCustomerId = ''
let driverId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const SCRIPT = join(process.cwd(), 'scripts', 'backfill-direct-pod.mjs')

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'backfill.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 15_000,
  })

/** The script, exactly as the owner runs it. */
function backfill(...args: string[]): string {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ZEBRA_TARGET: 'dev',
      // Explicit rather than inherited-and-hoped-for: if the per-worker
      // routing ever stopped applying, this test would otherwise write to the
      // shared dev database and pass.
      DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL!,
    },
  })
}

const day = (d: number, hour = 8) => new Date(Date.UTC(2026, 6, d, hour, 0, 0))

/**
 * A load parked exactly where the ruling cannot reach it.
 *
 * Written with the raw client rather than through `transitionOperational`,
 * because the whole point is freight that reached DELIVERED before the
 * follow-on existed — which is a state the engine will no longer produce for
 * direct-settled freight, and so cannot be staged through it.
 */
async function strandedLoad(options: {
  tag: string
  customerId: string
  withDriver?: boolean
  withDeliveredEvent?: boolean
  deliveredAt?: Date
}) {
  const load = await inOrg((tx) =>
    createLoad(tx, organizationId, {
      companyId,
      customerId: options.customerId,
      referenceNumber: `T-${options.tag}-${nonce}`,
      linehaulCents: 100_000,
      stops: [
        { type: 'PICKUP', city: 'Memphis', state: 'TN', scheduledAt: day(1) },
        { type: 'DELIVERY', city: 'Chicago', state: 'IL', scheduledAt: day(2) },
      ],
    }),
  )

  await owner.load.update({
    where: { id: load.id },
    data: {
      operationalStatus: 'DELIVERED',
      ...(options.withDriver === false ? {} : { driverId }),
    },
  })

  if (options.withDeliveredEvent !== false) {
    await owner.loadStatusEvent.create({
      data: {
        loadId: load.id,
        organizationId,
        axis: 'OPERATIONAL',
        fromStatus: 'DISPATCHED',
        toStatus: 'DELIVERED',
        outcome: 'APPLIED',
        source: 'INTEGRATION',
        occurredAt: options.deliveredAt ?? day(2, 18),
      },
    })
  }

  return load.id
}

const podEvents = (loadId: string) =>
  owner.loadStatusEvent.findMany({
    where: {
      loadId,
      axis: 'OPERATIONAL',
      toStatus: 'POD_RECEIVED',
      outcome: 'APPLIED',
    },
    select: { occurredAt: true, source: true, note: true },
  })

const statusOf = async (loadId: string) =>
  (
    await owner.load.findUniqueOrThrow({
      where: { id: loadId },
      select: { operationalStatus: true },
    })
  ).operationalStatus

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Backfill ${nonce}`,
      slug: `backfill-${nonce}`,
      maxCompanies: 2,
      companies: { create: [{ name: `Carrier ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id

  const user = await owner.user.create({
    data: { email: `backfill-${nonce}@example.test`, name: 'Backfill Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  directCustomerId = (
    await owner.customer.create({
      data: {
        organizationId,
        name: `Relay ${nonce}`,
        type: 'SHIPPER',
        settlesDirectly: true,
      },
    })
  ).id

  brokerCustomerId = (
    await owner.customer.create({
      data: { organizationId, name: `Broker ${nonce}`, type: 'BROKER' },
    })
  ).id

  driverId = (
    await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'Dilshod',
        lastName: `Nazarov ${nonce}`,
      },
    })
  ).id
})

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('the dry run, which is what the owner reads first', () => {
  it('names the load, and writes absolutely nothing', async () => {
    const loadId = await strandedLoad({
      tag: 'DRY',
      customerId: directCustomerId,
    })

    const output = backfill()

    expect(output).toContain('Dry run')
    expect(output).toContain(`T-DRY-${nonce}`)
    expect(output).toContain('Dry run — nothing was written')

    // THE HALF THAT MATTERS. A dry run that moved a load would be the worst
    // possible defect in a script whose entire safety story is "read it first".
    expect(await statusOf(loadId)).toBe('DELIVERED')
    expect(await podEvents(loadId)).toHaveLength(0)
  })

  it('says so when a load has no driver, because a POD alone will not pay it', async () => {
    await strandedLoad({
      tag: 'NODRV',
      customerId: directCustomerId,
      withDriver: false,
    })

    const output = backfill()
    expect(output).toContain('NO DRIVER')
    expect(output).toContain('will still not settle')
  })

  it('refuses a load it has no delivered time for, rather than guessing', async () => {
    await strandedLoad({
      tag: 'NOEVT',
      customerId: directCustomerId,
      withDeliveredEvent: false,
    })

    const output = backfill()
    expect(output).toContain('NO DELIVERED EVENT')
    expect(output).toContain('refused for want of a Delivered event')
  })

  it('leaves broker freight out of it entirely', async () => {
    await strandedLoad({ tag: 'BROKER', customerId: brokerCustomerId })

    const output = backfill()
    // Broker freight reaches POD through a POD document, which is real
    // paperwork this carrier holds. Stamping one would be inventing a record.
    expect(output).not.toContain(`T-BROKER-${nonce}`)
  })
})

describe('--apply, on freight nobody could have been paid for', () => {
  it('stamps the POD at the DELIVERED time, not at the clock', async () => {
    const delivered = day(11, 22)
    const loadId = await strandedLoad({
      tag: 'APPLY',
      customerId: directCustomerId,
      deliveredAt: delivered,
    })

    const output = backfill('--apply')
    expect(output).toContain('APPLYING')

    expect(await statusOf(loadId)).toBe('POD_RECEIVED')

    const events = await podEvents(loadId)
    expect(events).toHaveLength(1)

    // THE ASSERTION THE WHOLE SCRIPT TURNS ON. `settleableWhere` keys the pay
    // period on this timestamp. Stamping `now()` would sweep every stranded
    // load into whichever week the repair happened to be run, and pay a
    // summer of freight at once.
    expect(events[0]!.occurredAt.toISOString()).toBe(delivered.toISOString())

    // §7: never set by hand, and a message KEY rather than a sentence, so the
    // timeline renders it in the reader's language.
    expect(events[0]!.source).toBe('AUTOMATIC')
    expect(events[0]!.note).toBe('status.note.podConfirmed')
  })

  it('changes nothing the second time it is run', async () => {
    const loadId = await strandedLoad({
      tag: 'TWICE',
      customerId: directCustomerId,
    })

    backfill('--apply')
    const first = await podEvents(loadId)
    expect(first).toHaveLength(1)

    // IDEMPOTENCE IS NOT A NICETY HERE. A second run that stamped again would
    // put two POD events in one pay period, and a settlement counts events.
    const second = backfill('--apply')
    expect(await podEvents(loadId)).toHaveLength(1)
    // ASSERTED AS BEHAVIOUR, NOT AS WORDING. An earlier version looked for
    // "Nothing to do", which only prints when NOTHING matches the three
    // conditions — and a sibling fixture with no Delivered event matches them
    // forever, by design, because a permanent refusal is something the owner
    // should keep seeing. The claim is that the second run STAMPS nothing.
    expect(second).toContain('0 load(s) stamped')
  })

  it('still refuses the load with no delivered time, even under --apply', async () => {
    const loadId = await strandedLoad({
      tag: 'STILL',
      customerId: directCustomerId,
      withDeliveredEvent: false,
    })

    backfill('--apply')

    // The refusal is not a dry-run courtesy; it is the script declining to
    // invent a timestamp that decides which week somebody is paid in.
    expect(await statusOf(loadId)).toBe('DELIVERED')
    expect(await podEvents(loadId)).toHaveLength(0)
  })

  it('moves the billing cache with it', async () => {
    const loadId = await strandedLoad({
      tag: 'BILL',
      customerId: directCustomerId,
    })

    backfill('--apply')

    const load = await owner.load.findUniqueOrThrow({
      where: { id: loadId },
      select: { billingStatus: true },
    })
    // `billingStatusFor`: direct-settled, nothing applied, POD in, rate on it.
    // A stale cache here would leave the load out of the queue that matches it
    // against Amazon's weekly statement.
    expect(load.billingStatus).toBe('READY_TO_INVOICE')
  })
})

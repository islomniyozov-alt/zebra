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

async function bootstrap() {
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
}

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

// THE FIXTURES ARE BUILT ONCE AND THE SCRIPT RUNS THREE TIMES, which is a
// deliberate change from a version that spawned it ten times.
//
// Each spawn is a Node process opening its own connection to a database branch
// that is already carrying eight test workers. The ten-spawn version went into
// the gate and four unrelated files blew their 20-second transaction ceiling by
// one to eight seconds — flag 83's thin margin, pushed over by this file.
//
// It is also the better shape on its own terms: the script is a BATCH over
// everything that qualifies, and running it once across a corpus of fixtures is
// how the owner will actually use it. Ten runs of one load each tested a
// program nobody executes.
let dryRun = ''
let stampedAt: Date
let strandedId = ''
let driverlessId = ''
let noEventId = ''
let brokerId = ''

beforeAll(async () => {
  await bootstrap()

  stampedAt = day(11, 22)
  strandedId = await strandedLoad({
    tag: 'STAMP',
    customerId: directCustomerId,
    deliveredAt: stampedAt,
  })
  driverlessId = await strandedLoad({
    tag: 'NODRV',
    customerId: directCustomerId,
    withDriver: false,
  })
  noEventId = await strandedLoad({
    tag: 'NOEVT',
    customerId: directCustomerId,
    withDeliveredEvent: false,
  })
  brokerId = await strandedLoad({ tag: 'BROKER', customerId: brokerCustomerId })

  dryRun = backfill()
})

describe('the dry run, which is what the owner reads first', () => {
  it('names each load it would stamp', () => {
    expect(dryRun).toContain('Dry run')
    expect(dryRun).toContain(`T-STAMP-${nonce}`)
  })

  it('says which ones have no driver, because a POD alone will not pay them', () => {
    expect(dryRun).toContain('NO DRIVER')
    expect(dryRun).toContain('will still not settle')
  })

  it('refuses a load it has no delivered time for, rather than guessing', () => {
    expect(dryRun).toContain('NO DELIVERED EVENT')
    expect(dryRun).toContain('refused for want of a Delivered event')
  })

  it('leaves broker freight out of it entirely', () => {
    // Broker freight reaches POD through a POD document, which is real
    // paperwork this carrier holds. Stamping one would be inventing a record.
    expect(dryRun).not.toContain(`T-BROKER-${nonce}`)
  })

  it('writes absolutely nothing', async () => {
    // THE HALF THAT MATTERS. A dry run that moved a load would be the worst
    // possible defect in a script whose entire safety story is "read it first".
    for (const id of [strandedId, driverlessId, noEventId, brokerId]) {
      expect(await statusOf(id)).toBe('DELIVERED')
      expect(await podEvents(id)).toHaveLength(0)
    }
  })
})

describe('--apply, on freight nobody could have been paid for', () => {
  let applied = ''
  let second = ''

  beforeAll(() => {
    applied = backfill('--apply')
    // Immediately again. Idempotence is not a nicety here: a second stamp
    // would put two POD events in one pay period, and a settlement counts
    // events.
    second = backfill('--apply')
  })

  it('stamps the POD at the DELIVERED time, not at the clock', async () => {
    expect(applied).toContain('APPLYING')
    expect(await statusOf(strandedId)).toBe('POD_RECEIVED')

    const events = await podEvents(strandedId)
    expect(events).toHaveLength(1)

    // THE ASSERTION THE WHOLE SCRIPT TURNS ON. `settleableWhere` keys the pay
    // period on this timestamp. Stamping `now()` would sweep every stranded
    // load into whichever week the repair happened to be run, and pay a
    // summer of freight at once.
    expect(events[0]!.occurredAt.toISOString()).toBe(stampedAt.toISOString())

    // §7: never set by hand, and a message KEY rather than a sentence, so the
    // timeline renders it in the reader's language.
    expect(events[0]!.source).toBe('AUTOMATIC')
    expect(events[0]!.note).toBe('status.note.podConfirmed')
  })

  it('stamps the driverless load too, and still says it will not settle', async () => {
    // The POD is honest — the freight was delivered. What it does NOT do is
    // make the load payable, and the dry run said so before anyone ran this.
    expect(await statusOf(driverlessId)).toBe('POD_RECEIVED')
    expect(dryRun).toContain('NO DRIVER')
  })

  it('still refuses the load with no delivered time', async () => {
    // Not a dry-run courtesy: the script declines to invent a timestamp that
    // decides which week somebody is paid in.
    expect(await statusOf(noEventId)).toBe('DELIVERED')
    expect(await podEvents(noEventId)).toHaveLength(0)
  })

  it('never touches broker freight', async () => {
    expect(await statusOf(brokerId)).toBe('DELIVERED')
    expect(await podEvents(brokerId)).toHaveLength(0)
  })

  it('moves the billing cache with it', async () => {
    const load = await owner.load.findUniqueOrThrow({
      where: { id: strandedId },
      select: { billingStatus: true },
    })
    // `billingStatusFor`: direct-settled, nothing applied, POD in, rate on it.
    // A stale cache here would leave the load out of the queue that matches it
    // against Amazon's weekly statement.
    expect(load.billingStatus).toBe('READY_TO_INVOICE')
  })

  it('changes nothing the second time it is run', async () => {
    expect(await podEvents(strandedId)).toHaveLength(1)
    // ASSERTED AS BEHAVIOUR, NOT AS WORDING. An earlier version looked for
    // "Nothing to do", which only prints when NOTHING matches the three
    // conditions — and the load with no Delivered event matches them forever,
    // by design, because a permanent refusal is something the owner should
    // keep seeing. The claim is that the second run STAMPS nothing.
    expect(second).toContain('0 load(s) stamped')
  })
})

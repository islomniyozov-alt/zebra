import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'

// ---------------------------------------------------------------------------
// WHAT A PAST WEEK LOOKS LIKE ON DEV BEFORE IT IS REPLAYED.
//
//   npx tsx -r dotenv/config scripts/inspect-replay-week.ts --week 2026-08-30
//
// SELECT ONLY, AND DEV ONLY.
//
// ── DEV BY CONSTRUCTION, NOT BY A FLAG NOBODY PASSED ──────────────────────
//
// Owner's ruling, 2026-09-27: this replay runs on DEV, never production. Every
// other script in this folder takes `--production` and reads the production
// connection variable when given it. This file does not name that variable at
// all — not even in a comment, because `tests/prod-url-guard.test.ts` scans each
// file as text and a mention is indistinguishable from a read. So production is
// not reachable from here by forgetting a flag or pasting an old command.
//
// That is the same posture as the `run-status` wrapper and `watch-guard`: name a
// mechanism rather than a disposition. A `--production` guard I promise not to
// pass is a disposition. Not having the string is a mechanism, and it is why
// this script needs no entry in `tests/prod-url-guard.test.ts` — the fence has
// nothing to hold.
//
// ── WHAT IT ASKS ──────────────────────────────────────────────────────────
//
// A replay needs four numbers that people keep collapsing into one:
//
//   delivered in the week   — freight that ran, whatever its books say
//   closed history          — `CLOSED_IN_DATATRUCK`, which `SETTLEABLE_LOAD`
//                             excludes, so none of it can be settled today
//   already live            — POD_RECEIVED with an event dated in the week
//   settleable              — all of the above AND somebody in a seat
//
// The gap between the third and the fourth is drivers with no seat, and the gap
// between the second and the third is the whole of what the reclassify does.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const arg = (name: string): string | null => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? null : (process.argv[at + 1] ?? null)
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const heading = (text: string) => {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 78)))
}

/**
 * The week, as UTC instants covering the whole of both end days.
 *
 * INCLUSIVE OF THE LAST DAY TO ITS LAST MILLISECOND. A period ending at
 * midnight excludes everything that delivered on the Saturday, which on the
 * 9/13 week was four loads and looked like an importer fault for an hour.
 */
function weekBounds(week: string) {
  const start = new Date(`${week}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime())) throw new Error(`Bad --week: ${week}`)
  if (start.getUTCDay() !== 0) {
    throw new Error(
      `--week must be a Sunday; ${week} is day ${start.getUTCDay()}. ` +
        `The settlement week is Sunday to Saturday — both Datatruck statements ` +
        `for 8/30 print Period Start 8/30/2026 and Period End 9/5/2026.`,
    )
  }
  const end = new Date(start.getTime() + 7 * 86_400_000 - 1)
  return { start, end }
}

async function main(): Promise<void> {
  const week = arg('week')
  if (!week) throw new Error('Name --week (a Sunday, e.g. --week 2026-08-30).')
  const { start, end } = weekBounds(week)

  const url = process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.')
  const db = createPrismaClient(url)

  console.log('Target: DEV (this script cannot reach production)')
  console.log(`Week:   ${start.toISOString()} .. ${end.toISOString()}`)

  const organizations = await db.organization.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { loads: true } },
    },
  })
  heading('ORGANISATIONS ON DEV')
  for (const org of organizations) {
    console.log(
      `  ${org.id}  ${org.slug.padEnd(22)} ${String(org._count.loads).padStart(7)} load(s)  ${org.name}`,
    )
  }

  const orgId =
    arg('org') ??
    organizations.sort((a, b) => b._count.loads - a._count.loads)[0]?.id
  if (!orgId) throw new Error('No organisation on dev to inspect.')
  console.log(`\nInspecting organisation ${orgId}`)

  // ── DELIVERED IN THE WEEK, BY THE DELIVERY STOP ─────────────────────────
  //
  // THE STOP, NOT THE EVENT, because the event is exactly what the reclassify
  // is going to create. Asking the event would report zero and call it an
  // answer: the instrument would have inherited the state it is measuring.
  const delivered = await db.load.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      stops: {
        some: { type: 'DELIVERY', scheduledAt: { gte: start, lte: end } },
      },
    },
    select: {
      id: true,
      loadNumber: true,
      referenceNumber: true,
      externalId: true,
      operationalStatus: true,
      billingStatus: true,
      isCancelled: true,
      linehaulCents: true,
      totalRevenueCents: true,
      driverId: true,
      coDriverId: true,
      companyId: true,
      driver: { select: { firstName: true, lastName: true, kind: true } },
      company: { select: { name: true } },
      statusEvents: {
        where: {
          axis: 'OPERATIONAL',
          toStatus: 'POD_RECEIVED',
          outcome: 'APPLIED',
        },
        select: { occurredAt: true },
      },
    },
  })

  heading(`LOADS WITH A DELIVERY STOP IN THE WEEK — ${delivered.length}`)

  const byBilling = new Map<string, { n: number; cents: number }>()
  const byOperational = new Map<string, { n: number; cents: number }>()
  for (const load of delivered) {
    for (const [map, key] of [
      [byBilling, load.billingStatus] as const,
      [byOperational, load.operationalStatus] as const,
    ]) {
      const cell = map.get(key) ?? { n: 0, cents: 0 }
      cell.n += 1
      cell.cents += load.totalRevenueCents
      map.set(key, cell)
    }
  }
  console.log('  by billing status')
  for (const [key, cell] of [...byBilling].sort()) {
    console.log(
      `    ${key.padEnd(24)} ${String(cell.n).padStart(5)}  ${money(cell.cents).padStart(15)}`,
    )
  }
  console.log('  by operational status')
  for (const [key, cell] of [...byOperational].sort()) {
    console.log(
      `    ${key.padEnd(24)} ${String(cell.n).padStart(5)}  ${money(cell.cents).padStart(15)}`,
    )
  }

  const closed = delivered.filter(
    (l) => l.billingStatus === 'CLOSED_IN_DATATRUCK',
  )
  const cancelled = delivered.filter((l) => l.isCancelled)
  const withPodInWeek = delivered.filter((l) =>
    l.statusEvents.some((e) => e.occurredAt >= start && e.occurredAt <= end),
  )
  const noSeat = delivered.filter(
    (l) => l.driverId === null && l.coDriverId === null,
  )

  heading('THE FOUR NUMBERS')
  console.log(`  delivered in the week      ${delivered.length}`)
  console.log(
    `  closed history            ${closed.length}   ${money(closed.reduce((s, l) => s + l.totalRevenueCents, 0))}`,
  )
  console.log(`  cancelled                 ${cancelled.length}`)
  console.log(`  POD event dated in week   ${withPodInWeek.length}`)
  console.log(`  no driver in either seat  ${noSeat.length}`)

  // ── WHO WOULD BE PAID, AND FOR HOW MUCH ─────────────────────────────────
  const byDriver = new Map<
    string,
    { name: string; n: number; cents: number; kind: string }
  >()
  for (const load of delivered) {
    const key = load.driverId ?? '(no driver)'
    const name =
      load.driver === null
        ? '(no driver)'
        : `${load.driver.firstName} ${load.driver.lastName}`
    const cell = byDriver.get(key) ?? {
      name,
      n: 0,
      cents: 0,
      kind: load.driver?.kind ?? '-',
    }
    cell.n += 1
    cell.cents += load.totalRevenueCents
    byDriver.set(key, cell)
  }
  heading(`DRIVERS WITH FREIGHT IN THE WEEK — ${byDriver.size}`)
  for (const [, cell] of [...byDriver].sort(
    (a, b) => b[1].cents - a[1].cents,
  )) {
    console.log(
      `  ${cell.name.padEnd(34)} ${cell.kind.padEnd(7)} ${String(cell.n).padStart(4)} load(s)  ${money(cell.cents).padStart(14)}`,
    )
  }

  // ── PAY RULES IN FORCE FOR THOSE DRIVERS, at the week's end ─────────────
  const driverIds = [...byDriver.keys()].filter((id) => id !== '(no driver)')
  const rules = await db.driverPayRule.findMany({
    // NO `deletedAt` ON THIS MODEL, and no `kind`/`rateBps` either — the
    // columns are `type`, `percentBps`, `perMileCents`, `flatCents`. Guessing
    // the shape from the Driver model beside it is what this first read did.
    where: { driverId: { in: driverIds } },
    select: {
      driverId: true,
      type: true,
      percentBps: true,
      perMileCents: true,
      flatCents: true,
      effectiveFrom: true,
      effectiveTo: true,
      driver: { select: { firstName: true, lastName: true } },
    },
    orderBy: { effectiveFrom: 'asc' },
  })
  heading(`PAY RULES ON THOSE DRIVERS — ${rules.length}`)
  for (const rule of rules) {
    const covers =
      rule.effectiveFrom <= end &&
      (rule.effectiveTo === null || rule.effectiveTo >= start)
    const figure =
      rule.percentBps !== null
        ? `${(rule.percentBps / 100).toFixed(2)}%`
        : rule.perMileCents !== null
          ? `${money(rule.perMileCents)}/mi`
          : rule.flatCents !== null
            ? `${money(rule.flatCents)} flat`
            : '(none)'
    console.log(
      `  ${`${rule.driver.firstName} ${rule.driver.lastName}`.padEnd(34)} ` +
        `${rule.type.padEnd(18)} ${figure.padStart(12)}  ` +
        `${rule.effectiveFrom.toISOString().slice(0, 10)} .. ${rule.effectiveTo?.toISOString().slice(0, 10) ?? 'open'}` +
        `${covers ? '   ← covers this week' : ''}`,
    )
  }
  const ruled = new Set(
    rules
      .filter(
        (r) =>
          r.effectiveFrom <= end &&
          (r.effectiveTo === null || r.effectiveTo >= start),
      )
      .map((r) => r.driverId),
  )
  const unruled = [...byDriver].filter(
    ([id]) => id !== '(no driver)' && !ruled.has(id),
  )
  if (unruled.length > 0) {
    heading(`DRIVERS WITH FREIGHT AND NO RULE IN FORCE — ${unruled.length}`)
    for (const [, cell] of unruled) {
      console.log(
        `  ${cell.name.padEnd(34)} ${String(cell.n).padStart(4)} load(s)  ${money(cell.cents).padStart(14)}`,
      )
    }
  }

  // ── ONE DRIVER'S WEEK, LOAD BY LOAD, WITH ITS STATEMENT LINE ────────────
  //
  // WHY THIS EXISTS: the statement differ pairs a statement line to a Zebra load
  // and reports what it cannot pair. It CANNOT see a Zebra load that has no
  // settlement line at all — there is nothing in `loadLines` to notice is
  // missing — so a load in the week that was never priced is invisible to it in
  // both directions. On the 8/30 replay that was $886.49 of MCKANE's freight,
  // visible only as a gap between two totals.
  //
  // A GAP BETWEEN TOTALS IS NOT A FINDING, it is a prompt to go and look. This
  // is the looking.
  const driverName = arg('driver')
  if (driverName !== null) {
    const wanted = driverName.trim().toLowerCase()
    const match = [...byDriver].find(([, cell]) =>
      cell.name.toLowerCase().includes(wanted),
    )
    if (!match) {
      console.log(`
  No driver in the week matching "${driverName}".`)
    } else {
      const [driverId, cell] = match
      const rows = delivered.filter(
        (load) => load.driverId === driverId || load.coDriverId === driverId,
      )
      // ── SCOPED TO THIS PERIOD, WHICH THE FIRST VERSION WAS NOT ──────────
      //
      // Without `periodStart` this matched a line from ANY of the driver's
      // settlements, and it immediately lied: it showed DT-015841 — a DISPATCHED
      // load, which `settleableWhere` cannot select because it wants
      // POD_RECEIVED — as carrying a line in this week. A load settles once per
      // driver per period, so a line without its period named is a line about
      // some other week.
      //
      // The figure was even plausible: $265.95 is exactly 30% of $886.49, so the
      // wrong line looked like the right arithmetic.
      const lines = await db.settlementLoadLine.findMany({
        where: {
          loadId: { in: rows.map((r) => r.id) },
          settlement: {
            driverId,
            deletedAt: null,
            periodStart: start,
          },
        },
        select: { loadId: true, grossCents: true, amountCents: true },
      })
      const byLoad = new Map(lines.map((l) => [l.loadId, l]))

      heading(`${cell.name} — ${rows.length} LOAD(S) IN THE WEEK`)
      let priced = 0
      let unpriced = 0
      for (const load of rows) {
        const line = byLoad.get(load.id)
        if (line) priced += line.grossCents
        else unpriced += load.totalRevenueCents
        console.log(
          `  ${(load.referenceNumber ?? load.externalId ?? load.id).padEnd(16)} ` +
            `${load.loadNumber.padEnd(11)} ${money(load.totalRevenueCents).padStart(12)}  ` +
            `${load.operationalStatus.padEnd(13)} ${load.billingStatus.padEnd(18)} ` +
            `${line ? `line ${money(line.amountCents)}` : 'NO SETTLEMENT LINE'}`,
        )
      }
      console.log(`
  priced   ${money(priced)}`)
      console.log(`  unpriced ${money(unpriced)}`)
    }
  }

  // ── PAID WITHOUT A POD, COUNTED ACROSS THE WHOLE DRAFT ──────────────────
  //
  // TWO PREDICATES FOR ONE CONCEPT, AND THE LOOSER ONE WRITES THE CHEQUES.
  //
  // `settleableWhere` (src/lib/settlements.ts) answers "what has this driver got
  // coming" and demands THREE things: `operationalStatus: 'POD_RECEIVED'`, an
  // APPLIED POD_RECEIVED event, and that event dated inside the period. Its own
  // comment is explicit — "a driver is paid for freight that reached POD, in the
  // period the POD landed. No POD, no settlement line."
  //
  // `batchLoadWhere` (src/lib/settlement-batch.ts) is what a BATCH actually
  // selects on, and it asks for none of the three. A non-cancelled load that is
  // not closed history, has a driver, has a delivery stop dated in the week and
  // carries no line yet enters the batch — whatever its operational status.
  //
  // So a load still DISPATCHED, which by Zebra's own account has not arrived,
  // gets a line. Found on the 8/30 replay: MCKANE's T-114T6RF3H / DT-015841,
  // $886.49 gross, a $265.95 line at his 30%, operational status DISPATCHED and
  // no POD event of any kind.
  //
  // COUNTED RATHER THAN ASSERTED, because the claim is about how much money this
  // moves and one row is an anecdote. The rule is the same one the corpus count
  // got wrong: count the thing being claimed.
  const draft = await db.settlementBatch.findFirst({
    where: { organizationId: orgId, periodStart: start },
    select: { id: true, status: true },
    orderBy: { createdAt: 'desc' },
  })
  if (draft !== null) {
    const paid = await db.settlementLoadLine.findMany({
      where: {
        settlement: { batchId: draft.id, deletedAt: null },
        load: {
          statusEvents: {
            none: {
              axis: 'OPERATIONAL',
              toStatus: 'POD_RECEIVED',
              outcome: 'APPLIED',
              occurredAt: { gte: start, lte: end },
            },
          },
        },
      },
      select: {
        grossCents: true,
        amountCents: true,
        loadNumber: true,
        load: {
          select: {
            referenceNumber: true,
            operationalStatus: true,
            billingStatus: true,
          },
        },
        settlement: {
          select: { driver: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: { amountCents: 'desc' },
    })

    heading(
      `PAID WITH NO POD EVENT IN THE WEEK — ${paid.length} line(s) in batch ${draft.id}`,
    )
    const owed = paid.reduce((sum, line) => sum + line.amountCents, 0)
    const grossed = paid.reduce((sum, line) => sum + line.grossCents, 0)
    for (const line of paid.slice(0, 25)) {
      console.log(
        `  ${(line.load?.referenceNumber ?? '?').padEnd(16)} ${line.loadNumber.padEnd(11)} ` +
          `${money(line.grossCents).padStart(12)} -> ${money(line.amountCents).padStart(11)}  ` +
          `${(line.load?.operationalStatus ?? '?').padEnd(13)} ` +
          `${`${line.settlement.driver.firstName} ${line.settlement.driver.lastName}`}`,
      )
    }
    if (paid.length > 25) console.log(`  … and ${paid.length - 25} more`)
    console.log(`
  gross on those lines  ${money(grossed)}`)
    console.log(`  driver pay on them    ${money(owed)}`)
  }

  // ── BATCHES AND PAYMENTS ALREADY TOUCHING THE WEEK ───────────────────────
  const batches = await db.settlementBatch.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      _count: { select: { settlements: true } },
    },
    orderBy: { periodStart: 'asc' },
  })
  heading(`SETTLEMENT BATCHES ON DEV — ${batches.length}`)
  for (const batch of batches) {
    const mine =
      batch.periodStart.getTime() === start.getTime() ? '   ← this week' : ''
    console.log(
      `  ${batch.id}  ${batch.status.padEnd(9)} ${batch.periodStart.toISOString().slice(0, 10)}..${batch.periodEnd.toISOString().slice(0, 10)}  ${String(batch._count.settlements).padStart(3)} statement(s)${mine}`,
    )
  }

  const payments = await db.payment.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      remittanceKey: true,
      amountCents: true,
      periodStart: true,
      periodEnd: true,
      receivedAt: true,
      _count: { select: { loadApplications: true } },
    },
    orderBy: { receivedAt: 'asc' },
  })
  heading(`PAYMENTS ON DEV — ${payments.length}`)
  for (const payment of payments) {
    console.log(
      `  ${(payment.remittanceKey ?? '(none)').padEnd(38)} ${money(payment.amountCents).padStart(14)}  ` +
        `${payment.periodStart?.toISOString().slice(0, 10) ?? '?'}..${payment.periodEnd?.toISOString().slice(0, 10) ?? '?'}  ` +
        `${String(payment._count.loadApplications).padStart(4)} application(s)`,
    )
  }

  await db.$disconnect()
}

await main()

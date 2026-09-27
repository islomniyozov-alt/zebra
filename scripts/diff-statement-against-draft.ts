import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { payFor, ruleInForce } from '@/lib/driver-pay'
import { nameKey } from '@/lib/name-key'
import {
  DATATRUCK_STATEMENTS,
  DATATRUCK_STATEMENT_ST005377,
  DATATRUCK_STATEMENT_ST005395,
} from '../tests/fixtures/datatruck-statements'

// ---------------------------------------------------------------------------
// A DATATRUCK STATEMENT AGAINST ZEBRA'S DRAFT, LINE BY LINE, TO THE CENT.
//
//   npx tsx -r dotenv/config scripts/diff-statement-against-draft.ts \
//     --production --statement ST-005533
//
// SELECT ONLY.
//
// ── WHAT IT COMPARES, AND HOW IT PAIRS THE LINES ──────────────────────────
//
// A statement names its loads by AMAZON REFERENCE — `115JSD97Y`, `T-111NSXYB7`
// — and Zebra names them `DT-016xxx`. The pairing is `Load.referenceNumber`, the
// same handle the remittance matcher uses, so nothing here invents a mapping.
//
// Every figure the statement prints gets a counterpart or is reported as having
// none: per load line the gross, the miles and the driver's amount; then the
// deductions; then the earnings, deductions and net totals.
//
// ── THE ONE ADJUSTMENT, AND IT IS IN THE COMPARISON ONLY ──────────────────
//
// Owner's ruling, 2026-09-26: a line the engine held for `no_remittance` is
// priced on BOOKED GROSS for the purposes of this diff. Datatruck priced every
// line on booked gross because it never waited for Amazon; Zebra holds a line
// until the cash arrives. Comparing a held line against a paid one would report
// a difference that is a difference of POLICY, not of arithmetic, on every
// late-week load.
//
// THE ENGINE IS NOT CHANGED. The adjustment exists inside this script and
// nowhere else, and the report says which lines it applied to — otherwise the
// diff would quietly launder the very hold the week depends on.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const PRODUCTION = process.argv.includes('--production')
const WANTED = (() => {
  const at = process.argv.indexOf('--statement')
  return at === -1 ? null : (process.argv[at + 1] ?? null)
})()

function target() {
  const url = PRODUCTION
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('No database url for that target.')
  return { url, label: PRODUCTION ? 'PRODUCTION' : 'DEV' }
}

const heading = (text: string) => {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 74)))
}

const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const day = (at: Date | number) => new Date(at).toISOString().slice(0, 10)

let differences = 0
const cmp = (label: string, datatruck: number, zebra: number) => {
  if (datatruck === zebra) {
    console.log(`    agree   ${label.padEnd(30)} ${money(datatruck)}`)
    return
  }
  differences++
  const delta = zebra - datatruck
  console.log(
    `    DIFFER  ${label.padEnd(30)} datatruck ${money(datatruck)}  zebra ${money(zebra)}` +
      `  zebra is ${delta > 0 ? 'HIGHER' : 'LOWER'} by ${money(Math.abs(delta))}`,
  )
}

async function main(): Promise<void> {
  if (!WANTED) throw new Error('Name the statement with --statement ST-xxxxxx.')
  // ── THE TWO THAT LIVE OUTSIDE THE ARRAY ARE STILL DIFFABLE ─────────────
  //
  // `DATATRUCK_STATEMENTS` means "statements this engine reproduces to the
  // cent", and two transcribed ones do not: ST-005395 mixes 30% and 20% under a
  // 20% header, and ST-005377's insurance deduction is August's charge against a
  // pro-rated September one. Both are excluded from the array on purpose.
  //
  // EXCLUDED FROM THE ASSERTION IS NOT EXCLUDED FROM THE COMPARISON. This script
  // reports differences rather than asserting their absence, so the two the
  // engine cannot reproduce are exactly the ones worth running it against — and
  // leaving them unreachable here would mean the only statements anybody diffed
  // were the ones already known to agree.
  const OUT_OF_ARRAY = [
    DATATRUCK_STATEMENT_ST005377,
    DATATRUCK_STATEMENT_ST005395,
  ]
  const fixture =
    DATATRUCK_STATEMENTS.find((s) => s.number === WANTED) ??
    OUT_OF_ARRAY.find((s) => s.number === WANTED)
  if (!fixture) throw new Error(`No transcribed fixture for ${WANTED}.`)

  const where = target()
  const db = createPrismaClient(where.url)
  console.log(`Target: ${where.label}`)
  console.log(
    `Statement: ${fixture.number}  ${fixture.driver}  unit ${fixture.unitNumber}` +
      `  ${day(fixture.periodStart)} → ${day(fixture.periodEnd)}  ${fixture.tariff}`,
  )

  try {
    // ── THE DRIVER IS RESOLVED ON THE WHOLE NAME, NOT ON A GUESSED SPLIT ──
    //
    // This used to say `firstName: driver.split(' ')[0]` with the rest as the
    // surname, which is a guess about where a name divides — and it was wrong
    // the first time it met one: the statement prints
    // "HECTOR ANTONIO RODRIGUEZ SERRANO", the roster holds
    // firstName "HECTOR ANTONIO" / lastName "RODRIGUEZ SERRANO", and the diff
    // reported NO DRAFT SETTLEMENT for a driver who had one.
    //
    // THAT IS THE WORST SHAPE THIS SCRIPT CAN FAIL IN. "No settlement" reads as
    // a finding about the week — a driver Zebra failed to pay — when it was a
    // finding about a space. Silence that looks like an answer.
    //
    // SO THE ROSTER IS READ AND THE JOIN HAPPENS ON `nameKey`, the same shared
    // key the two importers use, for the same reason given there: the artefact
    // prints one string and the roster keeps two columns, and splitting the
    // string is guessing where a middle name goes.
    const roster = await db.driver.findMany({
      where: { deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    })
    const wantedKey = nameKey(fixture.driver)
    const named = roster.filter(
      (row) => nameKey(`${row.firstName} ${row.lastName}`) === wantedKey,
    )
    if (named.length !== 1) {
      throw new Error(
        `"${fixture.driver}" matches ${named.length} roster row(s) on ` +
          `${where.label}: refusing to guess which driver the statement is for.`,
      )
    }

    const settlement = await db.settlement.findFirst({
      where: {
        periodStart: new Date(fixture.periodStart),
        driverId: named[0]!.id,
        deletedAt: null,
      },
      select: {
        id: true,
        driverId: true,
        organizationId: true,
        settlementNumber: true,
        grossCents: true,
        deductionsCents: true,
        netCents: true,
        periodStart: true,
        periodEnd: true,
        batch: {
          select: { status: true, checkDate: true, statementDate: true },
        },
        // `loadLines` (SettlementLoadLine) and `deductionLines` are the
        // relation names. `charges` was a guess and Prisma refused it; `lines`
        // exists too but is SettlementLine, a different model with no
        // `loadNumber`, so reaching for it was a second wrong guess.
        earningsCents: true,
        milesHundredths: true,
        payTariffLabel: true,
        loadLines: {
          select: {
            loadNumber: true,
            grossCents: true,
            milesHundredths: true,
            amountCents: true,
            load: { select: { referenceNumber: true } },
          },
        },
        deductionLines: {
          select: {
            type: true,
            description: true,
            quantity: true,
            rateCents: true,
            totalCents: true,
          },
        },
      },
    })

    if (!settlement) {
      heading('NO DRAFT SETTLEMENT FOR THIS DRIVER AND PERIOD')
      console.log(
        `  ${fixture.driver} has no settlement with periodStart ${day(fixture.periodStart)}.`,
      )
      return
    }

    console.log(
      `Draft:     ${settlement.settlementNumber}  batch ${settlement.batch!.status}` +
        `  statement ${day(settlement.batch!.statementDate)}  check ${day(settlement.batch!.checkDate)}`,
    )

    // ── THE DATES THE TWO SYSTEMS PRINT ─────────────────────────────────
    heading('THE PERIOD AND THE DATES')
    cmp(
      'period start (epoch days)',
      Math.floor(fixture.periodStart / 86_400_000),
      Math.floor(settlement.periodStart.getTime() / 86_400_000),
    )
    cmp(
      'check date (epoch days)',
      Math.floor(fixture.checkDate / 86_400_000),
      Math.floor(settlement.batch!.checkDate.getTime() / 86_400_000),
    )

    // ── THE ZEBRA SIDE, WITH HELD LINES PRICED ON BOOKED GROSS ──────────
    //
    // A held line is NOT a row: `computeBatch` returns holds in memory and only
    // the paid lines are written. So the driver's whole week is read here and
    // priced with the engine's OWN functions — `ruleInForce` per load on its own
    // POD date, then `payFor`. That is the ruling's comparison-only adjustment,
    // and it is not a second copy of the arithmetic.
    //
    // For this driver every line is held for `no_remittance`, so the persisted
    // settlement is empty and a diff against it alone reports the whole
    // statement as missing — which is true and useless.
    const rules = await db.driverPayRule.findMany({
      where: { driverId: settlement.driverId },
      orderBy: { effectiveFrom: 'asc' },
      select: {
        id: true,
        type: true,
        percentBps: true,
        perMileCents: true,
        flatCents: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    })
    const weekLoads = await db.load.findMany({
      where: {
        organizationId: settlement.organizationId,
        deletedAt: null,
        isCancelled: false,
        OR: [
          { driverId: settlement.driverId },
          { coDriverId: settlement.driverId },
        ],
        statusEvents: {
          some: {
            axis: 'OPERATIONAL',
            toStatus: 'POD_RECEIVED',
            outcome: 'APPLIED',
            occurredAt: {
              gte: new Date(fixture.periodStart),
              lte: new Date(fixture.periodEnd + 86_399_999),
            },
          },
        },
      },
      select: {
        id: true,
        loadNumber: true,
        referenceNumber: true,
        linehaulCents: true,
        fuelSurchargeCents: true,
        accessorialsCents: true,
        totalRevenueCents: true,
        actualMiles: true,
        dispatchedMiles: true,
        // NO `podReceivedAt` COLUMN EXISTS. The POD date is the event's, which
        // is the same date `settleableWhere` selects the week on — so it is read
        // from the event rather than from a column that was assumed.
        statusEvents: {
          where: {
            axis: 'OPERATIONAL',
            toStatus: 'POD_RECEIVED',
            outcome: 'APPLIED',
          },
          select: { occurredAt: true },
          orderBy: { occurredAt: 'desc' },
          take: 1,
        },
        paymentApplications: { select: { amountCents: true } },
      },
    })

    interface Priced {
      loadNumber: string
      grossCents: number
      payCents: number | null
      note: string
    }
    const pricedByRef = new Map<string, Priced>()
    for (const load of weekLoads) {
      const rule = ruleInForce(
        rules,
        load.statusEvents[0]?.occurredAt ?? new Date(fixture.periodEnd),
      )
      const paid = payFor(load, rule)
      pricedByRef.set(load.referenceNumber ?? '', {
        loadNumber: load.loadNumber,
        grossCents: load.totalRevenueCents,
        payCents: paid.ok ? paid.amountCents : null,
        note:
          load.paymentApplications.length === 0
            ? 'held no_remittance - priced on booked gross for this diff only'
            : 'remitted',
      })
    }

    // ── LINE BY LINE, PAIRED ON THE AMAZON REFERENCE ────────────────────
    heading('LOAD LINES')
    const zebraByRef = new Map(
      settlement.loadLines.map((l) => [l.load.referenceNumber ?? '', l]),
    )
    const seen = new Set<string>()

    for (const row of fixture.loads) {
      const mine = zebraByRef.get(row.loadNumber)
      const priced = pricedByRef.get(row.loadNumber)
      const inPeriod =
        row.delDate >= fixture.periodStart && row.delDate <= fixture.periodEnd

      if (!mine && !priced) {
        differences++
        console.log(
          `  ${row.loadNumber.padEnd(14)} NOT IN ZEBRA AT ALL` +
            `  gross ${money(row.grossCents)}  pay ${money(row.amountCents)}` +
            `  DEL ${day(row.delDate)}${inPeriod ? '' : '  (delivered OUTSIDE the statement period)'}`,
        )
        continue
      }
      seen.add(row.loadNumber)

      if (!mine && priced) {
        console.log(
          `  ${row.loadNumber}  ->  ${priced.loadNumber}   [${priced.note}]`,
        )
        cmp('gross', row.grossCents, priced.grossCents)
        if (priced.payCents === null) {
          differences++
          console.log(
            `    DIFFER  ${'driver amount'.padEnd(30)} datatruck ${money(row.amountCents)}  zebra NO RULE COULD PRICE IT`,
          )
        } else {
          cmp('driver amount', row.amountCents, priced.payCents)
        }
        continue
      }

      console.log(`  ${row.loadNumber}  ->  ${mine!.loadNumber}`)
      cmp('gross', row.grossCents, mine!.grossCents)
      cmp('driver amount', row.amountCents, mine!.amountCents)
      if (row.milesHundredths !== mine!.milesHundredths) {
        differences++
        console.log(
          `    DIFFER  ${'miles (hundredths)'.padEnd(30)} datatruck ${row.milesHundredths}  zebra ${mine!.milesHundredths}`,
        )
      }
    }

    for (const [ref, priced] of pricedByRef) {
      if (seen.has(ref)) continue
      differences++
      console.log(
        `  ${(ref || '(no reference)').padEnd(14)} IN ZEBRA WEEK, NOT ON THE STATEMENT` +
          `  ${priced.loadNumber}  gross ${money(priced.grossCents)}` +
          `  pay ${priced.payCents === null ? '(no rule)' : money(priced.payCents)}`,
      )
    }

    // ── DEDUCTIONS ──────────────────────────────────────────────────────
    heading('DEDUCTIONS')
    const statementDeductions = fixture.deductions.reduce(
      (sum, d) => sum + d.totalCents,
      0,
    )
    for (const d of fixture.deductions) {
      console.log(
        `  statement: ${d.type} — ${d.description || '(no description)'}  ${money(d.totalCents)}`,
      )
    }
    for (const c of settlement.deductionLines) {
      console.log(
        `  draft:     ${c.type} — ${c.description || '(no description)'}` +
          `  qty ${c.quantity} x ${money(c.rateCents)} = ${money(c.totalCents)}`,
      )
    }
    // SIGNS: the statement prints a deduction negative, the settlement stores
    // it positive. Negating one side is the comparison, not a fudge.
    cmp('deductions total', statementDeductions, -settlement.deductionsCents)

    // ── TOTALS ──────────────────────────────────────────────────────────
    heading('TOTALS')
    // THE STATEMENT'S THREE COLUMNS, EACH AGAINST ITS OWN COUNTERPART. The
    // first draft of this compared the driver's earnings against `grossCents`,
    // which is the FREIGHT gross — two different numbers that would have
    // disagreed by the whole of the pay rate and looked like a finding.
    cmp('freight gross', fixture.totals.grossCents, settlement.grossCents)
    cmp('driver earnings', fixture.totals.amountCents, settlement.earningsCents)
    // AND AGAINST THE PRICED WEEK, which is the comparison the ruling asks for:
    // the engine's own arithmetic over every line, held ones included.
    const pricedTotal = [...pricedByRef.values()].reduce(
      (sum, p) => sum + (p.payCents ?? 0),
      0,
    )
    const pricedGross = [...pricedByRef.values()].reduce(
      (sum, p) => sum + p.grossCents,
      0,
    )
    cmp('freight gross (priced week)', fixture.totals.grossCents, pricedGross)
    cmp(
      'driver earnings (priced week)',
      fixture.totals.amountCents,
      pricedTotal,
    )
    cmp('net pay', fixture.summary.netCents, settlement.netCents)
    if (fixture.totals.milesHundredths !== settlement.milesHundredths) {
      differences++
      console.log(
        `    DIFFER  ${'miles (hundredths)'.padEnd(30)} datatruck ${fixture.totals.milesHundredths}` +
          `  zebra ${settlement.milesHundredths}`,
      )
    }
    console.log(
      `    tariff  statement ${JSON.stringify(fixture.tariff)}  draft ${JSON.stringify(settlement.payTariffLabel)}`,
    )

    heading(
      differences === 0
        ? 'IDENTICAL — every figure agrees'
        : `${differences} DIFFERENCE(S) ABOVE`,
    )
    console.log('\nEVERY STATEMENT ABOVE IS A READ. Nothing was changed.')
  } finally {
    await db.$disconnect()
  }
}

await main()

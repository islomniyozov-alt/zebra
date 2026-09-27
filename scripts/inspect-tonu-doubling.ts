import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'

// ---------------------------------------------------------------------------
// THE SAME CANCELLED LOAD, BOOKED BY TWO IMPORTERS, COUNTED ONCE TOO OFTEN.
//
//   npx tsx -r dotenv/config scripts/inspect-tonu-doubling.ts
//
// SELECT ONLY, AND DEV ONLY — it does not name the production connection
// variable, in the comments either.
//
// ── WHAT THIS MEASURES AND WHY ────────────────────────────────────────────
//
// Found on 2026-09-27 from ST-005317's one disagreeing line, `1138JCPWX`:
//
//   Datatruck export   Load pay 137.82   Total other pay 137   Total pay 274.82
//   Amazon workbook    LOAD - CANCELLED  $137.82
//   Datatruck statement paid the driver 30% of $137.00
//   Zebra              linehaul $137.82 + accessorial $137.00 = $274.82
//
// ONE TONU, THREE FIGURES, AND ZEBRA HOLDS THE SUM OF TWO OF THEM. The export
// records a truck-ordered-not-used payment in `Load pay` AND again in `Total
// other pay`, and its own `Total pay` column adds them — so Zebra reproducing
// `Total pay` reproduces the double.
//
// THE AMAZON IMPORTER WAS CAREFUL AND THE DATATRUCK ONE COULD NOT BE. The
// remittance writes a `TONU` accessorial with `isBillable = false` precisely so
// Amazon's figure is recorded without inflating revenue. The Datatruck importer
// writes `Total other pay` as a BILLABLE `OTHER` accessorial, because from the
// export alone there is nothing to say that money is the same money.
//
// SO THE PAIR IS THE SIGNAL: a load carrying both a billable Datatruck
// `Total other pay` and a non-billable Amazon `TONU` is a load whose revenue is
// almost certainly counted twice. This counts them and totals the exposure.
//
// IT DOES NOT FIX ANYTHING. Which figure is right is a money ruling — Amazon's
// remittance is the cash that arrived, but whether the driver is paid on it, on
// the export's `Driver gross`, or on the sum is not this script's call.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

/** The note the Datatruck importer puts on the accessorial it derives. */
const DATATRUCK_OTHER_NOTE = 'Datatruck "Total other pay".'

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const heading = (text: string) => {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 78)))
}

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.')
  const db = createPrismaClient(url)
  console.log('Target: DEV (this script cannot reach production)')

  // Every load that carries BOTH bookings of the same cancellation.
  const loads = await db.load.findMany({
    where: {
      deletedAt: null,
      accessorials: {
        some: { type: 'TONU' },
      },
      AND: [
        {
          accessorials: {
            some: {
              type: 'OTHER',
              isBillable: true,
              notes: DATATRUCK_OTHER_NOTE,
            },
          },
        },
      ],
    },
    select: {
      loadNumber: true,
      referenceNumber: true,
      linehaulCents: true,
      accessorialsCents: true,
      totalRevenueCents: true,
      driver: { select: { firstName: true, lastName: true } },
      accessorials: {
        select: {
          type: true,
          amountCents: true,
          isBillable: true,
          notes: true,
        },
      },
      settlementLoadLines: {
        select: {
          grossCents: true,
          amountCents: true,
          settlement: { select: { periodStart: true } },
        },
      },
    },
    orderBy: { loadNumber: 'asc' },
  })

  heading(
    `LOADS CARRYING BOTH A DATATRUCK "OTHER PAY" AND AN AMAZON TONU — ${loads.length}`,
  )

  let doubled = 0
  let affected = 0
  let paidOn = 0
  let settledLines = 0
  for (const load of loads) {
    const tonu = load.accessorials
      .filter((a) => a.type === 'TONU')
      .reduce((sum, a) => sum + a.amountCents, 0)
    const other = load.accessorials
      .filter((a) => a.notes === DATATRUCK_OTHER_NOTE)
      .reduce((sum, a) => sum + a.amountCents, 0)

    // ── THE DOUBLE NEEDS A NON-ZERO LINEHAUL, AND THAT IS THE WHOLE TEST ──
    //
    // THE FIRST VERSION OF THIS TOOK `Math.min(tonu, other)` AND WAS WRONG, on
    // the first run, in the direction of alarm: it reported $7,312.00 doubled
    // across 42 loads when 41 of them are correct.
    //
    // On a plain cancellation the export carries `Load pay 0` and `Total other
    // pay 175`. Zebra books linehaul $0 plus ONE billable $175 accessorial, and
    // the Amazon `TONU` row beside it is `isBillable = false` — so
    // `accessorialsCents` sums $175 once and revenue is $175. Nothing is doubled.
    // Calling that a double counted the deliberately non-billable row as if it
    // inflated revenue.
    //
    // THE DOUBLE IS THE CASE WHERE `Load pay` IS ALSO NON-ZERO: the same
    // cancellation fee written into the rate AND into other pay, which the
    // export's own `Total pay` then adds. That is `1138JCPWX`, and the overlap is
    // the other-pay figure because the linehaul is what Amazon actually remitted.
    //
    // An instrument built from my hypothesis rather than from the rows, which is
    // flag 88 exactly. The rows were one query away and they settled it.
    const isDoubled = load.linehaulCents > 0 && other > 0
    if (isDoubled) {
      doubled += other
      affected += 1
    }
    for (const line of load.settlementLoadLines) {
      if (!isDoubled) continue
      settledLines += 1
      paidOn += line.grossCents
    }

    // ONLY THE DOUBLED ONES ARE LISTED. Forty-one correct loads scrolling past
    // a report about one wrong one is how the one gets missed.
    if (!isDoubled) continue
    console.log(
      `  ${(load.referenceNumber ?? '?').padEnd(14)} ${load.loadNumber.padEnd(11)} ` +
        `linehaul ${money(load.linehaulCents).padStart(11)}  ` +
        `TONU ${money(tonu).padStart(10)}  otherPay ${money(other).padStart(10)}  ` +
        `revenue ${money(load.totalRevenueCents).padStart(11)}  ` +
        `${load.settlementLoadLines.length > 0 ? 'SETTLED' : '—'}  ` +
        `${load.driver ? `${load.driver.firstName} ${load.driver.lastName}` : '(no driver)'}`,
    )
  }

  heading('THE EXPOSURE')
  console.log(`  loads carrying both bookings         ${loads.length}`)
  console.log(`  …of which revenue IS doubled          ${affected}`)
  console.log(`  settlement lines on them             ${settledLines}`)
  console.log(`  revenue counted twice (the overlap)  ${money(doubled)}`)
  console.log(`  gross those lines were priced on     ${money(paidOn)}`)

  await db.$disconnect()
}

await main()

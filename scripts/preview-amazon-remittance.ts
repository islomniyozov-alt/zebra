import { neonConfig } from '@neondatabase/serverless'
import { readFileSync, readdirSync } from 'node:fs'
import { createPrismaClient } from '@/lib/db'
import { readRemittance, totalsAgree } from '@/lib/amazon/remittance'
import {
  keyFor,
  previewRemittance,
  type FreightRef,
  type MatchOutcome,
} from '@/lib/amazon/remittance-preview'

// ---------------------------------------------------------------------------
// WHAT EVERY AMAZON REMITTANCE WOULD DO, COUNTED AGAINST REAL FREIGHT.
//
//   npx tsx -r dotenv/config scripts/preview-amazon-remittance.ts --production
//   ZEBRA_TARGET=dev npx tsx -r dotenv/config scripts/preview-amazon-remittance.ts
//
// IT ONLY ASKS. Every statement is a SELECT and the fence in
// tests/prod-url-guard.test.ts holds it to that by name. Nothing here writes a
// Payment, an application, an accessorial or a status — none of that is built.
//
// It exists to answer one question before any of it is: when the importer
// runs, where do the rows land? The design predicted four outcomes. The
// database says a fifth dominates, and this counts it.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const PRODUCTION = process.argv.includes('--production')
const DIR = 'corpus/amazon'

function target() {
  const url = PRODUCTION
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL
  if (!url) {
    throw new Error(
      PRODUCTION
        ? 'PROD_DIRECT_DATABASE_URL is not set.'
        : 'DIRECT_DATABASE_URL is not set.',
    )
  }
  return { url, label: PRODUCTION ? 'PRODUCTION' : 'DEV' }
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const heading = (text: string) => {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 70)))
}

const ORDER: MatchOutcome[] = [
  'matched_exact',
  'short',
  'over',
  'matched_closed_history',
  'unmatched',
  'unkeyable',
]

async function main(): Promise<void> {
  const where = target()
  const db = createPrismaClient(where.url)
  console.log(`Target: ${where.label}`)

  try {
    const files = readdirSync(DIR)
      .filter((name) => name.endsWith('.xlsx'))
      .sort()
    console.log(`Workbooks: ${files.length}`)

    const totals = Object.fromEntries(
      ORDER.map((outcome) => [outcome, { n: 0, cents: 0 }]),
    ) as Record<MatchOutcome, { n: number; cents: number }>

    for (const name of files) {
      const outcome = await readRemittance(
        new Uint8Array(readFileSync(`${DIR}/${name}`)),
      )
      if (!outcome.ok) {
        heading(name)
        console.log(`  REFUSED: ${outcome.reason.kind}`)
        console.log(`  ${JSON.stringify(outcome.reason)}`)
        continue
      }
      const reading = outcome.reading

      // ── EVERY REFERENCE THE WEEK NAMES, LOOKED UP IN ONE QUERY ────────
      const references = [
        ...new Set(
          reading.rows
            .map((row) => {
              const key = keyFor(row)
              return key.branch === 'tour' || key.branch === 'load_under_trip'
                ? key.tripId
                : key.branch === 'single_load'
                  ? key.loadId
                  : null
            })
            .filter((value): value is string => value !== null),
        ),
      ]

      const loads = await db.load.findMany({
        where: { deletedAt: null, referenceNumber: { in: references } },
        select: {
          id: true,
          loadNumber: true,
          referenceNumber: true,
          totalRevenueCents: true,
          billingStatus: true,
        },
      })

      // EVERY LOAD PER REFERENCE, by the 2026-09-25 ruling: a trip's legs share
      // one reference, and a Map of one kept whichever was written last — so a
      // trip's total was compared against a single leg's rate.
      const freight = new Map<string, FreightRef[]>()
      for (const load of loads) {
        if (!load.referenceNumber) continue
        freight.set(load.referenceNumber, [
          ...(freight.get(load.referenceNumber) ?? []),
          {
            id: load.id,
            loadNumber: load.loadNumber,
            reference: load.referenceNumber,
            totalRevenueCents: load.totalRevenueCents,
            closedHistory: load.billingStatus === 'CLOSED_IN_DATATRUCK',
          },
        ])
      }

      const preview = previewRemittance(reading, freight)

      heading(`${name}  —  ${reading.summary.workPeriod ?? '(no period)'}`)
      console.log(
        `  invoice ${reading.summary.invoiceNumber ?? '—'}  ` +
          `paid ${reading.summary.paymentDate ?? '—'}  ` +
          `status ${reading.summary.paymentStatus ?? '—'}`,
      )
      console.log(
        `  rows ${reading.rows.length}  footer ${reading.footer.length}  ` +
          `references ${references.length}  loads touched ${preview.loadsTouched}`,
      )
      console.log(
        `  totals agree three ways: ${totalsAgree(reading) ? 'YES' : '*** NO ***'}  ` +
          `body ${money(reading.totals.bodyCents)}  ` +
          `header ${money(reading.totals.headerCents)}  ` +
          `footer ${reading.totals.footerCents === null ? '—' : money(reading.totals.footerCents)}`,
      )
      console.log(
        `  item types: ${reading.census.counts.map((row) => `${row.value}=${String(row.rows)}`).join('  ')}`,
      )

      if (reading.dormantColumnsSeen.length > 0) {
        console.log('')
        console.log('  *** A DORMANT COLUMN CARRIED A FIGURE ***')
        for (const seen of reading.dormantColumnsSeen) {
          console.log(
            `      ${seen.column}: ${money(seen.cents)} across ${String(seen.rows)} row(s)`,
          )
        }
      }
      if (reading.summary.adjustmentTotalCents !== 0) {
        console.log('')
        console.log('  *** AN ADJUSTMENT CARRIED A FIGURE ***')
        console.log(
          `      total ${money(reading.summary.adjustmentTotalCents)}`,
        )
        for (const line of reading.summary.adjustments) {
          console.log(
            `      ${line.type} / ${line.description}: ${money(line.cents)}`,
          )
        }
      }

      console.log('')
      for (const key of ORDER) {
        const n = preview.counts[key]
        if (n === 0) continue
        console.log(
          `    ${key.padEnd(24)} ${String(n).padStart(4)}  ${money(preview.cents[key]).padStart(14)}`,
        )
        totals[key].n += n
        totals[key].cents += preview.cents[key]
      }
    }

    heading(`ALL ${files.length} WEEKS`)
    let allUnits = 0
    let allCents = 0
    for (const key of ORDER) {
      const row = totals[key]
      if (row.n === 0) continue
      allUnits += row.n
      allCents += row.cents
      console.log(
        `  ${key.padEnd(24)} ${String(row.n).padStart(5)}  ${money(row.cents).padStart(15)}`,
      )
    }
    console.log(
      `  ${'TOTAL'.padEnd(24)} ${String(allUnits).padStart(5)}  ${money(allCents).padStart(15)}`,
    )
  } finally {
    await db.$disconnect()
  }
}

await main()

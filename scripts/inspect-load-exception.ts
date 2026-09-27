import { neonConfig } from '@neondatabase/serverless'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createPrismaClient } from '@/lib/db'
import { asRecords, readXlsx } from '@/lib/datatruck/xlsx'
import { readRemittance } from '@/lib/amazon/remittance'

// ---------------------------------------------------------------------------
// ONE LOAD, FROM ALL THREE SIDES AT ONCE.
//
//   npx tsx -r dotenv/config scripts/inspect-load-exception.ts \
//     --export corpus/datatruck/loads-and-trips_2026_09_08_20_05_05.xlsx \
//     111ZR9GMP 1138JCPWX
//
// SELECT ONLY, AND DEV ONLY — it does not name the production connection
// variable, so production is not reachable by forgetting a flag. Nor is it
// spelled out in this comment: `tests/prod-url-guard.test.ts` reads each file as
// text and a mention is indistinguishable from a read.
//
// ── WHY THREE SIDES ───────────────────────────────────────────────────────
//
// A statement diff can only say the two numbers differ. "Which side is right"
// needs the artefacts they were each built from, and there are three:
//
//   the Datatruck EXPORT   — what the old system recorded for the load
//   the Amazon WORKBOOK    — what the customer actually paid for it
//   Zebra's ROW            — what this system concluded, and from which of those
//
// The workbook is the tie-breaker whenever a gross is in question: Amazon's
// remittance is the money that arrived, and no amount of agreement between the
// other two outranks it. That is the same reasoning `grossFor` already encodes —
// a matched remittance settles on the REMITTED figure, not on the booked rate.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const AMAZON_DIR = 'corpus/amazon'

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

async function main(): Promise<void> {
  const exportPath = arg('export')
  const references = process.argv
    .slice(2)
    .filter((a) => !a.startsWith('--') && a !== exportPath)
  if (references.length === 0) {
    throw new Error('Name at least one load reference.')
  }

  const url = process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.')
  const db = createPrismaClient(url)
  console.log('Target: DEV (this script cannot reach production)')

  // ── THE DATATRUCK EXPORT ────────────────────────────────────────────────
  const exportRows = new Map<string, Record<string, unknown>>()
  if (exportPath !== null) {
    const sheet = await readXlsx(new Uint8Array(readFileSync(exportPath)))
    const records = asRecords(sheet)
    for (const record of records) {
      // THE REFERENCE COLUMN IS THE AMAZON ID, whatever Datatruck calls it in
      // this export. Every candidate name is tried and the first that matches a
      // wanted reference wins, rather than one column name being assumed.
      for (const key of Object.keys(record)) {
        const value = String(record[key] ?? '').trim()
        if (value !== '' && references.includes(value)) {
          exportRows.set(value, record)
        }
      }
    }
    console.log(
      `Export: ${exportPath} — ${records.length} row(s), ${exportRows.size} of ${references.length} reference(s) found`,
    )
  }

  // ── THE AMAZON WORKBOOKS ────────────────────────────────────────────────
  const paid = new Map<
    string,
    {
      invoice: string
      itemType: string
      cents: number
      start: string
      end: string
    }[]
  >()
  for (const name of readdirSync(AMAZON_DIR).filter((n) =>
    n.endsWith('.xlsx'),
  )) {
    const outcome = await readRemittance(
      new Uint8Array(readFileSync(join(AMAZON_DIR, name))),
    )
    if (!outcome.ok) continue
    for (const row of outcome.reading.rows) {
      for (const reference of [row.loadId, row.tripId]) {
        if (reference === null || !references.includes(reference)) continue
        const list = paid.get(reference) ?? []
        list.push({
          invoice: outcome.reading.summary.invoiceNumber ?? name,
          itemType: row.itemType,
          cents: row.grossCents,
          start: row.startDate,
          end: row.endDate,
        })
        paid.set(reference, list)
      }
    }
  }

  for (const reference of references) {
    heading(`${reference}`)

    // ── WHAT DATATRUCK RECORDED ───────────────────────────────────────────
    const row = exportRows.get(reference)
    if (row === undefined) {
      console.log('  EXPORT: no row carries this reference')
    } else {
      console.log('  EXPORT (only the columns that carry a figure or a date):')
      for (const [key, value] of Object.entries(row)) {
        const text = String(value ?? '').trim()
        if (text === '') continue
        console.log(`    ${key.padEnd(26)} ${text}`)
      }
    }

    // ── WHAT AMAZON PAID ──────────────────────────────────────────────────
    const rows = paid.get(reference) ?? []
    console.log(`\n  AMAZON: ${rows.length} row(s) across the workbooks`)
    let paidTotal = 0
    for (const line of rows) {
      paidTotal += line.cents
      console.log(
        `    ${line.invoice.slice(0, 14).padEnd(16)} ${line.itemType.padEnd(22)} ` +
          `${money(line.cents).padStart(12)}   ${line.start} .. ${line.end}`,
      )
    }
    if (rows.length > 0)
      console.log(`    ${''.padEnd(39)}${money(paidTotal).padStart(12)}  TOTAL`)

    // ── WHAT ZEBRA HOLDS ──────────────────────────────────────────────────
    const load = await db.load.findFirst({
      where: { referenceNumber: reference, deletedAt: null },
      select: {
        id: true,
        loadNumber: true,
        externalId: true,
        operationalStatus: true,
        billingStatus: true,
        isCancelled: true,
        linehaulCents: true,
        fuelSurchargeCents: true,
        accessorialsCents: true,
        totalRevenueCents: true,
        settledGrossCents: true,
        actualMiles: true,
        dispatchedMiles: true,
        directSettled: true,
        driver: { select: { firstName: true, lastName: true } },
        accessorials: {
          // `type` and `notes`, not `label` — the model has no such column, and
          // guessing it from the settlement line's vocabulary is what this first
          // read did. `AccessorialType` is the enum; the remittance importer puts
          // its own wording in `notes`.
          select: {
            type: true,
            notes: true,
            amountCents: true,
            isBillable: true,
            sourceKey: true,
          },
        },
        statusEvents: {
          where: { axis: 'OPERATIONAL', outcome: 'APPLIED' },
          select: { toStatus: true, occurredAt: true, note: true },
          orderBy: { occurredAt: 'asc' },
        },
        paymentApplications: {
          select: {
            amountCents: true,
            payment: { select: { remittanceKey: true } },
          },
        },
        settlementLoadLines: {
          select: {
            grossCents: true,
            amountCents: true,
            settlement: {
              select: { settlementNumber: true, periodStart: true },
            },
          },
        },
        stops: {
          select: { type: true, scheduledAt: true, arrivedAt: true },
          orderBy: { sequence: 'asc' },
        },
      },
    })

    if (load === null) {
      console.log('\n  ZEBRA: no load carries this reference')
      continue
    }
    console.log(
      `\n  ZEBRA: ${load.loadNumber}  (external ${load.externalId ?? '—'})`,
    )
    console.log(
      `    status        ${load.operationalStatus} / ${load.billingStatus}` +
        `${load.isCancelled ? ' / CANCELLED' : ''}  directSettled=${load.directSettled}`,
    )
    console.log(
      `    driver        ${load.driver ? `${load.driver.firstName} ${load.driver.lastName}` : '(none)'}`,
    )
    console.log(
      `    money         linehaul ${money(load.linehaulCents)}  fuel ${money(load.fuelSurchargeCents)}  ` +
        `accessorials ${money(load.accessorialsCents)}  TOTAL ${money(load.totalRevenueCents)}`,
    )
    console.log(
      `    settledGross  ${load.settledGrossCents === null ? '(none)' : money(load.settledGrossCents)}`,
    )
    console.log(
      `    miles         actual ${load.actualMiles ?? '—'}  dispatched ${load.dispatchedMiles ?? '—'}`,
    )
    for (const item of load.accessorials) {
      console.log(
        `    accessorial   ${item.type.padEnd(16)} ${money(item.amountCents).padStart(11)}  ` +
          `billable=${item.isBillable}  ${item.notes ?? ''}  ${item.sourceKey ?? ''}`,
      )
    }
    for (const event of load.statusEvents) {
      console.log(
        `    event         ${event.toStatus.padEnd(13)} ${event.occurredAt.toISOString()}  ${event.note ?? ''}`,
      )
    }
    for (const app of load.paymentApplications) {
      console.log(
        `    applied       ${money(app.amountCents).padStart(11)}  from ${app.payment.remittanceKey ?? '(retired)'}`,
      )
    }
    for (const line of load.settlementLoadLines) {
      console.log(
        `    settled       ${line.settlement.settlementNumber}  week ` +
          `${line.settlement.periodStart.toISOString().slice(0, 10)}  ` +
          `gross ${money(line.grossCents)} -> ${money(line.amountCents)}`,
      )
    }
    if (load.settlementLoadLines.length === 0) {
      console.log('    settled       NO SETTLEMENT LINE IN ANY WEEK')
    }
    for (const stop of load.stops) {
      console.log(
        `    stop          ${stop.type.padEnd(8)} scheduled ${stop.scheduledAt?.toISOString() ?? '—'}  ` +
          `arrived ${stop.arrivedAt?.toISOString() ?? '—'}`,
      )
    }
  }

  await db.$disconnect()
}

await main()

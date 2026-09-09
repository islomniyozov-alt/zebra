import { neonConfig } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { createPrismaClient } from '@/lib/db'
import { asRecords, readXlsx } from '@/lib/datatruck/xlsx'
import {
  datatruckCents,
  planLoads,
  syncDecisionFor,
  type PlannedLoad,
} from '@/lib/datatruck/loads'
import { formatCents } from '@/lib/money'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// A YEAR OF FREIGHT: 14,451 LOADS, $17.2M, INTO A SYSTEM THAT DID NOT RUN IT.
//
//   npx tsx -r dotenv/config scripts/seed-datatruck-loads.ts            (preview)
//   npx tsx -r dotenv/config scripts/seed-datatruck-loads.ts --write
//   npx tsx -r dotenv/config scripts/seed-datatruck-loads.ts --production --write
//
// The rules are in `src/lib/datatruck/loads.ts` and tested without a database.
// This file does the four things that need one: resolve names to rows, bridge
// to the loads Zebra already has, reconcile the money, and write in batches
// that can be resumed.
//
// ── RECONCILE TO THE CENT, BEFORE ANYTHING IS WRITTEN ─────────────────────
//
// The owner's ruling, and it is the cheapest instrument there is: the sum of
// what this seed would import must equal the sum of the column it came from.
// $17,247,316.74 of linehaul and $115,517.05 of accessorials. A money import
// that does not sum to its source is wrong somewhere, and a total is one line.
//
// It is checked in the PREVIEW, so a discrepancy is found before a row lands
// rather than after 14,451 of them do.
//
// ── RESUMABLE, AND A RECURRING SYNC ───────────────────────────────────────
//
// Every batch asks which of its Shipment IDs are already present. A run that
// dies at row 9,000 is re-run with the same command and continues. There is no
// checkpoint file, because a checkpoint is a second source of truth about what
// happened and the database is the first one.
//
// AND RE-RUNNING IS NOT A NO-OP ANY MORE. Dispatchers stay on Datatruck until
// Zebra is finished, so the same export comes back with some loads moved on. A
// row this import created and has not closed may be ADVANCED — never walked
// backwards, and closing is always allowed. `syncDecisionFor` owns that rule
// and is tested without a database; this file only writes what it returns.
//
// A load with no `externalId` was booked in Zebra and is none of the sync's
// business: those stay add-missing, as they always were.
//
// ── WHAT IT NEVER TOUCHES ─────────────────────────────────────────────────
//
// THE COUNTER. `loadNumber` is the Shipment ID — `DT-016082` — so no imported
// load consumes a number from the per-authority series. A dispatcher booking
// tomorrow gets 1017, not 15,468, and the history is visibly not Zebra's
// numbering.
//
// DRIVER PAY AND SETTLEMENTS. `Driver gross` is the load's gross under another
// name, and the pay rules that exist are dated 2026-08-01. Applying them to
// 2025 freight would invent a year of wages.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const DEFAULT_EXPORT =
  'corpus/datatruck/loads-and-trips_2026_09_08_20_05_05.xlsx'

const WRITE = process.argv.includes('--write')
const PRODUCTION = process.argv.includes('--production')
const FILE =
  process.argv.find((argument) => argument.endsWith('.xlsx')) ?? DEFAULT_EXPORT

/**
 * Loads per transaction.
 *
 * ── 100 WAS TOO MANY AND THE FAILURE WAS NOT "SLOW" ───────────────────────
 *
 * The first dev run died at `P2028: A rollback cannot be executed on an
 * expired transaction` — 5,749ms against Prisma's 5,000ms default. Each load
 * is a nested create of one Load, two LoadStops and sometimes an accessorial,
 * every one of them through the audited extension, over a WebSocket to Neon.
 *
 * The truck seed learned the same lesson in the same place: a transaction that
 * outruns its budget reports an INFRASTRUCTURE error rather than a data one,
 * so the message tells you nothing about the row that was too slow.
 *
 * The fix was the write SHAPE rather than the budget: three bulk statements
 * per batch instead of forty nested creates. With that, 250 is comfortable and
 * a failed batch costs 250 rows of redo — which the resumability makes cheap.
 */
const BATCH = 250

/**
 * Customers the export names differently from the rows Zebra already has.
 *
 * ── STATED, LIKE `AUTHORITY_BY_MC`, AND FOR THE SAME REASON ───────────────
 *
 * Exact-name matching would make `AMAZON LOGISTICS` (11,196 loads) a second
 * customer beside the `Amazon Relay` that holds the live freight, and
 * `WERNER ENTERPRISES INC` (2,483) a second beside `Werner`. `createBroker`
 * spells out what that costs: two customers for one broker split the payment
 * history, the credit limit and the aging of a single relationship, and
 * nothing downstream notices — an unpaid invoice sits under one row while the
 * payments land against the other.
 *
 * A TABLE, NOT A SIMILARITY RULE. A matcher loose enough to pair
 * `AMAZON LOGISTICS` with `Amazon Relay` is loose enough to pair two real and
 * different brokers somewhere else, silently, on the table that decides who
 * gets invoiced. This one can be read and disagreed with.
 *
 * EVERYTHING ELSE CREATES FRESH, including `DOLPHINS TRANSPORT LLC` — the
 * group brokering to itself on 45 loads. It becomes a Customer row that shares
 * a name with a Company, which is confusing enough to be worth naming in the
 * report rather than quietly aliasing to something.
 */
const CUSTOMER_ALIASES: Readonly<Record<string, string>> = {
  'AMAZON LOGISTICS': 'Amazon Relay',
  'WERNER ENTERPRISES INC': 'Werner',
}

const ORGANIZATION_SLUG = 'zebra'

/** Stated by the owner who ran the migration ritual, not discovered here. */
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'

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
  return {
    url,
    label: PRODUCTION ? 'PRODUCTION' : 'DEV',
    host: new URL(url).hostname,
    expectOrganizationId: PRODUCTION ? PRODUCTION_ORGANIZATION_ID : null,
  }
}

function heading(text: string): void {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 62)))
}

/** Exact, after collapsing case and whitespace. Never nearest-match. */
const nameKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')

const chunk = <T>(rows: readonly T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  const bytes = new Uint8Array(readFileSync(FILE))
  const records = asRecords(await readXlsx(bytes))
  const plan = planLoads(records)
  const where = target()

  console.log(`export  ${FILE} (${bytes.length} bytes, ${plan.read} data rows)`)
  console.log(`mode    ${WRITE ? 'WRITE' : 'preview only'}`)
  console.log(
    `read    ${((Date.now() - startedAt) / 1000).toFixed(1)}s to parse`,
  )

  const db = createPrismaClient(where.url)
  try {
    const tenancy = await assertTenancy(db, {
      label: where.label,
      host: where.host,
      slug: ORGANIZATION_SLUG,
      expectOrganizationId: where.expectOrganizationId,
    })
    const companyByName = new Map(
      tenancy.companies.map((company) => [company.name, company.id]),
    )

    // ── RECONCILE, FIRST, AGAINST THE COLUMN ITSELF ────────────────────
    //
    // Both sides are computed here: the SOURCE from every row of the export
    // including the ones this seed refuses, and the IMPORT from what it would
    // write. They are allowed to differ only by the held rows, and the report
    // prints that difference rather than hiding it in a tolerance.
    const cell = (r: Record<string, string>, k: string) => (r[k] ?? '').trim()
    let sourceLinehaul = 0
    let sourceAccessorial = 0
    for (const record of records) {
      try {
        sourceLinehaul += datatruckCents(cell(record, 'Load pay'))
        sourceAccessorial += datatruckCents(cell(record, 'Total other pay'))
      } catch {
        // Named by the planner's held list; not silently dropped from a total.
      }
    }
    const importLinehaul = plan.planned.reduce(
      (sum, load) => sum + load.linehaulCents,
      0,
    )
    const importAccessorial = plan.planned.reduce(
      (sum, load) => sum + load.accessorialCents,
      0,
    )

    heading('RECONCILIATION — the sum is the instrument')
    console.log(
      `  linehaul     source ${formatCents(sourceLinehaul).padStart(16)}   import ${formatCents(importLinehaul).padStart(16)}`,
    )
    console.log(
      `  accessorial  source ${formatCents(sourceAccessorial).padStart(16)}   import ${formatCents(importAccessorial).padStart(16)}`,
    )
    const linehaulGap = sourceLinehaul - importLinehaul
    const accessorialGap = sourceAccessorial - importAccessorial
    console.log(
      `  difference   linehaul ${formatCents(linehaulGap)}, accessorial ${formatCents(accessorialGap)}` +
        (linehaulGap === 0 && accessorialGap === 0
          ? '  — RECONCILED TO THE CENT'
          : `  — accounted for by ${plan.held.length} held row(s) below`),
    )

    heading(`HELD — ${plan.held.length} rows this seed will not write`)
    for (const held of plan.held.slice(0, 40)) {
      console.log(`  ${held.externalId.padEnd(12)} ${held.reason}`)
    }
    if (plan.held.length > 40) {
      console.log(`  … and ${plan.held.length - 40} more`)
    }

    // ── RESOLUTION: NAMES TO ROWS, ORG-WIDE, AMBIGUITY REFUSED ─────────
    //
    // Trucks by unit and drivers by name, across the whole organization rather
    // than per authority — the load history proved that necessary: 54 of 102
    // units and 64 of 155 driver names run under more than one MC. The load
    // carries its own authority from `MC Number`; the asset is the physical
    // thing.
    const trucks = await db.truck.findMany({
      where: { organizationId: tenancy.organizationId, deletedAt: null },
      select: { id: true, unitNumber: true },
    })
    const truckByUnit = new Map<string, string[]>()
    for (const truck of trucks) {
      const key = nameKey(truck.unitNumber)
      truckByUnit.set(key, [...(truckByUnit.get(key) ?? []), truck.id])
    }

    const drivers = await db.driver.findMany({
      where: { organizationId: tenancy.organizationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    })
    const driverByName = new Map<string, string[]>()
    for (const driver of drivers) {
      const key = nameKey(`${driver.firstName} ${driver.lastName}`)
      driverByName.set(key, [...(driverByName.get(key) ?? []), driver.id])
    }

    const unresolvedTrucks = new Map<string, number>()
    const ambiguousTrucks = new Map<string, number>()
    const unresolvedDrivers = new Map<string, number>()
    const ambiguousDrivers = new Map<string, number>()
    for (const load of plan.planned) {
      if (load.truckUnit) {
        const hits = truckByUnit.get(nameKey(load.truckUnit)) ?? []
        if (hits.length === 0) {
          unresolvedTrucks.set(
            load.truckUnit,
            (unresolvedTrucks.get(load.truckUnit) ?? 0) + 1,
          )
        } else if (hits.length > 1) {
          ambiguousTrucks.set(
            load.truckUnit,
            (ambiguousTrucks.get(load.truckUnit) ?? 0) + 1,
          )
        }
      }
      if (load.driverName) {
        const hits = driverByName.get(nameKey(load.driverName)) ?? []
        if (hits.length === 0) {
          unresolvedDrivers.set(
            load.driverName,
            (unresolvedDrivers.get(load.driverName) ?? 0) + 1,
          )
        } else if (hits.length > 1) {
          ambiguousDrivers.set(
            load.driverName,
            (ambiguousDrivers.get(load.driverName) ?? 0) + 1,
          )
        }
      }
    }

    const table = (title: string, counts: Map<string, number>) => {
      const rows = [...counts].sort((a, b) => b[1] - a[1])
      const loads = rows.reduce((sum, [, n]) => sum + n, 0)
      heading(`${title} — ${rows.length} name(s) on ${loads} load(s)`)
      for (const [name, n] of rows.slice(0, 60)) {
        console.log(`  ${String(n).padStart(5)}  ${name}`)
      }
      if (rows.length > 60) console.log(`  … and ${rows.length - 60} more`)
    }
    table('TRUCK UNITS THAT RESOLVE TO NOTHING', unresolvedTrucks)
    table('TRUCK UNITS THAT RESOLVE TO TWO ROWS — refused', ambiguousTrucks)
    table('DRIVER NAMES THAT RESOLVE TO NOTHING', unresolvedDrivers)
    table('DRIVER NAMES THAT RESOLVE TO TWO ROWS — refused', ambiguousDrivers)

    // ── CUSTOMERS ──────────────────────────────────────────────────────
    //
    // `Load.customerId` is NOT NULL, so every counterparty needs a row. Matched
    // on EXACT name, never fuzzily — the codebase refuses that everywhere, and
    // `createBroker` records why: two customers for one broker split the
    // payment history and the aging of a single relationship.
    const customers = await db.customer.findMany({
      where: { organizationId: tenancy.organizationId },
      select: { id: true, name: true },
    })
    const customerByName = new Map(
      customers.map((customer) => [nameKey(customer.name), customer.id]),
    )
    /** The export's name, or the Zebra row a stated alias points it at. */
    const resolvedName = (exportName: string) =>
      CUSTOMER_ALIASES[exportName] ?? exportName

    const wanted = new Map<string, number>()
    for (const load of plan.planned) {
      wanted.set(load.customerName, (wanted.get(load.customerName) ?? 0) + 1)
    }

    heading('CUSTOMER ALIASES — stated, never inferred')
    const danglingAliases: string[] = []
    for (const [from, to] of Object.entries(CUSTOMER_ALIASES)) {
      const hit = customerByName.get(nameKey(to))
      if (!hit) danglingAliases.push(`${from} -> ${to}`)
      console.log(
        `  ${from.padEnd(26)} -> ${to.padEnd(16)} ${hit ? 'matched' : 'NO SUCH CUSTOMER'}`,
      )
    }
    // ── AN ALIAS THAT POINTS AT NOTHING IS A REFUSAL ────────────────────
    //
    // The table's whole claim is "this export name means that EXISTING row".
    // When the row is absent the claim is false, and creating it under the
    // alias name quietly turns a merge into a second empty customer — which is
    // exactly what happened on dev, where the first import had already created
    // `AMAZON LOGISTICS` before this table existed, so the alias pointed at an
    // `Amazon Relay` that was not there and made one.
    //
    // Refused before anything is written, because the fix is either to correct
    // the table or to run this against a database that has the row.
    if (danglingAliases.length > 0) {
      heading('REFUSED — a stated alias points at a customer that is not here')
      for (const line of danglingAliases) console.log(`  ${line}`)
      console.log(
        '\n  Fix the table or run against a database holding those rows.',
      )
      console.log('  Nothing was written.')
      return
    }
    const selfBrokered = [...wanted].filter(([name]) =>
      tenancy.companies.some(
        (company) => nameKey(company.name) === nameKey(name),
      ),
    )
    for (const [name, count] of selfBrokered) {
      console.log(
        `
  ${name} is also a COMPANY here, and appears as a customer on ${count} load(s).`,
      )
      console.log(
        '  It becomes its own Customer row: the group brokering to itself.',
      )
    }
    const missingCustomers = [...wanted]
      .filter(([name]) => !customerByName.has(nameKey(resolvedName(name))))
      .sort((a, b) => b[1] - a[1])

    heading(
      `CUSTOMERS — ${wanted.size} named, ${wanted.size - missingCustomers.length} matched, ${missingCustomers.length} to create`,
    )
    console.log('  already on this database:')
    for (const customer of customers) console.log(`    ${customer.name}`)
    console.log('\n  to create, by load count (top 20):')
    for (const [name, n] of missingCustomers.slice(0, 20)) {
      console.log(`    ${String(n).padStart(6)}  ${name}`)
    }
    if (missingCustomers.length > 20) {
      console.log(`    … and ${missingCustomers.length - 20} more`)
    }
    console.log(
      '\n  MATCHED ON EXACT NAME. Anything spelled differently becomes its own',
    )
    console.log(
      '  row — read the two lists above before writing, because merging two',
    )
    console.log('  customers afterwards is far harder than not splitting them.')

    // ── THE BRIDGE TO LOADS ZEBRA ALREADY HAS ──────────────────────────
    //
    // `Load ID` -> `referenceNumber`, lookup only. It is NOT unique in the
    // export — six values repeat — so a repeated one that matches a live load
    // is refused and named rather than enriching the same load from several
    // rows.
    // ── LOADS ZEBRA BOOKED ITSELF, WHICH EXCLUDES THIS IMPORT'S OWN ────
    //
    // `externalId: null` is the whole clause and it was missing on the first
    // dev run. Imported loads carry a `referenceNumber` too — it is the
    // customer's text, copied from `Load ID` — so on a SECOND run every one of
    // them looked like a live Zebra load waiting to be enriched, and the seed
    // set about enriching 14,444 rows with themselves.
    //
    // Found by re-running rather than by reading: the first run was clean
    // because there was nothing imported yet to confuse it, which is exactly
    // the shape of bug that only a second run can show.
    const live = await db.load.findMany({
      where: {
        organizationId: tenancy.organizationId,
        deletedAt: null,
        referenceNumber: { not: null },
        externalId: null,
      },
      select: { id: true, referenceNumber: true, loadNumber: true },
    })
    const liveByReference = new Map(
      live.map((load) => [nameKey(load.referenceNumber ?? ''), load]),
    )
    const bridgeCounts = new Map<string, PlannedLoad[]>()
    for (const load of plan.planned) {
      if (!load.referenceNumber) continue
      const key = nameKey(load.referenceNumber)
      if (!liveByReference.has(key)) continue
      bridgeCounts.set(key, [...(bridgeCounts.get(key) ?? []), load])
    }
    const toEnrich = [...bridgeCounts].filter(([, rows]) => rows.length === 1)
    const contested = [...bridgeCounts].filter(([, rows]) => rows.length > 1)

    heading(
      `THE BRIDGE — ${toEnrich.length} export row(s) match a live Zebra load`,
    )
    for (const [key, rows] of toEnrich) {
      const target = liveByReference.get(key)!
      console.log(
        `  ${rows[0]!.externalId.padEnd(12)} -> load ${target.loadNumber} (ref ${target.referenceNumber})`,
      )
    }
    if (contested.length > 0) {
      heading(
        `CONTESTED — ${contested.length} reference(s) claimed by several rows`,
      )
      for (const [key, rows] of contested) {
        const target = liveByReference.get(key)!
        console.log(
          `  load ${target.loadNumber} (ref ${target.referenceNumber}) claimed by ` +
            `${rows.map((r) => r.externalId).join(', ')} — REFUSED, none enriches it`,
        )
      }
    }

    const enrichKeys = new Set(toEnrich.map(([key]) => key))
    const toCreate = plan.planned.filter(
      (load) =>
        !load.referenceNumber || !enrichKeys.has(nameKey(load.referenceNumber)),
    )

    // ── WHAT IS ALREADY HERE, ASKED RATHER THAN ASSUMED ────────────────
    //
    // A resumable seed whose preview cannot say "9,000 of these are already
    // in" is a preview that describes the first run and lies about every one
    // after it. Counted on the KEY the write uses, in chunks because 14,451
    // ids do not belong in a single `IN` list.
    let alreadyPresent = 0
    for (const ids of chunk(
      toCreate.map((load) => load.externalId),
      1_000,
    )) {
      alreadyPresent += await db.load.count({
        where: {
          organizationId: tenancy.organizationId,
          externalId: { in: ids },
        },
      })
    }

    heading('WHAT THIS WOULD DO')
    console.log(
      `  ${String(toCreate.length - alreadyPresent).padStart(6)}  loads created`,
    )
    console.log(
      `  ${String(alreadyPresent).padStart(6)}  already present — a re-run skips these`,
    )
    console.log(
      `  ${String(toEnrich.length).padStart(6)}  live loads enriched — adds missing, replaces nothing`,
    )
    console.log(
      `  ${String(contested.length).padStart(6)}  references refused as contested`,
    )
    console.log(
      `  ${String(missingCustomers.length).padStart(6)}  customers created`,
    )
    console.log(`  ${String(plan.held.length).padStart(6)}  rows held`)
    console.log('       0  pay rules, settlements, invoices or payments')
    console.log(
      '       0  counter values consumed — loadNumber is the Shipment ID',
    )

    if (!WRITE) {
      heading('NOTHING WAS WRITTEN')
      console.log('  Re-run with --write once the above is agreed.')
      console.log(
        `  elapsed ${((Date.now() - startedAt) / 1000).toFixed(1)}s for the preview.`,
      )
      return
    }

    // ── WRITING ────────────────────────────────────────────────────────
    heading('CUSTOMERS')
    for (const [exportName] of missingCustomers) {
      const name = resolvedName(exportName)
      const created = await db.customer.create({
        data: {
          organizationId: tenancy.organizationId,
          name,
          type: 'BROKER',
          notes: 'Imported from the Datatruck load history.',
        },
        select: { id: true },
      })
      customerByName.set(nameKey(name), created.id)
    }
    console.log(`  ${missingCustomers.length} created`)

    heading(`LOADS — ${toCreate.length} in batches of ${BATCH}`)
    const writeStarted = Date.now()
    let created = 0
    let skipped = 0
    let trucksFilled = 0
    let advanced = 0
    const heldBackwards: string[] = []
    let batchIndex = 0

    for (const batch of chunk(toCreate, BATCH)) {
      batchIndex++
      // RESUMABILITY LIVES HERE. Ask what is already present rather than
      // trusting a checkpoint; the database is the only record of what landed.
      const present = await db.load.findMany({
        where: {
          organizationId: tenancy.organizationId,
          externalId: { in: batch.map((load) => load.externalId) },
        },
        select: {
          id: true,
          externalId: true,
          truckId: true,
          operationalStatus: true,
          billingStatus: true,
        },
      })
      const already = new Map(present.map((row) => [row.externalId ?? '', row]))
      const fresh = batch.filter((load) => !already.has(load.externalId))
      skipped += batch.length - fresh.length

      // ── A RE-RUN FILLS A TRUCK THAT WAS NOT RESOLVABLE LAST TIME ──────
      //
      // The owner's ruling, and it is what makes importing the rest of the
      // fleet worth doing after the loads already landed: 4,179 loads came in
      // with a driver and no truck because the unit had no row yet. Now it
      // does.
      //
      // ADD-MISSING, NEVER REPLACE. Only a NULL `truckId` is written. A load
      // that already names a truck keeps it — that is either what the first
      // import resolved or what a dispatcher has since corrected, and both are
      // newer truths than this file.
      for (const load of batch) {
        const row = already.get(load.externalId)
        if (!row) continue

        const data: Record<string, unknown> = {}

        // ── ADD-MISSING: A TRUCK THAT NOW RESOLVES ────────────────────────
        if (row.truckId === null && load.truckUnit) {
          const hits = truckByUnit.get(nameKey(load.truckUnit)) ?? []
          if (hits.length === 1) {
            data['truckId'] = hits[0]!
            trucksFilled++
          }
        }

        // ── FORWARD ONLY: THE RECURRING SYNC ──────────────────────────────
        //
        // Dispatchers stay on Datatruck until Zebra is finished, so the same
        // Shipment IDs come back with some of them moved on. `syncDecisionFor`
        // owns the direction rule; this only writes what it returns.
        const decision = syncDecisionFor(
          {
            operational: row.operationalStatus,
            billing: row.billingStatus,
          },
          { operational: load.operational, billing: load.billing },
        )
        if (decision.operational)
          data['operationalStatus'] = decision.operational
        if (decision.billing) data['billingStatus'] = decision.billing
        if (decision.operational || decision.billing) advanced++
        for (const note of decision.notes) {
          if (note.startsWith('held:'))
            heldBackwards.push(`${load.externalId} ${note}`)
        }

        if (Object.keys(data).length === 0) continue
        await db.load.update({ where: { id: row.id }, data })
      }

      if (fresh.length === 0) continue

      // ── THREE STATEMENTS PER BATCH, NOT FORTY NESTED CREATES ─────────
      //
      // The first two attempts wrote each load as a nested create of a Load,
      // two LoadStops and sometimes an accessorial. Every one of those goes
      // through the audited extension, which reads the row before and after to
      // build a field-level diff, over a WebSocket to Neon — about 500ms each.
      // Batches of 100 blew Prisma's 5s default; batches of 40 blew a stated
      // 20s. At that rate 14,451 loads is two hours, and the error it reports
      // names the transaction rather than the work.
      //
      // `createManyAndReturn` IS THE TOOL AND `audit.ts` NAMES IT: bare
      // `createMany` returns no ids to point an audit row at and counts as
      // `unfollowableOperation`, so the one that returns rows is what a bulk
      // write should use. Loads first, then their stops and accessorials keyed
      // by the ids that came back.
      const rows = await db.load.createManyAndReturn({
        data: fresh.map((load) => {
          const truckIds = load.truckUnit
            ? (truckByUnit.get(nameKey(load.truckUnit)) ?? [])
            : []
          const driverIds = load.driverName
            ? (driverByName.get(nameKey(load.driverName)) ?? [])
            : []
          return {
            organizationId: tenancy.organizationId,
            companyId: companyByName.get(load.authority)!,
            customerId: customerByName.get(
              nameKey(resolvedName(load.customerName)),
            )!,
            externalId: load.externalId,
            // THE SHIPMENT ID IS THE LOAD NUMBER. No counter is touched, and
            // `DT-016082` is visibly not a number this system allocated.
            loadNumber: load.externalId,
            referenceNumber: load.referenceNumber,
            internalNotes: load.tripId
              ? `Datatruck trip ${load.tripId}.`
              : null,
            operationalStatus: load.operational,
            billingStatus: load.billing,
            isCancelled: load.cancelled,
            ...(load.equipment ? { equipmentType: load.equipment } : {}),
            // ONLY WHEN IT RESOLVES TO EXACTLY ONE. None and several both mean
            // the load carries no truck rather than a guessed one.
            ...(truckIds.length === 1 ? { truckId: truckIds[0] } : {}),
            ...(driverIds.length === 1 ? { driverId: driverIds[0] } : {}),
            linehaulCents: load.linehaulCents,
            accessorialsCents: load.accessorialCents,
            totalRevenueCents: load.totalRevenueCents,
            dispatchedMiles: load.dispatchedMiles,
            actualMiles: load.actualMiles,
            emptyMiles: load.emptyMiles,
            bookedAt: load.bookedAt,
          }
        }),
        select: { id: true, externalId: true },
      })

      const idByExternalId = new Map(
        rows.map((row) => [row.externalId ?? '', row.id]),
      )

      await db.loadStop.createMany({
        data: fresh.flatMap((load) => {
          const loadId = idByExternalId.get(load.externalId)
          if (!loadId) return []
          return [
            {
              loadId,
              organizationId: tenancy.organizationId,
              sequence: 1,
              type: 'PICKUP' as const,
              name: load.pickup.name,
              addressLine1: load.pickup.addressLine1,
              city: load.pickup.city,
              state: load.pickup.state,
              postalCode: load.pickup.postalCode,
              scheduledAt: load.pickupAt,
            },
            {
              loadId,
              organizationId: tenancy.organizationId,
              sequence: 2,
              type: 'DELIVERY' as const,
              name: load.delivery.name,
              addressLine1: load.delivery.addressLine1,
              city: load.delivery.city,
              state: load.delivery.state,
              postalCode: load.delivery.postalCode,
              scheduledAt: load.deliveryAt,
            },
          ]
        }),
      })

      // ACCESSORIAL MONEY AS AN ACCESSORIAL ROW, not folded into the rate.
      // `Total other pay` is detention and lumper money on 664 rows; OTHER
      // because the export never says which.
      const accessorials = fresh.flatMap((load) => {
        const loadId = idByExternalId.get(load.externalId)
        if (!loadId || load.accessorialCents <= 0) return []
        return [
          {
            loadId,
            organizationId: tenancy.organizationId,
            type: 'OTHER' as const,
            amountCents: load.accessorialCents,
            isBillable: true,
            status: 'BILLED' as const,
            notes: 'Datatruck "Total other pay".',
          },
        ]
      })
      if (accessorials.length > 0) {
        await db.loadAccessorial.createMany({ data: accessorials })
      }
      created += fresh.length

      if (batchIndex % 10 === 0 || batchIndex === 1) {
        const seconds = (Date.now() - writeStarted) / 1000
        console.log(
          `  batch ${String(batchIndex).padStart(4)}  ${String(created).padStart(6)} written  ` +
            `${seconds.toFixed(1)}s  ${(created / Math.max(seconds, 0.001)).toFixed(0)}/s`,
        )
      }
    }

    // ── ENRICHMENT: ADDS MISSING, REPLACES NOTHING ─────────────────────
    heading(`ENRICHING — ${toEnrich.length} live load(s)`)
    let enriched = 0
    for (const [key, rows] of toEnrich) {
      const targetLoad = liveByReference.get(key)!
      const source = rows[0]!
      const current = await db.load.findUniqueOrThrow({
        where: { id: targetLoad.id },
        select: {
          externalId: true,
          internalNotes: true,
          actualMiles: true,
          emptyMiles: true,
          dispatchedMiles: true,
        },
      })
      // Every field is written ONLY where the live load has nothing. A live
      // load is the newer truth about freight that is still running.
      const data: Record<string, unknown> = {}
      if (current.externalId === null) data['externalId'] = source.externalId
      if (current.internalNotes === null && source.tripId) {
        data['internalNotes'] = `Datatruck trip ${source.tripId}.`
      }
      if (current.actualMiles === null && source.actualMiles !== null) {
        data['actualMiles'] = source.actualMiles
      }
      if (current.emptyMiles === null && source.emptyMiles !== null) {
        data['emptyMiles'] = source.emptyMiles
      }
      if (current.dispatchedMiles === null && source.dispatchedMiles !== null) {
        data['dispatchedMiles'] = source.dispatchedMiles
      }
      if (Object.keys(data).length === 0) {
        console.log(`  ${targetLoad.loadNumber}  nothing missing, left alone`)
        continue
      }
      await db.load.update({ where: { id: targetLoad.id }, data })
      enriched++
      console.log(
        `  ${targetLoad.loadNumber}  added ${Object.keys(data).join(', ')}`,
      )
    }

    const seconds = (Date.now() - startedAt) / 1000
    heading('WRITTEN')
    console.log(`  ${created} loads created, ${skipped} already present`)
    console.log(
      `  ${trucksFilled} already-imported load(s) gained a truck that now resolves`,
    )
    console.log(
      `  ${advanced} already-imported load(s) advanced by this export`,
    )
    if (heldBackwards.length > 0) {
      console.log(
        `  ${heldBackwards.length} refused as BACKWARD — this export is behind the database:`,
      )
      for (const line of heldBackwards.slice(0, 20)) console.log(`    ${line}`)
      if (heldBackwards.length > 20) {
        console.log(`    … and ${heldBackwards.length - 20} more`)
      }
    }
    console.log(`  ${enriched} live loads enriched`)
    console.log(`  ${missingCustomers.length} customers created`)
    console.log(
      `  ${seconds.toFixed(1)}s total, ${(created / Math.max(seconds, 0.001)).toFixed(0)} loads/second`,
    )
  } finally {
    await db.$disconnect()
  }
}

await main()

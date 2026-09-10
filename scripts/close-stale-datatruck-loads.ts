import { neonConfig } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { createPrismaClient } from '@/lib/db'
import { asRecords, readXlsx } from '@/lib/datatruck/xlsx'
import { readStatus } from '@/lib/datatruck/loads'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// LOADS DATATRUCK LEFT OPEN AND NOBODY HERE WILL EVER SETTLE.
//
//   npx tsx -r dotenv/config scripts/close-stale-datatruck-loads.ts --production
//   npx tsx -r dotenv/config scripts/close-stale-datatruck-loads.ts --production --apply
//
// ── WHAT THIS IS FOR ─────────────────────────────────────────────────────
//
// Production carries imported loads sitting in BOOKED, DISPATCHED or
// IN_TRANSIT with pickups going back to 2024-12-01. The current export still
// calls every one of them open, so the forward-only sync will never advance
// them; they would sit open forever, and an open load is a load this system
// can be asked to settle.
//
// `closeIfStale` stops the importer creating more of them. This closes the
// ones already here.
//
// ── THE BILLING AXIS ONLY, AND THAT IS THE RULING ────────────────────────
//
// `CLOSED_IN_DATATRUCK` says "not ours to settle", which is what is actually
// true, and it already has a rule and a test behind it. CANCELLING would
// assert the freight did not happen — a claim about the world rather than
// about whose books it sits on, and several of these carry a driver, a truck
// and real revenue.
//
// So `operationalStatus` is NEVER touched. A load that was DISPATCHED and
// never delivered stays DISPATCHED: that is the honest record of what happened
// to it, and it is the only thing left saying so.
//
// ── WHY THE REFUSALS ARE STRICT ──────────────────────────────────────────
//
// The owner's framing, and it is the reason this file is built the way it is:
//
//   "Reversibility isn't the argument for doing 36 now. A closed load stops
//   appearing on every screen anyone looks at, so the cost of a wrong close
//   isn't recovery, it's that nobody ever notices again."
//
// A wrong close is not loud. Nothing errors, no money moves, and the row
// simply stops being somewhere anybody looks — so the safety cannot be "we can
// undo it", it has to be "it was never written". Hence:
//
//   * IT NAMES EVERY ID. There is no query that decides what to close. The ids
//     come from a report a person read, on the command line or from the
//     pass-1 list below — a rule invented to describe one clear-out is a rule
//     nobody can check.
//   * IT ASKS BOTH SIDES. A row is closed only if Zebra still shows it open
//     AND the current Datatruck export still shows it open. If the export has
//     since delivered it, the SYNC should advance it and this must not
//     pre-empt that.
//   * ANY DISAGREEMENT REFUSES THAT ROW AND NAMES IT. Not the batch — one
//     row's surprise is not a reason to abandon the rest — but that row is
//     left exactly as it was and printed under a heading somebody will read.
//   * DRY RUN IS THE DEFAULT. `--apply` is a second decision, and a second run
//     finds the rows already closed and does nothing.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const APPLY = process.argv.includes('--apply')
const PRODUCTION = process.argv.includes('--production')

const DEFAULT_EXPORT =
  'corpus/datatruck/loads-and-trips_2026_09_08_20_05_05.xlsx'
const FILE =
  process.argv.find((argument) => argument.endsWith('.xlsx')) ?? DEFAULT_EXPORT

const ORGANIZATION_SLUG = 'zebra'
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'

/**
 * PASS 1 — the eighteen under retired authorities.
 *
 * Midwest Global Logistics (16) and American Soldier Transport (2). Both
 * stopped hauling before this system existed, so an open row under one is
 * unambiguously finished: it is not going to move, and nobody here will ever
 * be paid for it. The owner's ruling was to close these "without further
 * thought"; the thirty-six under live authorities are a separate pass and are
 * deliberately not in this list.
 *
 * TRANSCRIBED FROM THE REPORT THAT FOUND THEM, on 2026-09-10.
 */
const PASS_ONE = [
  'DT-001242',
  'DT-001245',
  'DT-001248',
  'DT-001362',
  'DT-001527',
  'DT-001746',
  'DT-001887',
  'DT-002587',
  'DT-002597',
  'DT-002807',
  'DT-003111',
  'DT-003162',
  'DT-003277',
  'DT-003382',
  'DT-003878',
  'DT-004183',
  'DT-006361',
  'DT-008363',
] as const

const named = process.argv.filter((argument) => /^DT-\d+$/.test(argument))
const ids = named.length > 0 ? named : [...PASS_ONE]

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

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function main(): Promise<void> {
  const where = target()
  const db = createPrismaClient(where.url)

  try {
    await assertTenancy(db, {
      label: where.label,
      host: where.host,
      slug: ORGANIZATION_SLUG,
      expectOrganizationId: where.expectOrganizationId,
    })

    // ── WHAT DATATRUCK SAYS TODAY ──────────────────────────────────────
    const records = asRecords(await readXlsx(readFileSync(FILE)))
    const exported = new Map(
      records.map((record) => [
        String(record['Shipment ID'] ?? '').trim(),
        String(record['Load status'] ?? '').trim(),
      ]),
    )
    console.log(`  export        ${FILE}`)
    console.log(`                ${records.length} row(s)`)

    heading(`ASKED TO CLOSE — ${ids.length}`)
    console.log(
      named.length > 0
        ? '  ids given on the command line'
        : '  the pass-one list: retired authorities only',
    )

    const closing: { id: string; loadId: string; line: string }[] = []
    const refused: string[] = []
    const already: string[] = []

    for (const externalId of ids) {
      const load = await db.load.findFirst({
        where: { externalId },
        select: {
          id: true,
          loadNumber: true,
          externalId: true,
          operationalStatus: true,
          billingStatus: true,
          isCancelled: true,
          deletedAt: true,
          totalRevenueCents: true,
          driverId: true,
          company: { select: { name: true, retired: true } },
        },
      })

      if (!load) {
        refused.push(`${externalId}  no load on this database carries that id`)
        continue
      }
      if (load.deletedAt) {
        refused.push(`${externalId}  the load is removed`)
        continue
      }
      if (load.billingStatus === 'CLOSED_IN_DATATRUCK') {
        already.push(`${externalId}  already closed`)
        continue
      }
      if (load.isCancelled) {
        // A cancelled load is already outside the settleable set, and moving
        // its billing status would be this script tidying a row it was not
        // asked about.
        refused.push(`${externalId}  the load is cancelled; nothing to do`)
        continue
      }

      // ── THE OTHER SIDE ────────────────────────────────────────────────
      const raw = exported.get(externalId)
      if (raw === undefined) {
        refused.push(
          `${externalId}  not in ${FILE} — cannot confirm it is still open in Datatruck`,
        )
        continue
      }
      const reading = readStatus(raw)
      if (!reading) {
        refused.push(
          `${externalId}  export says ${JSON.stringify(raw)}, which has no counterpart here`,
        )
        continue
      }
      if (reading.closed) {
        // THE IMPORTANT REFUSAL. Datatruck has finished it since the report was
        // written, so the SYNC should advance this load — status, billing and
        // rate, with its own events. Closing it here would land the right
        // billing status by the wrong route and lose the rest.
        refused.push(
          `${externalId}  export now says ${JSON.stringify(raw)} — let the sync advance it`,
        )
        continue
      }

      closing.push({
        id: externalId,
        loadId: load.id,
        line:
          `  ${externalId}  ${String(load.loadNumber).padEnd(10)} ` +
          `${load.operationalStatus.padEnd(11)} ${money(load.totalRevenueCents).padStart(11)}  ` +
          `${load.driverId ? 'has driver' : 'no driver '}  ` +
          `${load.company.retired ? 'RETIRED' : 'LIVE   '} ${load.company.name}  ` +
          `export=${raw}`,
      })
    }

    heading(`WOULD CLOSE — ${closing.length}`)
    for (const row of closing) console.log(row.line)

    if (already.length > 0) {
      heading(`ALREADY CLOSED — ${already.length}`)
      for (const line of already) console.log(`  ${line}`)
    }

    if (refused.length > 0) {
      heading(`REFUSED — ${refused.length}`)
      for (const line of refused) console.log(`  ${line}`)
    }

    if (!APPLY) {
      console.log('')
      console.log('  DRY RUN. Nothing was written. Re-run with --apply.')
      return
    }

    // ── THE WRITE ─────────────────────────────────────────────────────────
    //
    // ONE ROW AT A TIME, EACH RE-CHECKED IN ITS OWN STATEMENT. `updateMany`
    // with the billing status in the WHERE means a row that changed between
    // the read above and this write is not touched, and the count says so.
    let closed = 0
    for (const row of closing) {
      const result = await db.load.updateMany({
        where: {
          id: row.loadId,
          deletedAt: null,
          isCancelled: false,
          billingStatus: { not: 'CLOSED_IN_DATATRUCK' },
        },
        data: { billingStatus: 'CLOSED_IN_DATATRUCK' },
      })
      if (result.count === 1) {
        closed++
      } else {
        console.log(`  ${row.id}  changed under us; left alone`)
      }
    }

    heading('WRITTEN')
    console.log(`  ${closed} load(s) closed`)
    console.log(`  ${closing.length - closed} left alone after a re-check`)
    console.log('')
    console.log('  operationalStatus was not touched on any row.')
  } finally {
    await db.$disconnect()
  }
}

await main()

import { neonConfig } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { createPrismaClient } from '@/lib/db'
import { asRecords, readXlsx } from '@/lib/datatruck/xlsx'
import { planLoads } from '@/lib/datatruck/loads'

// ---------------------------------------------------------------------------
// WHICH ROWS OF AN EXPORT ACTUALLY LANDED AS SETTLEABLE, AND WHICH DID NOT.
//
//   npx tsx -r dotenv/config scripts/inspect-week-landing.ts --production \
//     corpus/datatruck/loads-and-trips_2026_09_24_16_49_51.xlsx
//
// SELECT ONLY.
//
// ── WHY IT EXISTS ─────────────────────────────────────────────────────────
//
// The 2026-09-13..19 write reported 185 loads and 182 operational events, and
// the preflight then counted 177 loads reaching POD_RECEIVED in the week. The
// export holds 181 rows the books own. Three numbers that should agree, and a
// difference of four loads is four drivers' pay.
//
// EVERY ONE OF THOSE IS A DIFFERENT QUESTION, which is why guessing between
// them is the wrong move:
//
//   185  rows written                     — did the row land at all?
//   182  transitions that changed status  — did it get its event?
//   181  rows the cutover calls live      — should it have one?
//   177  settleable in the week           — is the event dated inside it?
//
// So this walks the export ROW BY ROW against the database and prints the ones
// that fall out, with the reason. `settleableWhere` needs four things at once —
// the status, an APPLIED POD_RECEIVED event, that event's date inside the
// period, and somebody in a seat — and a row can miss on any one of them while
// looking perfectly normal on the load list.
//
// BUILT FROM THE ARTEFACT, not from the importer's own report. The importer
// counting its own writes is the instrument-from-belief failure; this reads the
// export it was given and asks the database what became of each line.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const PRODUCTION = process.argv.includes('--production')
const FILE = process.argv.find((a) => a.endsWith('.xlsx'))

const WEEK_START = new Date('2026-09-13T00:00:00.000Z')
const WEEK_END = new Date('2026-09-19T23:59:59.999Z')

function target() {
  const url = PRODUCTION
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('No database url for that target.')
  return { url, label: PRODUCTION ? 'PRODUCTION' : 'DEV' }
}

const heading = (text: string) => {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 70)))
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const stamp = (d: Date | null) => (d === null ? 'none' : d.toISOString())

async function main(): Promise<void> {
  if (!FILE) throw new Error('Name the export workbook (.xlsx).')
  const where = target()
  const db = createPrismaClient(where.url)
  console.log(`Target: ${where.label}`)
  console.log(`Export: ${FILE}`)

  try {
    const plan = planLoads(
      asRecords(await readXlsx(new Uint8Array(readFileSync(FILE)))),
    )
    const booksOwn = plan.planned.filter((l) => l.booksOwn)
    console.log(`rows: ${plan.planned.length}, books own: ${booksOwn.length}`)

    const rows = await db.load.findMany({
      where: { externalId: { in: booksOwn.map((l) => l.externalId) } },
      select: {
        externalId: true,
        loadNumber: true,
        operationalStatus: true,
        isCancelled: true,
        deletedAt: true,
        driverId: true,
        coDriverId: true,
        linehaulCents: true,
        statusEvents: {
          // `axis`, NOT `kind` — and APPLIED is an `outcome`, not a timestamp.
          // A REFUSED_STALE event exists on the row and did not move the load,
          // so counting it would report a POD that never happened.
          where: { axis: 'OPERATIONAL' },
          select: { toStatus: true, occurredAt: true, outcome: true },
          orderBy: { occurredAt: 'asc' },
        },
      },
    })
    const byExternal = new Map(rows.map((r) => [r.externalId, r]))

    heading('EVERY BOOKS-OWN ROW THAT IS NOT SETTLEABLE IN THE WEEK')

    let ok = 0
    const misses: string[] = []
    for (const planned of booksOwn) {
      const row = byExternal.get(planned.externalId)
      if (!row) {
        misses.push(`  ${planned.externalId}  NOT IN THE DATABASE AT ALL`)
        continue
      }
      const reasons: string[] = []
      if (row.deletedAt !== null) reasons.push('soft-deleted')
      if (row.isCancelled) reasons.push('cancelled')
      if (row.operationalStatus !== 'POD_RECEIVED') {
        reasons.push(`status is ${row.operationalStatus}, not POD_RECEIVED`)
      }
      if (row.driverId === null && row.coDriverId === null) {
        reasons.push('nobody in either seat')
      }
      const pod = row.statusEvents.filter(
        (e) => e.toStatus === 'POD_RECEIVED' && e.outcome === 'APPLIED',
      )
      if (pod.length === 0) {
        reasons.push(
          `no APPLIED POD_RECEIVED event (has ${row.statusEvents.length} operational event(s))`,
        )
      } else {
        const inWeek = pod.some(
          (e) =>
            e.occurredAt.getTime() >= WEEK_START.getTime() &&
            e.occurredAt.getTime() <= WEEK_END.getTime(),
        )
        if (!inWeek) {
          reasons.push(
            `POD event dated OUTSIDE the week: ${pod.map((e) => stamp(e.occurredAt)).join(', ')}`,
          )
        }
      }

      if (reasons.length === 0) {
        ok++
        continue
      }
      misses.push(
        `  ${row.loadNumber}  ${money(row.linehaulCents)}  ${reasons.join('; ')}`,
      )
    }

    console.log(`  settleable in the week: ${ok} of ${booksOwn.length}`)
    if (misses.length === 0) {
      console.log('  Nothing fell out. All three counts agree.')
    } else {
      console.log(`  FELL OUT: ${misses.length}`)
      for (const line of misses) console.log(line)
    }

    // ── AND THE PREFLIGHT'S OWN QUERY, ON THIS CONNECTION ────────────────
    //
    // The preflight counts 177 where the walk above counts 181. Two instruments
    // disagreeing about the same week is a finding in itself, and picking the
    // nicer number is how a short settlement gets signed off. So the preflight's
    // SQL runs here, against the same rows, and the difference is named.
    heading("THE PREFLIGHT'S COUNT, RUN HERE")
    const viaSql = await db.$queryRaw<{ loadNumber: string }[]>`
      SELECT l."loadNumber"
        FROM "Load" l
        JOIN "LoadStatusEvent" e ON e."loadId" = l.id
       WHERE e.axis = 'OPERATIONAL'
         AND e."toStatus"::text = 'POD_RECEIVED'
         AND e.outcome::text = 'APPLIED'
         AND e."occurredAt" BETWEEN ${WEEK_START} AND ${WEEK_END}
    `
    console.log(`  the preflight's SQL returns: ${viaSql.length}`)

    const sqlSet = new Set(viaSql.map((r) => r.loadNumber))
    const walkSet = new Set(
      booksOwn
        .map((l) => byExternal.get(l.externalId))
        .filter((r) => r !== undefined)
        .map((r) => r!.loadNumber),
    )
    const onlyInWalk = [...walkSet].filter((n) => !sqlSet.has(n)).sort()
    const onlyInSql = [...sqlSet].filter((n) => !walkSet.has(n)).sort()

    console.log(`  in the walk but not the SQL: ${onlyInWalk.length}`)
    for (const n of onlyInWalk) {
      const row = rows.find((r) => r.loadNumber === n)!
      console.log(
        `    ${n}  ${money(row.linehaulCents)}  events: ` +
          row.statusEvents
            .map((e) => `${e.toStatus}@${stamp(e.occurredAt)}/${e.outcome}`)
            .join(', '),
      )
    }
    console.log(`  in the SQL but not the walk: ${onlyInSql.length}`)
    for (const n of onlyInSql.slice(0, 20)) console.log(`    ${n}`)

    // ── THE SHIFTED WINDOW, MEASURED ─────────────────────────────────────
    //
    // `occurredAt` is TIMESTAMP(3) — WITHOUT time zone. The preflight passes JS
    // Dates through a raw `pg` Pool, which serialises them in the PROCESS'S
    // LOCAL ZONE, so on a UTC-4 machine its window silently becomes
    // 09-12 20:00 -> 09-19 19:59:59.999. Loads delivered late on the last day
    // of the period fall out of the gate that is supposed to clear the week.
    //
    // Counted rather than reasoned about, because the arithmetic looked fine to
    // whoever wrote it — including to me, twice, before this was measured.
    const offsetMin = new Date().getTimezoneOffset()
    // MINUS, not plus. `getTimezoneOffset()` returns +240 for UTC-4, so the
    // local wall-clock string is the UTC instant MINUS 240 minutes — the window
    // ends EARLIER than intended, which is why the loss is at the end of the
    // last day. Written out because the sign was wrong on the first attempt and
    // a wrong sign still produces a plausible-looking count.
    const shiftedEnd = new Date(WEEK_END.getTime() - offsetMin * 60_000)
    const lateOnLastDay = await db.load.count({
      where: {
        externalId: { in: booksOwn.map((l) => l.externalId) },
        statusEvents: {
          some: {
            axis: 'OPERATIONAL',
            toStatus: 'POD_RECEIVED',
            outcome: 'APPLIED',
            occurredAt: { gt: shiftedEnd, lte: WEEK_END },
          },
        },
      },
    })
    console.log(
      `  local offset ${offsetMin} min, so a raw-pg window really ends ${stamp(shiftedEnd)}`,
    )
    console.log(
      `  books-own loads whose POD falls in the gap that opens: ${lateOnLastDay}`,
    )

    // ── WHY A LOAD READS AS `over` ────────────────────────────────────────
    //
    // `--why-over <loadNumber>...` prints, for each load, its own money and
    // every remittance row keyed to its reference.
    //
    // The first explanation offered for the seven over-lines on 2026-09-13..19
    // was "a trip's total compared against one leg of several". The grouping fix
    // then measured that NO Zebra load shares a reference with another — so that
    // mechanism cannot be it, and the fix, while correct in principle, is inert
    // on this data. This is the instrument that says what the cause actually is.
    const whyAt = process.argv.indexOf('--why-over')
    if (whyAt !== -1) {
      const numbers = process.argv
        .slice(whyAt + 1)
        .filter((a) => a.startsWith('DT-'))
      const { readRemittance } = await import('@/lib/amazon/remittance')
      const { keyFor } = await import('@/lib/amazon/remittance-preview')
      const book = process.argv.find(
        (a) => a.includes('corpus/amazon') && a.endsWith('.xlsx'),
      )
      if (!book) throw new Error('Name the remittance workbook too.')
      const out = await readRemittance(new Uint8Array(readFileSync(book)))
      if (!out.ok) throw new Error('the remittance workbook was refused')

      heading(`WHY THESE READ AS over — ${numbers.join(', ')}`)
      const subjects = await db.load.findMany({
        where: { loadNumber: { in: numbers } },
        select: {
          loadNumber: true,
          referenceNumber: true,
          linehaulCents: true,
          accessorialsCents: true,
          totalRevenueCents: true,
          paymentApplications: { select: { amountCents: true } },
        },
      })
      for (const l of subjects) {
        const applied = l.paymentApplications.reduce(
          (sum, a) => sum + a.amountCents,
          0,
        )
        console.log(`\n  ${l.loadNumber}  reference ${l.referenceNumber}`)
        console.log(
          `      linehaul ${money(l.linehaulCents)}  accessorials ${money(l.accessorialsCents)}  total ${money(l.totalRevenueCents)}`,
        )
        console.log(`      applied from the remittance: ${money(applied)}`)
        const rows = out.reading.rows.filter((r) => {
          const k = keyFor(r)
          const ref =
            k.branch === 'tour' || k.branch === 'load_under_trip'
              ? k.tripId
              : k.branch === 'single_load'
                ? k.loadId
                : null
          return ref !== null && ref === l.referenceNumber
        })
        console.log(`      remittance rows on that reference: ${rows.length}`)
        for (const r of rows) {
          console.log(
            `         ${r.itemType.padEnd(18)} trip=${r.tripId ?? '-'}  load=${r.loadId ?? '-'}  gross=${money(r.grossCents)}`,
          )
        }
      }
    }

    // ── IS THE TOUR BASE ALREADY INSIDE `Load pay`? ─────────────────────
    //
    // `--tour-base <workbook>` answers the question the blanket ruling turns on.
    // Booking every TOUR - COMPLETED base as additional revenue made 5 loads
    // match and 29 go SHORT, which says the base was already in the rate for
    // those 29. This counts the two populations instead of guessing which.
    //
    // For every trip carrying a completed tour: the remitted total, the load's
    // linehaul as Datatruck set it, and the tour base. If linehaul already
    // equals the remitted total the base is inside it; if the gap IS the base,
    // it is missing.
    if (process.argv.includes('--tour-base')) {
      const { readRemittance } = await import('@/lib/amazon/remittance')
      const { keyFor } = await import('@/lib/amazon/remittance-preview')
      const book = process.argv.find(
        (a) => a.includes('corpus/amazon') && a.endsWith('.xlsx'),
      )
      if (!book) throw new Error('Name the remittance workbook.')
      const out = await readRemittance(new Uint8Array(readFileSync(book)))
      if (!out.ok) throw new Error('the remittance workbook was refused')

      interface Trip {
        remitted: number
        tourBase: number
      }
      const trips = new Map<string, Trip>()
      for (const row of out.reading.rows) {
        const k = keyFor(row)
        const ref =
          k.branch === 'tour' || k.branch === 'load_under_trip'
            ? k.tripId
            : k.branch === 'single_load'
              ? k.loadId
              : null
        if (ref === null) continue
        const t = trips.get(ref) ?? { remitted: 0, tourBase: 0 }
        t.remitted += row.grossCents
        if (row.itemType === 'TOUR - COMPLETED') {
          t.tourBase += row.money['Base Rate'] ?? 0
        }
        trips.set(ref, t)
      }

      const withTour = [...trips].filter(([, t]) => t.tourBase > 0)
      const subjects = await db.load.findMany({
        where: { referenceNumber: { in: withTour.map(([ref]) => ref) } },
        select: {
          loadNumber: true,
          referenceNumber: true,
          linehaulCents: true,
        },
      })
      const byRef = new Map(subjects.map((l) => [l.referenceNumber ?? '', l]))

      heading(`TOUR BASE: ALREADY IN THE RATE, OR MISSING FROM IT?`)
      let already = 0
      let missing = 0
      let neither = 0
      const neitherRows: string[] = []
      for (const [ref, t] of withTour) {
        const load = byRef.get(ref)
        if (!load) continue
        if (load.linehaulCents === t.remitted) {
          already++
          continue
        }
        if (t.remitted - load.linehaulCents === t.tourBase) {
          missing++
          continue
        }
        neither++
        neitherRows.push(
          `    ${load.loadNumber}  remitted ${money(t.remitted)}` +
            `  linehaul ${money(load.linehaulCents)}` +
            `  tour base ${money(t.tourBase)}` +
            `  gap ${money(t.remitted - load.linehaulCents)}`,
        )
      }
      console.log(`  trips carrying a completed tour: ${withTour.length}`)
      console.log(
        `  base ALREADY in the rate (linehaul == remitted):        ${already}`,
      )
      console.log(
        `  base MISSING from the rate (gap == the tour base):      ${missing}`,
      )
      console.log(
        `  neither — the gap is something else:                    ${neither}`,
      )
      for (const line of neitherRows.slice(0, 15)) console.log(line)
    }

    console.log('\nEVERY STATEMENT ABOVE IS A READ. Nothing was changed.')
  } finally {
    await db.$disconnect()
  }
}

await main()

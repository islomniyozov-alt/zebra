import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'

// ---------------------------------------------------------------------------
// DOES THE PERSON EXIST, AND ON WHAT TERMS ARE THEY PAID?
//
//   npx tsx -r dotenv/config scripts/inspect-crew-and-rules.ts --production
//
// SELECT ONLY. The fence in tests/prod-url-guard.test.ts holds this file to
// that by name, and by refusing any mutating verb in its text at all.
//
// ── WHY IT EXISTS ─────────────────────────────────────────────────────────
//
// The loads preview reports names that resolve to NOTHING. That is a count of
// refusals, and a zero in it is not evidence that anybody resolved — the
// standing rule about counting the thing you are claiming rather than a
// superset of it. Two readings on 2026-09-24 turned on the difference:
//
//   1. `JULIA ROSE HALL` was reported present on production and the preview
//      still resolved her to nothing on 7 loads. Either the row is absent, or
//      it is there under a name that does not match the export's spelling, or
//      it is there and not live. Those need different answers and the preview
//      cannot tell them apart.
//   2. All three CO-DRIVER tables came back zero on a week whose co-driver
//      column contains `7 Star` and `Said truck 3609`. If those resolve, they
//      resolve to driver rows somebody made — worth seeing before 39 second
//      seats are filled from them.
//
// So this asks the rows: who exists under these names, whether they are live,
// and every pay rule version they hold with its effective window.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const PRODUCTION = process.argv.includes('--production')

/** The same key the seed resolves names by: trimmed, collapsed, upper. */
const nameKey = (raw: string) => raw.trim().replace(/\s+/g, ' ').toUpperCase()

/** The driver name the preview could not resolve. */
const DRIVER_NAMES = [
  'JULIA ROSE HALL',
  'CANER GUNAL',
  'GUNAL BENER',
  'BENER GUNAL',
  'ROSARIO SANTOS RODOLFO',
]

/** Every co-driver name in the 2026-09-13..19 export, verbatim. */
const CO_DRIVER_NAMES = [
  '7 Star',
  'Chapan Haydar',
  'Chapan Odiljon',
  'HAIDAR NIYOZOV',
  'JERRY ROBERT MCKANE',
  'ODILJON NIYOZOV',
  'Said truck 3609',
]

/** Pay rules reported in full for these two, by ruling. */
const RULES_FOR = [
  'JULIA ROSE HALL',
  'JERRY ROBERT MCKANE',
  'CANER GUNAL',
  'GUNAL BENER',
  'ROSARIO SANTOS RODOLFO',
]

/** Units whose freight is in question, to see who Zebra links to them. */
const UNITS = ['0006', '216']

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

const heading = (text: string) => {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 70)))
}

const day = (value: Date | null) =>
  value === null ? 'open' : value.toISOString().slice(0, 10)

async function main(): Promise<void> {
  const where = target()
  const db = createPrismaClient(where.url)
  console.log(`Target: ${where.label}`)

  try {
    // EVERY DRIVER, then matched in memory. The set is ~160 rows, and doing the
    // name comparison in SQL would be a second definition of `nameKey`.
    const drivers = await db.driver.findMany({
      // `status` IS THE ROSTER STATUS — `driver-roster.ts` names the three a
      // human may write (AVAILABLE, VACATION, INACTIVE) and the three the
      // freight derives. There is no `isActive` column; liveness is
      // `deletedAt === null` plus a roster value, which is why both are read.
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
        externalId: true,
        companyId: true,
        terminationDate: true,
        deletedAt: true,
      },
    })
    const companies = await db.company.findMany({
      select: {
        id: true,
        name: true,
        legalName: true,
        mcNumber: true,
        scac: true,
      },
    })
    heading('THE COMPANIES, AND WHAT THEY CAN BE MATCHED BY')
    for (const c of companies) {
      console.log(
        `  ${c.name.padEnd(32)} mc=${c.mcNumber ?? '(none)'}  scac=${c.scac ?? '(none)'}  legal=${c.legalName ?? '(none)'}`,
      )
    }
    const companyName = new Map(companies.map((c) => [c.id, c.name]))

    const full = (d: (typeof drivers)[number]) =>
      `${d.firstName} ${d.lastName}`.trim()

    const byKey = new Map<string, typeof drivers>()
    for (const d of drivers) {
      const key = nameKey(full(d))
      byKey.set(key, [...(byKey.get(key) ?? []), d])
    }

    console.log(`drivers on this database: ${drivers.length}`)
    const live = drivers.filter(
      (d) => d.deletedAt === null && d.status !== 'INACTIVE',
    )
    console.log(`  live (not soft-gone, roster not INACTIVE): ${live.length}`)

    const report = (title: string, names: readonly string[]) => {
      heading(title)
      for (const name of names) {
        const hits = byKey.get(nameKey(name)) ?? []
        if (hits.length === 0) {
          // A NEAR MISS IS A DIFFERENT FINDING from an absent row, and it is
          // the whole question here: a row under another spelling is present
          // and unresolvable, which looks identical from the preview.
          //
          // EVERY TOKEN, NOT JUST THE SURNAME. Searching the last word alone
          // reports "no row" for `JULIA ROSE HAL` — a typo in the surname is
          // exactly the case this is meant to catch, and the surname is the
          // one part it could not see.
          const tokens = nameKey(name).split(' ').filter(Boolean)
          const near = drivers.filter((d) => {
            const key = nameKey(full(d))
            return tokens.some((token) => key.includes(token))
          })
          console.log(`  NO ROW    ${name}`)
          for (const d of near) {
            console.log(
              `              near: "${full(d)}"  roster=${d.status}  ${companyName.get(d.companyId) ?? d.companyId}`,
            )
          }
          if (near.length === 0) {
            console.log(
              `              no name on file contains any of: ${tokens.join(', ')}`,
            )
          }
          continue
        }
        for (const d of hits) {
          const flags = [
            d.deletedAt === null ? 'present' : 'SOFT-GONE',
            `roster=${d.status}`,
            d.terminationDate === null
              ? 'not terminated'
              : `TERMINATED ${d.terminationDate.toISOString().slice(0, 10)}`,
            d.externalId ? `ext=${d.externalId}` : 'no externalId',
          ].join('  ')
          console.log(
            `  ${hits.length > 1 ? 'TWO ROWS' : 'FOUND   '}  ${name}  ->  "${full(d)}"  ${flags}  ${companyName.get(d.companyId) ?? d.companyId}`,
          )
        }
      }
    }

    // HOW THE FLEET'S OWN ROWS SPLIT A THREE-WORD NAME. A new row has to match
    // it, because the seed resolves on `firstName + ' ' + lastName` and the
    // convention is data, not a guess.
    heading('HOW EXISTING THREE-WORD NAMES ARE SPLIT')
    for (const d of drivers.filter(
      (x) => `${x.firstName} ${x.lastName}`.trim().split(/\s+/).length === 3,
    )) {
      console.log(
        `  first="${d.firstName}"  last="${d.lastName}"  ${companyName.get(d.companyId) ?? ''}`,
      )
    }

    report('THE DRIVER NAME THE PREVIEW COULD NOT RESOLVE', DRIVER_NAMES)
    report('THE CO-DRIVER NAMES, ALL SEVEN', CO_DRIVER_NAMES)

    heading('PAY RULES, EVERY VERSION, BY EFFECTIVE WINDOW')
    for (const name of RULES_FOR) {
      const hits = byKey.get(nameKey(name)) ?? []
      if (hits.length === 0) {
        console.log(`  ${name}: no driver row, so no rule to hold`)
        continue
      }
      for (const d of hits) {
        const rules = await db.driverPayRule.findMany({
          where: { driverId: d.id },
          orderBy: { effectiveFrom: 'asc' },
          select: {
            type: true,
            percentBps: true,
            perMileCents: true,
            flatCents: true,
            effectiveFrom: true,
            effectiveTo: true,
            notes: true,
          },
        })
        console.log(`\n  ${full(d)} — ${rules.length} rule version(s)`)
        if (rules.length === 0) {
          console.log(
            '    NONE. A settleable load for this driver has no rule in force.',
          )
        }
        for (const r of rules) {
          const amount =
            r.percentBps !== null
              ? `${r.percentBps / 100}%  (${r.percentBps} bps)`
              : r.perMileCents !== null
                ? `${r.perMileCents}c/mile`
                : r.flatCents !== null
                  ? `$${(r.flatCents / 100).toFixed(2)} flat`
                  : '(no amount)'
          console.log(
            `    ${r.type.padEnd(12)} ${amount.padEnd(22)} ${day(r.effectiveFrom)} -> ${day(r.effectiveTo)}${r.notes ? `  "${r.notes}"` : ''}`,
          )
        }
      }
    }

    // ── WHAT NARROWING SEAT RESOLUTION WOULD COST ───────────────────────
    //
    // The seed resolves a name against `deletedAt: null` and nothing else, so
    // it will seat a driver whose roster says INACTIVE. The ruling of
    // 2026-09-24 narrows that to "excludes roster-INACTIVE only" — and 107 of
    // production's 162 rows are INACTIVE, so the narrowing gets measured
    // before it is written. A name that stops resolving is freight that
    // silently loses its driver, which is the failure this whole week is
    // about.
    const EXPORT = process.argv.find((a) => a.endsWith('.xlsx'))
    if (EXPORT) {
      const { asRecords, readXlsx } = await import('@/lib/datatruck/xlsx')
      const { planLoads } = await import('@/lib/datatruck/loads')
      const { readFileSync } = await import('node:fs')
      const plan = planLoads(
        asRecords(await readXlsx(new Uint8Array(readFileSync(EXPORT)))),
      )

      const now = new Map<string, typeof drivers>()
      const narrowed = new Map<string, typeof drivers>()
      for (const d of drivers) {
        const key = nameKey(full(d))
        if (d.deletedAt === null) now.set(key, [...(now.get(key) ?? []), d])
        if (d.deletedAt === null && d.status !== 'INACTIVE') {
          narrowed.set(key, [...(narrowed.get(key) ?? []), d])
        }
      }

      heading(`SEAT RESOLUTION UNDER BOTH RULES — ${EXPORT}`)
      const picks = [
        ['driver', (l: (typeof plan.planned)[number]) => l.driverName],
        ['co-driver', (l: (typeof plan.planned)[number]) => l.coDriverName],
      ] as const
      for (const [label, pick] of picks) {
        const named = plan.planned.map(pick).filter((n): n is string => !!n)
        const resolves = (m: Map<string, typeof drivers>, n: string) =>
          (m.get(nameKey(n)) ?? []).length === 1
        const nowOk = named.filter((n) => resolves(now, n)).length
        const narrowOk = named.filter((n) => resolves(narrowed, n)).length
        console.log(
          `  ${label.padEnd(10)} ${named.length} named    ` +
            `deletedAt-only: ${nowOk}    excluding INACTIVE: ${narrowOk}`,
        )
        const lost = [
          ...new Set(
            named.filter((n) => resolves(now, n) && !resolves(narrowed, n)),
          ),
        ].sort()
        for (const n of lost) {
          const hit = (now.get(nameKey(n)) ?? [])[0]
          const rows = named.filter((x) => nameKey(x) === nameKey(n)).length
          console.log(
            `      WOULD STOP RESOLVING: "${n}" on ${rows} load(s) — roster=${hit?.status}`,
          )
        }
      }
    }

    // ── WHO LOOKS LIKE A REFERRAL PAYEE RATHER THAN A PERSON ────────────
    //
    // Owner's ruling, 2026-09-24: PAYEE goes on "the known non-people rows".
    // Which rows those are is a judgement with a safety edge — a payee is out
    // of the Driver Qualification File and out of the compliance warnings, so
    // marking a real driver as one silently removes them from the list an
    // FMCSA audit walks. That is the direction that must not be guessed, so
    // this LISTS and never sets.
    //
    // THE STRONGEST SIGNAL IS BEHAVIOURAL, NOT TEXTUAL. A referral payee earns
    // by sitting in the second seat and never drives: `driverId` count zero,
    // `coDriverId` count above zero. That is built from the freight that ran
    // rather than from what a name looks like — the standing rule about
    // building the instrument from the artefact. `7 Star` is only suspicious
    // as a string; it is conclusive as a row that has never driven.
    //
    // The textual signals are listed beside it as corroboration, never on
    // their own: a digit in the name, an equipment word, a single token, a
    // company suffix. `Said truck 3609` trips three of them and `Hassan Ali`
    // trips none, but a real driver called by one name would trip the third.
    heading('WHO IS LINKED TO THE UNITS IN QUESTION')
    for (const unit of UNITS) {
      const trucks = await db.truck.findMany({
        // No org filter: this script reads one database, and it does not
        // stand up a tenancy assertion of its own.
        where: { unitNumber: unit },
        select: {
          id: true,
          unitNumber: true,
          deletedAt: true,
          companyId: true,
        },
      })
      if (trucks.length === 0) {
        console.log(`  unit ${unit}: no truck row`)
        continue
      }
      for (const truck of trucks) {
        const linked = await db.driver.findMany({
          where: { assignedTruckId: truck.id, deletedAt: null },
          select: {
            firstName: true,
            lastName: true,
            status: true,
            externalId: true,
          },
        })
        console.log(
          `  unit ${unit}  ${companyName.get(truck.companyId) ?? ''}` +
            (truck.deletedAt ? '  SOFT-GONE' : '') +
            (linked.length === 0
              ? '  — no driver linked'
              : linked
                  .map(
                    (d) =>
                      `
      ${d.firstName} ${d.lastName}  roster=${d.status}  ext=${d.externalId ?? 'none'}`,
                  )
                  .join('')),
        )
      }
    }

    heading('REFERRAL PAYEE CANDIDATES — LISTED, NEVER SET')

    // IS THE BEHAVIOURAL SIGNAL INFORMATIVE AT ALL? If production holds no
    // load with a co-driver, then "2nd seat on 0" is true of everybody and
    // says nothing — a zero that is a finding about the instrument rather
    // than about the fleet. Printed first so the signal below cannot be read
    // without it.
    const withCoDriver = await db.load.count({
      where: { deletedAt: null, coDriverId: { not: null } },
    })
    const totalLoads = await db.load.count({ where: { deletedAt: null } })
    console.log(
      `  loads with anybody in the second seat: ${withCoDriver} of ${totalLoads}`,
    )
    if (withCoDriver === 0) {
      console.log(
        [
          '  SO THE BEHAVIOURAL SIGNAL IS VACUOUS on this database: nobody has',
          '  ever been a co-driver, so "never drove, only 2nd seat" cannot fire',
          '  for anyone, and its absence means nothing.',
        ].join('\n'),
      )
    }

    const asDriver = await db.load.groupBy({
      by: ['driverId'],
      where: { deletedAt: null },
      _count: { _all: true },
    })
    const asCoDriver = await db.load.groupBy({
      by: ['coDriverId'],
      where: { deletedAt: null },
      _count: { _all: true },
    })
    const droveCount = new Map(
      asDriver
        .filter((r) => r.driverId !== null)
        .map((r) => [r.driverId!, r._count._all]),
    )
    const secondSeatCount = new Map(
      asCoDriver
        .filter((r) => r.coDriverId !== null)
        .map((r) => [r.coDriverId!, r._count._all]),
    )

    const EQUIPMENT = /\b(truck|trailer|unit|tractor)\b/i
    const COMPANY = /\b(llc|inc|corp|transport|logistics|carrier|express)\b/i

    const rows = drivers
      .filter((d) => d.deletedAt === null)
      .map((d) => {
        const name = full(d)
        const drove = droveCount.get(d.id) ?? 0
        const second = secondSeatCount.get(d.id) ?? 0
        const signals: string[] = []
        if (drove === 0 && second > 0)
          signals.push('NEVER DROVE, only 2nd seat')
        if (/\d/.test(name)) signals.push('digit in name')
        if (EQUIPMENT.test(name)) signals.push('equipment word')
        if (name.trim().split(/\s+/).length === 1) signals.push('single token')
        if (COMPANY.test(name)) signals.push('company suffix')
        return { name, id: d.id, drove, second, signals, status: d.status }
      })
      .filter((r) => r.signals.length > 0)
      .sort((a, b) => b.signals.length - a.signals.length)

    console.log(
      `  ${rows.length} row(s) trip at least one signal, of ${drivers.filter((d) => d.deletedAt === null).length} live`,
    )
    for (const r of rows) {
      console.log(
        `\n  ${r.name}  ${r.id}  roster=${r.status}` +
          `\n      drove ${r.drove} load(s), 2nd seat on ${r.second}` +
          `\n      ${r.signals.join(' | ')}`,
      )
    }
    // ── WHAT A PERSON HAS THAT A COMMISSION DOES NOT ────────────────────
    //
    // A CDL on file is the signal that actually discriminates: a referral payee
    // has no licence because it is not somebody who drives. Read for each
    // candidate rather than inferred from the name, and printed even when it
    // contradicts the reading — which is the point of asking.
    heading('WHAT EACH CANDIDATE HOLDS')

    // THE BASELINE FIRST, OR "NO CDL" MEANS NOTHING. If most rows lack a
    // licence, its absence is the fleet's normal state and not a signal about
    // anybody — the same mistake as reading the vacuous second-seat count
    // above as support. Printed before the candidates so it cannot be skipped.
    const liveIds = drivers.filter((d) => d.deletedAt === null).map((d) => d.id)
    const withCdlItem = await db.complianceItem.groupBy({
      by: ['driverId'],
      where: { driverId: { in: liveIds }, type: 'CDL', deletedAt: null },
    })
    const withCdlNumber = await db.driver.count({
      where: { id: { in: liveIds }, cdlNumber: { not: null } },
    })
    console.log(
      `  BASELINE: ${withCdlItem.length} of ${liveIds.length} live rows hold a CDL` +
        ` compliance item; ${withCdlNumber} carry a cdlNumber.`,
    )
    console.log(
      `  So a missing CDL is ${withCdlItem.length * 2 < liveIds.length ? 'the MAJORITY state and weak as a signal' : 'unusual and worth weighing'}.`,
    )
    for (const r of rows) {
      const [ruleCount, cdl, driverRow] = await Promise.all([
        db.driverPayRule.count({ where: { driverId: r.id } }),
        db.complianceItem.findFirst({
          where: { driverId: r.id, type: 'CDL', deletedAt: null },
          select: { expiresAt: true },
        }),
        db.driver.findUnique({
          where: { id: r.id },
          select: { hireDate: true, cdlNumber: true, externalId: true },
        }),
      ])
      console.log(
        `  ${r.name}` +
          `\n      pay rules      ${ruleCount}` +
          `\n      CDL on file    ${cdl ? `yes, expires ${day(cdl.expiresAt)}` : 'NO'}` +
          `\n      cdlNumber      ${driverRow?.cdlNumber ?? '(none)'}` +
          `\n      hireDate       ${day(driverRow?.hireDate ?? null)}` +
          `\n      Datatruck id   ${driverRow?.externalId ?? '(none)'}`,
      )
    }

    console.log(
      [
        '',
        '  NOTHING ABOVE HAS BEEN CLASSIFIED, and the signal this was built',
        '  around turned out to be vacuous — so the textual ones are all that',
        '  fired, and a name is not evidence about a person. Read the holdings',
        '  above: a CDL on file argues the row IS somebody who drives, whatever',
        '  the name looks like.',
      ].join('\n'),
    )

    console.log('\nEVERY STATEMENT ABOVE IS A READ. Nothing was changed.')
  } finally {
    await db.$disconnect()
  }
}

await main()

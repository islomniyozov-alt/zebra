import { neonConfig } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { createPrismaClient } from '@/lib/db'
import { asRecords, readXlsx } from '@/lib/datatruck/xlsx'
import { planDriverFill, type CurrentDriver } from '@/lib/datatruck/driver-fill'
import { isQualifiable } from '@/lib/dqf'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// FILL ONLY EMPTY DRIVER FIELDS FROM A FULLER DATATRUCK EXPORT.
//
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/fill-drivers-from-export.ts                        (dev, preview)
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/fill-drivers-from-export.ts --write                (dev)
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/fill-drivers-from-export.ts --production           (preview)
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/fill-drivers-from-export.ts --production --write
//
// The rules are `src/lib/datatruck/driver-fill.ts`'s, where a test reaches
// them: keyed on Driver ID with the name checked, empty fields only, never an
// overwrite, a disagreement listed as KEPT, records only for a qualifiable
// driver with none of that type. The preview prints every change by name.
//
// PRODUCTION (owner's instruction 2026-11-18), on the seed writers' terms in
// tests/prod-url-guard.test.ts: `--production` reads PROD_DIRECT_DATABASE_URL,
// passed to `createPrismaClient` as an argument and assigned nowhere; preview
// is the default and `--write` a second decision; `assertTenancy` names the
// organization and refuses any id but the one the owner stated. The write
// repeats the empty condition, so a value typed since the preview survives.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const DEFAULT_EXPORT = 'corpus/datatruck/all-drivers_2026_09_09_07_56_22.xlsx'
const args = process.argv.slice(2)
const unknown = args.filter(
  (a) => a !== '--write' && a !== '--production' && !a.endsWith('.xlsx'),
)
if (unknown.length > 0)
  throw new Error(`Unknown argument(s): ${unknown.join(' ')}`)
const WRITE = args.includes('--write')
const PRODUCTION = args.includes('--production')
const FILE = args.find((a) => a.endsWith('.xlsx')) ?? DEFAULT_EXPORT

/** Stated by the owner, as in the drivers seed; not discovered here. */
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

async function main(): Promise<void> {
  const where = target()
  const bytes = new Uint8Array(readFileSync(FILE))
  const records = asRecords(await readXlsx(bytes))
  console.log(`export  ${FILE} (${records.length} rows)`)
  console.log(`mode    ${WRITE ? 'WRITE' : 'preview only'}`)

  const db = createPrismaClient(where.url)
  try {
    // This connection bypasses row-level security: the tenant is named, its
    // id checked on production, and every read and write below carries it.
    const { organizationId } = await assertTenancy(db, {
      label: where.label,
      host: where.host,
      slug: 'zebra',
      expectOrganizationId: where.expectOrganizationId,
    })

    const rows = await db.driver.findMany({
      where: { organizationId, deletedAt: null },
      select: {
        id: true,
        companyId: true,
        externalId: true,
        firstName: true,
        lastName: true,
        hireDate: true,
        cdlNumber: true,
        cdlState: true,
        cdlClass: true,
        status: true,
        kind: true,
        deletedAt: true,
        complianceItems: {
          where: { deletedAt: null, type: { in: ['CDL', 'MEDICAL_CARD'] } },
          select: { type: true },
        },
      },
    })
    const current: CurrentDriver[] = rows.map((d) => ({
      ...d,
      hasCdlRecord: d.complianceItems.some((c) => c.type === 'CDL'),
      hasMedicalRecord: d.complianceItems.some(
        (c) => c.type === 'MEDICAL_CARD',
      ),
      qualifiable: isQualifiable(d),
    }))
    const plan = planDriverFill(records, current)

    heading('COLUMNS')
    for (const { field, header } of plan.columns)
      console.log(
        `  ${field.padEnd(17)} ${header ? `"${header}"` : 'ABSENT from this export — nothing read'}`,
      )

    heading(`FILL — ${plan.fills.length} empty field(s)`)
    for (const f of plan.fills)
      console.log(`  ${f.who.padEnd(30)} ${f.field.padEnd(10)} ← ${f.value}`)
    const byField = new Map<string, number>()
    for (const f of plan.fills)
      byField.set(f.field, (byField.get(f.field) ?? 0) + 1)
    for (const [field, n] of byField)
      console.log(`  ${String(n).padStart(4)}  ${field}`)

    heading(`RECORDS — ${plan.records.length} to create`)
    for (const r of plan.records)
      console.log(
        `  ${r.who.padEnd(30)} ${r.field.padEnd(17)} expires ${r.expiresAt}`,
      )

    heading(
      `KEPT — ${plan.kept.length} where the database and the export disagree`,
    )
    for (const k of plan.kept)
      console.log(
        `  ${k.who.padEnd(30)} ${k.field.padEnd(10)} keeps ${k.current}; export says ${k.exported}`,
      )

    heading(`UNREADABLE — ${plan.unreadable.length}`)
    for (const u of plan.unreadable)
      console.log(
        `  ${u.who.padEnd(30)} ${u.field} ${JSON.stringify(u.raw)} — ${u.why}`,
      )

    heading(`HELD BY NAME — ${plan.heldByName.length}`)
    for (const h of plan.heldByName)
      console.log(
        `  Driver ID ${h.externalId}: export "${h.exported}", database "${h.current}"`,
      )

    heading(`NO DRIVER UNDER THE EXPORT'S ID — ${plan.unmatched.length}`)
    for (const u of plan.unmatched)
      console.log(`  Driver ID ${u.externalId.padEnd(5)} ${u.who}`)

    if (!WRITE) {
      heading('NOTHING WAS WRITTEN')
      console.log('  Re-run with --write once the above is agreed.')
      return
    }

    const companyOf = new Map(rows.map((d) => [d.id, d.companyId]))
    let written = 0
    for (const f of plan.fills) {
      const value =
        f.field === 'hireDate' ? new Date(`${f.value}T00:00:00.000Z`) : f.value
      // The empty condition repeated in the write: a value that arrived since
      // the read is not overwritten.
      const { count } = await db.driver.updateMany({
        where: {
          id: f.driverId,
          organizationId,
          ...(f.field === 'hireDate'
            ? { hireDate: null }
            : { OR: [{ [f.field]: null }, { [f.field]: '' }] }),
        },
        data: { [f.field]: value },
      })
      written += count
    }
    let created = 0
    for (const r of plan.records) {
      const after = await db.driver.findUniqueOrThrow({
        where: { id: r.driverId },
        select: { cdlNumber: true, cdlState: true },
      })
      await db.complianceItem.create({
        data: {
          organizationId,
          companyId: companyOf.get(r.driverId)!,
          driverId: r.driverId,
          type: r.field === 'cdlExpiresAt' ? 'CDL' : 'MEDICAL_CARD',
          expiresAt: new Date(`${r.expiresAt}T00:00:00.000Z`),
          ...(r.field === 'cdlExpiresAt'
            ? { identifier: after.cdlNumber, issuer: after.cdlState }
            : {}),
        },
      })
      created++
    }
    heading('WRITTEN')
    console.log(`  ${written} field(s) filled, ${created} record(s) created`)
  } finally {
    await db.$disconnect()
  }
}

await main()

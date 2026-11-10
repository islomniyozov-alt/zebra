import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { runInOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import {
  retireSeedPlaceholderTrucks,
  SEED_INACTIVE_REASON,
} from '@/lib/truck-retirement'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// THE SEED'S PLACEHOLDER TRUCKS BECOME REMOVED (TMS-DESIGN-SYSTEM.md §6.5
// part 1, owner's ruling (b) of 2026-11-10; GAPS data row).
//
//   npx tsx -r dotenv/config scripts/remove-datatruck-inactive-trucks.ts
//   npx tsx -r dotenv/config scripts/remove-datatruck-inactive-trucks.ts --write
//   npx tsx -r dotenv/config scripts/remove-datatruck-inactive-trucks.ts --production
//   npx tsx -r dotenv/config scripts/remove-datatruck-inactive-trucks.ts --production --write
//
// A DATA MIGRATION SCRIPT, NOT A SCHEMA MIGRATION, built like the seeds it
// undoes: preview by default, `--write` to act, `--production` guarded and
// naming the organization through `assertTenancy`, on the allowlist of
// tests/prod-url-guard.test.ts. Dev first, then production; the counts before
// and after are printed on both, by the trucks list's own predicates.
//
// The rule — who is a placeholder, how one is removed — is
// `src/lib/truck-retirement.ts`, where the integration test reaches it. This
// file picks the target, names the tenant and prints.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const WRITE = process.argv.includes('--write')
const PRODUCTION = process.argv.includes('--production')
const unknown = process.argv
  .slice(2)
  .filter((argument) => !['--write', '--production'].includes(argument))
if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(' ')}. Nothing read.`)
  process.exit(2)
}

const ORGANIZATION_SLUG = 'zebra'
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
  const db = createPrismaClient(where.url)
  try {
    const tenancy = await assertTenancy(db, {
      label: where.label,
      host: where.host,
      slug: ORGANIZATION_SLUG,
      expectOrganizationId: where.expectOrganizationId,
    })

    const plan = await runInOrg(
      db,
      tenancy.organizationId,
      (tx) =>
        retireSeedPlaceholderTrucks(tx, { write: WRITE, now: new Date() }),
      {
        timeoutMs: 120_000,
        attribution: unattributed(
          `scripts/remove-datatruck-inactive-trucks.ts — ${SEED_INACTIVE_REASON}, owner's ruling 2026-11-10`,
        ),
      },
    )

    heading(`BEFORE — by the trucks list's own views`)
    console.log(`  Active        ${plan.before.active}`)
    console.log(`  Inactive      ${plan.before.inactive}`)

    heading(
      `${WRITE ? 'REMOVED' : 'WOULD REMOVE'} — ${plan.candidates.length} placeholder(s): live, OUT_OF_SERVICE, no asset-history period, no audit UPDATE`,
    )
    const byAuthority = new Map<string, number>()
    for (const truck of plan.candidates) {
      byAuthority.set(
        truck.companyName,
        (byAuthority.get(truck.companyName) ?? 0) + 1,
      )
    }
    for (const [name, count] of byAuthority) {
      console.log(`  ${name.padEnd(36)} ${count}`)
    }
    for (const truck of plan.candidates) {
      console.log(
        `  unit ${truck.unitNumber.padEnd(10)} ${truck.companyName.padEnd(34)}${
          truck.openLoads.length > 0
            ? ` OPEN LOAD(S) KEEP THE LINK: ${truck.openLoads.join(', ')}`
            : ''
        }`,
      )
    }
    console.log(`  reason        ${SEED_INACTIVE_REASON}`)

    heading(
      `LEFT ALONE — ${plan.touched.length} matched the signature but a person has edited them since`,
    )
    for (const truck of plan.touched) {
      console.log(`  unit ${truck.unitNumber.padEnd(10)} ${truck.companyName}`)
    }

    if (plan.after) {
      heading(`AFTER — by the trucks list's own views`)
      console.log(`  Active        ${plan.after.active}`)
      console.log(`  Inactive      ${plan.after.inactive}`)
      console.log(`\nWROTE ${plan.written} removal(s) on ${where.label}. OK.`)
    } else {
      console.log(
        `\nPREVIEW — nothing written on ${where.label}. Pass --write to remove the ${plan.candidates.length} above.`,
      )
    }
  } finally {
    await db.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

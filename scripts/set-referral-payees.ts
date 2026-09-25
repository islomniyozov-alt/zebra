import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { assertDriverKind, isReferralPayee } from '@/lib/driver-kind'
import { isQualifiable } from '@/lib/dqf'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// MARK THE REFERRAL PAYEES, BY DATATRUCK ID, BY RULING.
//
//   npx tsx -r dotenv/config scripts/set-referral-payees.ts --production
//   npx tsx -r dotenv/config scripts/set-referral-payees.ts --production --apply
//
// Owner's ruling, 2026-09-24. Four rows: Datatruck ids 119, 136, 866 and 803.
// They take a commission on another driver's loads and settle like anyone else.
//
// ── KEYED ON `externalId`, NOT ON THE NAME ────────────────────────────────
//
// The owner named Datatruck ids, and those are the precise handle: `7 Star` is
// a name somebody typed and two rows could share it, while 119 identifies one
// row in the source system. It also means this script cannot be misread as
// matching a pattern — there is no pattern, there is a list of four.
//
// AND TWO OF THE FOUR WERE NOT FLAGGED BY ANY SIGNAL. `Chapan Haydar` (866) and
// `Chapan Odiljon` (803) read as people and trip nothing: no digit, no
// equipment word, no company suffix. They are on this list because the owner
// knows the arrangement and the data does not record it. That is the honest
// reason and it is written here rather than dressed up as a derivation — the
// alternative was a heuristic loose enough to catch them, which would also
// catch real drivers.
//
// ── WHAT THIS CHANGES, AND WHAT IT MUST NOT ───────────────────────────────
//
// Sets `kind`. Touches nothing else: not the roster status, not the pay rules,
// not a single load. The ruling is explicit that these rows stay ACTIVE and
// keep their rules, because inactivating them would stop paying them.
//
// The read-back asserts the exclusions actually took effect rather than
// assuming the column write implies them — `isQualifiable` must now return
// false, which is the DQF and the compliance warnings in one predicate.
//
// ── THE DRY RUN IS THE REAL PATH, ROLLED BACK ─────────────────────────────
//
// Same shape as `add-julia-and-rate-change.ts`. It writes inside a transaction,
// reads the rows back, and throws to roll back unless `--apply`.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const APPLY = process.argv.includes('--apply')
const PRODUCTION = process.argv.includes('--production')

/** Datatruck driver ids, by ruling. Not a pattern — a list of four. */
const PAYEE_EXTERNAL_IDS = ['119', '136', '866', '803'] as const

const ORGANIZATION_SLUG = 'zebra'
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'

/** Thrown to roll the transaction back on a dry run. Not an error. */
class Rehearsal extends Error {}

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

const heading = (text: string) => {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 70)))
}

async function main(): Promise<void> {
  const where = target()
  const db = createPrismaClient(where.url)
  console.log(`Target: ${where.label}`)
  console.log(
    `Mode:   ${APPLY ? 'APPLY — writes commit' : 'dry run — rolls back'}`,
  )

  const PAYEE = assertDriverKind('PAYEE')

  try {
    const tenancy = await assertTenancy(db, {
      label: where.label,
      host: where.host,
      slug: ORGANIZATION_SLUG,
      expectOrganizationId: where.expectOrganizationId,
    })

    const done: string[] = []
    const skipped: string[] = []

    await db
      .$transaction(
        async (tx) => {
          for (const externalId of PAYEE_EXTERNAL_IDS) {
            // EXACTLY ONE ROW PER ID, OR REFUSE. Two rows sharing a Datatruck
            // id would make "which one" a guess about somebody's pay, and a
            // missing id means the ruling names a row that is not there.
            const hits = await tx.driver.findMany({
              where: {
                organizationId: tenancy.organizationId,
                externalId,
                deletedAt: null,
              },
              select: { id: true, firstName: true, lastName: true, kind: true },
            })
            if (hits.length !== 1) {
              throw new Error(
                `Datatruck id ${externalId} matches ${hits.length} live driver(s): refusing.`,
              )
            }
            const row = hits[0]!
            const name = `${row.firstName} ${row.lastName}`.trim()

            if (isReferralPayee(row)) {
              skipped.push(`${externalId}  ${name} — already ${row.kind}`)
              continue
            }

            await tx.driver.update({
              where: { id: row.id },
              data: { kind: PAYEE },
            })
            done.push(`${externalId}  ${name} — ${row.kind} -> ${PAYEE}`)
          }

          // ── READ BACK, AND ASSERT THE EXCLUSION ACTUALLY TOOK ────────────
          heading('THE ROWS AFTER THE WRITES')
          for (const externalId of PAYEE_EXTERNAL_IDS) {
            const row = await tx.driver.findFirst({
              where: {
                organizationId: tenancy.organizationId,
                externalId,
                deletedAt: null,
              },
              select: {
                firstName: true,
                lastName: true,
                kind: true,
                status: true,
                deletedAt: true,
                _count: { select: { payRules: true } },
              },
            })
            if (!row) {
              console.log(`  ${externalId}: NOT FOUND`)
              continue
            }
            // THE EXCLUSION, NOT THE COLUMN. A column that says PAYEE proves
            // nothing about whether the DQF stopped expecting a file — that is
            // `isQualifiable`, which the roster view and the warnings both ask.
            const qualifiable = isQualifiable(row)
            console.log(
              `  ${externalId}  ${`${row.firstName} ${row.lastName}`.trim()}` +
                `\n      kind=${row.kind}  roster=${row.status}` +
                `  payRules=${row._count.payRules}` +
                `\n      expected to hold a DQF: ${qualifiable ? 'YES — WRONG' : 'no'}`,
            )
            if (qualifiable) {
              throw new Error(
                `${externalId} is still expected to hold a DQF after being marked ${PAYEE}.`,
              )
            }
          }

          if (!APPLY) throw new Rehearsal('dry run')
        },
        { timeout: 60_000 },
      )
      .catch((error: unknown) => {
        if (error instanceof Rehearsal) return
        throw error
      })

    heading(APPLY ? 'WRITTEN' : 'WOULD WRITE — nothing committed')
    for (const line of done) console.log(`  ${line}`)
    if (done.length === 0) console.log('  (nothing — already done)')
    if (skipped.length > 0) {
      heading('ALREADY DONE, SKIPPED')
      for (const line of skipped) console.log(`  ${line}`)
    }
    console.log(
      '\nROSTER STATUS AND PAY RULES UNTOUCHED, by ruling — these rows stay' +
        '\nactive and keep being paid.',
    )
    if (!APPLY) {
      console.log(
        '\nROLLED BACK. The statements above ran and were undone; re-run with --apply.',
      )
    }
  } finally {
    await db.$disconnect()
  }
}

await main()

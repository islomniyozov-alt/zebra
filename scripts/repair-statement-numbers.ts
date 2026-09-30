import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { runInOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import {
  ensureStatementNumber,
  isPlaceholderNumber,
} from '@/lib/settlement-number'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// GIVE EVERY NON-DRAFT STATEMENT A REAL NUMBER.
//
//   npx tsx -r dotenv/config scripts/repair-statement-numbers.ts
//   npx tsx -r dotenv/config scripts/repair-statement-numbers.ts --apply
//
// DEV ONLY. Owner's ruling, 2026-09-30: "a settlement marked PAID must carry
// a number, not a DRAFT- id". The code hole is closed — every path out of
// DRAFT mints now — and this is the row that got through before it was.
//
// Audited first, per status, with `scripts/audit-statement-numbers.ts`:
// dev had ONE (a PAID statement from 2026-08-30), production had none.
//
// ── IT ALLOCATES FROM THE REAL SERIES ─────────────────────────────────────
//
// Through `ensureStatementNumber`, which is the same function the application
// calls, so the repaired row gets the next ST- in the organization's own
// counter rather than a number invented here. The backfill script that
// guessed a series key — `'settlement-batch'` against the real
// `'SETTLEMENT_BATCH'` — is why this does not hand-roll one: that guess would
// have left the real counter at zero and reissued SB-000001.
//
// A DRAFT IS LEFT ALONE. It is supposed to hold a placeholder; 134 of dev's
// 138 do, and numbering them would burn 134 numbers on documents that may
// never exist. The defect is a placeholder on something that is no longer a
// draft, and that is all this touches.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

const APPLY = process.argv.includes('--apply')

class Rehearsal extends Error {}

const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error('No DIRECT_DATABASE_URL.')
if (/prod/i.test(url)) throw new Error('That looks like production. Dev only.')

const db = createPrismaClient(url)
const tenancy = await assertTenancy(db, {
  label: 'DEV',
  host: new URL(url).hostname,
  slug: 'zebra',
  // Null for dev, stated for production — and this script refuses production
  // outright, so there is no production id to state.
  expectOrganizationId: null,
})

console.log('Target: DEV')
console.log(
  `Mode:   ${APPLY ? 'APPLY — writes commit' : 'dry run — rolls back'}\n`,
)

try {
  await runInOrg(
    db,
    tenancy.organizationId,
    async (tx) => {
      // EVERY NON-DRAFT, FILTERED IN CODE BY THE PREDICATE. A `startsWith`
      // in the query would find `DRAFT-` and miss `TMP-1788982650101`, which
      // is exactly the shape an audit turned up and a blocklist would not.
      const candidates = await tx.settlement.findMany({
        where: {
          deletedAt: null,
          status: { not: 'DRAFT' },
        },
        orderBy: [{ periodStart: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          organizationId: true,
          settlementNumber: true,
          status: true,
          periodStart: true,
          netCents: true,
          driver: { select: { firstName: true, lastName: true } },
        },
      })

      const offending = candidates.filter((row) =>
        isPlaceholderNumber(row.settlementNumber),
      )

      console.log(
        `Not a draft: ${candidates.length}. Holding an id: ${offending.length}`,
      )
      for (const settlement of offending) {
        const before = settlement.settlementNumber
        const after = await ensureStatementNumber(tx, settlement)
        // THE READ-BACK IS THE PROOF, not the return value: a function that
        // says it wrote and a row that holds the write are different claims.
        const stored = await tx.settlement.findUniqueOrThrow({
          where: { id: settlement.id },
          select: { settlementNumber: true },
        })
        const ok =
          stored.settlementNumber === after && !isPlaceholderNumber(after)
        console.log(
          `  ${settlement.status.padEnd(9)} ${before}  ->  ${stored.settlementNumber}  ` +
            `${settlement.driver.firstName} ${settlement.driver.lastName}  ` +
            `net ${(settlement.netCents / 100).toFixed(2)}  ${ok ? 'OK' : 'NOT OK'}`,
        )
        if (!ok) throw new Error('Read-back disagreed; refusing to commit.')
      }

      if (!APPLY) throw new Rehearsal()
    },
    {
      timeoutMs: 60_000,
      // NOT A USER, AND THE LOG SAYS SO. There is no session behind a repair
      // script, and `attribution` is required precisely so that a write with
      // nobody behind it has to be declared rather than committed quietly.
      // The reason travels into the audit log with the row.
      attribution: unattributed(
        'scripts/repair-statement-numbers.ts — owner ruling 2026-09-30, ' +
          'a PAID statement must carry a number',
      ),
    },
  )
  console.log('\nCOMMITTED.')
} catch (error) {
  if (!(error instanceof Rehearsal)) throw error
  console.log('\nROLLED BACK — dry run. Re-run with --apply to write.')
}

await db.$disconnect()

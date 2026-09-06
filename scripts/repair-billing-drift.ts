import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import {
  findBillingStatusDrift,
  refreshBillingStatus,
} from '@/lib/billing-status'

// ---------------------------------------------------------------------------
// THE REPAIR FOR A BILLING STATUS THE RULE NO LONGER DERIVES.
//
// WRITTEN AND DELIBERATELY NOT RUN. It exists because the next change to
// `billingStatusFor` will drift the table again and somebody will need this at
// a bad moment; writing it calmly now is cheaper than writing it then. As of
// 2026-09-06 it has never been executed against production, and the two loads
// it was written for — 1015 and 1016 — are being fixed the other way, by
// assigning the driver they should have had, which makes the stored value true
// rather than making it agree.
//
// THAT ORDER MATTERS AND IS NOT A DETAIL. Repairing the column first would
// paper over freight nobody is being paid for: the badge would read Uninvoiced,
// look correct, and the driver would still be missing. Assigning the driver
// fixes the freight AND the status. Reach for this script only when the drift
// is genuinely just a cache — a rule that changed under rows that are otherwise
// right.
//
// IT GOES THROUGH `refreshBillingStatus`, NEVER SQL. That function writes the
// column and a LoadStatusEvent on the billing axis; a raw UPDATE would move a
// money-adjacent status with nothing on the timeline saying it moved, which is
// the failure this codebase keeps flagging.
//
// DRY RUN BY DEFAULT. It prints every row and its from → to and changes
// nothing. `--apply` writes, and the fence lists this among the scripts
// permitted to.
//
//   npx tsx -r dotenv/config scripts/repair-billing-drift.ts             # dry
//   npx tsx -r dotenv/config scripts/repair-billing-drift.ts --apply
// ---------------------------------------------------------------------------

const apply = process.argv.includes('--apply')
const dev = process.env.ZEBRA_TARGET === 'dev'
const connectionString = dev
  ? process.env.DIRECT_DATABASE_URL
  : process.env.PROD_DIRECT_DATABASE_URL

if (!connectionString) {
  console.error('No connection string in the environment. Nothing to do.')
  process.exit(1)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const prisma = createPrismaClient(connectionString)

try {
  const drift = await findBillingStatusDrift(prisma)
  console.log(
    `${dev ? 'DEV' : 'PRODUCTION'}: ${drift.length} load(s) whose stored status the rule no longer derives.`,
  )
  if (drift.length === 0) process.exit(0)

  console.table(
    drift.map((row) => ({
      load: row.loadNumber,
      from: row.stored,
      to: row.computed,
    })),
  )

  if (!apply) {
    console.log('\nDRY RUN. Nothing was written. Re-run with --apply to write.')
    console.log(
      'Before you do: is the DATA right and the rule new, or is the data',
    )
    console.log(
      'wrong? Loads 1015 and 1016 were the second kind — they needed a',
    )
    console.log('driver, not a repaired column.')
    process.exit(0)
  }

  // ONE CALL FOR ALL OF THEM. `refreshBillingStatus` takes the ids together and
  // skips DISPUTED and WRITTEN_OFF on its own — a decision is not arithmetic
  // and must not be recomputed over.
  await refreshBillingStatus(
    prisma,
    drift.map((row) => row.loadId),
  )

  const left = await findBillingStatusDrift(prisma)
  console.log(
    `\nWrote ${drift.length}. Drift remaining: ${left.length}` +
      (left.length === 0
        ? ''
        : ' — these are DISPUTED or WRITTEN_OFF, and stay.'),
  )
} finally {
  await prisma.$disconnect().catch(() => {})
}

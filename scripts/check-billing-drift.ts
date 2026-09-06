import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { findBillingStatusDrift } from '@/lib/billing-status'

// ---------------------------------------------------------------------------
// DOES THE STORED BILLING STATUS STILL AGREE WITH THE RULE THAT DERIVES IT?
//
// `Load.billingStatus` is a cached column, written only when something happens
// to a load — a transition, an invoice, a payment, a rate change. So changing
// `billingStatusFor` leaves every untouched row holding the OLD answer, and
// nothing in the deploy notices. That is a data migration with no migration
// step; the note on `billingStatusFor` says so at the place somebody edits.
//
// IT HAPPENED ON 2026-09-06 AND REACHED PRODUCTION: `isReady` learned to
// require an assigned truck and driver, the live-computed Load Tracker moved
// to Delivered, and the badge reading this column went on saying "Ready to
// invoice" until somebody opened the load and noticed.
//
// SO THE COUNT LIVES BESIDE THE OTHER THING A VERSION ID CANNOT TELL YOU.
// `check:drift` already answers "is the deployed code the code I think it is";
// this answers "does the deployed data still agree with it".
//
// IT USES THE REAL FUNCTION, NOT SQL THAT RESEMBLES IT. A hand-written query
// would be a second derivation of the rule, free to disagree with the first —
// which is the exact failure `billingStatusFor` is pure to avoid. That is why
// this is TypeScript rather than another .mjs beside it.
//
// READ-ONLY. `findBillingStatusDrift` only selects; the repair path is
// `refreshBillingStatus`, run deliberately by the owner, because it writes the
// status event that says the status moved.
// ---------------------------------------------------------------------------

const dev = process.env.ZEBRA_TARGET === 'dev'
const connectionString = dev
  ? process.env.DIRECT_DATABASE_URL
  : process.env.PROD_DIRECT_DATABASE_URL

if (!connectionString) {
  console.log(
    dev
      ? '  billing drift  no DIRECT_DATABASE_URL — not checked'
      : '  billing drift  no PROD_DIRECT_DATABASE_URL — not checked',
  )
  process.exit(0)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const prisma = createPrismaClient(connectionString)

try {
  const drift = await findBillingStatusDrift(prisma)

  if (drift.length === 0) {
    console.log(
      `  billing drift  none — every stored status agrees with billingStatusFor (${dev ? 'dev' : 'production'})`,
    )
  } else {
    console.log('')
    console.log(
      `  BILLING STATUS DRIFT: ${drift.length} load(s) on ${dev ? 'dev' : 'PRODUCTION'} hold a status`,
    )
    console.log('  the rule no longer derives. The column is stale, not wrong')
    console.log('  data — see the note on billingStatusFor.')
    console.table(
      drift.slice(0, 25).map((row) => ({
        load: row.loadNumber,
        stored: row.stored,
        computed: row.computed,
      })),
    )
    console.log(
      '  Repair goes through refreshBillingStatus, never SQL: it writes the',
    )
    console.log('  status event that records the move. Never run unattended.')
  }
} finally {
  await prisma.$disconnect().catch(() => {})
}

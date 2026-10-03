import { neonConfig } from '@neondatabase/serverless'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

// WHAT THE DEDUCTION LINES ACTUALLY SAY, on dev. READ ONLY.
//
// The brief asks for a donut of "standing charges, fuel & tolls, advances,
// other — the categories the statement prints". The statement prints one row
// per LINE with its own `type` label, and the schema stores no category column
// at all, so the four buckets have to be assembled from something. This asks
// the rows which labels exist before anything is designed around a guess.
//
// AGENTS.md: build the instrument from the artefact.

neonConfig.webSocketConstructor ??= WebSocket

const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error('No DIRECT_DATABASE_URL.')

const db = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: url }),
})

console.log(`host  ${new URL(url).hostname.split('.')[0]}\n`)

const byType = await db.$queryRaw<
  { type: string; lines: bigint; cents: bigint; standing: bigint }[]
>`
  SELECT
    dl."type",
    COUNT(*)::bigint AS lines,
    SUM(dl."totalCents")::bigint AS cents,
    COUNT(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM "StandingCharge" sc WHERE sc."id" = dl."recurringDeductionId"
      )
    )::bigint AS standing
  FROM "SettlementDeductionLine" dl
  GROUP BY dl."type"
  ORDER BY SUM(ABS(dl."totalCents")) DESC
`

console.log('EVERY `type` LABEL ON A DEDUCTION LINE, AND HOW MANY CAME FROM A')
console.log('STANDING CHARGE (recurringDeductionId matching StandingCharge):\n')
console.log(
  `  ${'type'.padEnd(22)} ${'lines'.padStart(7)} ${'cents'.padStart(14)} ${'standing'.padStart(9)}`,
)
console.log(
  `  ${'-'.repeat(22)} ${'-'.repeat(7)} ${'-'.repeat(14)} ${'-'.repeat(9)}`,
)
for (const row of byType) {
  console.log(
    `  ${row.type.padEnd(22)} ${String(row.lines).padStart(7)} ${String(row.cents).padStart(14)} ${String(row.standing).padStart(9)}`,
  )
}

// SIGN, because a donut of "deductions" must not quietly include Other Pay.
const signs = await db.$queryRaw<
  { sign: string; lines: bigint; cents: bigint }[]
>`
  SELECT
    CASE WHEN dl."totalCents" < 0 THEN 'deduction' ELSE 'other pay' END AS sign,
    COUNT(*)::bigint AS lines,
    SUM(dl."totalCents")::bigint AS cents
  FROM "SettlementDeductionLine" dl
  GROUP BY 1
`
console.log(
  '\nSIGNED: negative is money off the driver, positive is Other Pay.\n',
)
for (const row of signs) {
  console.log(
    `  ${row.sign.padEnd(12)} ${String(row.lines).padStart(7)} ${String(row.cents).padStart(14)}`,
  )
}

// ADVANCES: is there a line type for them at all, or only the column?
const advances = await db.$queryRaw<
  { settlements: bigint; advances: bigint }[]
>`
  SELECT COUNT(*)::bigint AS settlements,
         SUM(s."advancesCents")::bigint AS advances
  FROM "Settlement" s WHERE s."deletedAt" IS NULL
`
console.log(
  `\nSettlement.advancesCents over every settlement: ${String(advances[0]?.advances)} across ${String(advances[0]?.settlements)} settlements`,
)

// AND WHAT A ONE-OFF CHARGE LOOKS LIKE, since those carry settlementChargeId.
const oneOff = await db.$queryRaw<{ lines: bigint; cents: bigint }[]>`
  SELECT COUNT(*)::bigint AS lines, SUM(dl."totalCents")::bigint AS cents
  FROM "SettlementDeductionLine" dl
  WHERE dl."settlementChargeId" IS NOT NULL
`
console.log(
  `one-off charge lines (settlementChargeId set): ${String(oneOff[0]?.lines)} / ${String(oneOff[0]?.cents)} cents`,
)

const orphan = await db.$queryRaw<{ lines: bigint }[]>`
  SELECT COUNT(*)::bigint AS lines
  FROM "SettlementDeductionLine" dl
  WHERE dl."recurringDeductionId" IS NULL AND dl."settlementChargeId" IS NULL
`
console.log(`lines with neither source id: ${String(orphan[0]?.lines)}`)

await db.$disconnect()
console.log('')

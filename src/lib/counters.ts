import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// NUMBER ALLOCATION (§10)
//
// One statement, one row lock, one number. Never MAX(id) + 1 — that reads a
// value, thinks, and writes, and two dispatchers booking at 6am get the same
// load number. This already bit the Telegram bot's invoice numbering.
//
// `UPDATE ... RETURNING` is atomic because Postgres takes a row lock for the
// duration: the second transaction blocks on the row until the first commits,
// then reads the incremented value. Concurrency is handled by the database, not
// by hoping.
//
// PER COMPANY, not per organization. Each authority bills under its own series
// — RAM Haulage's invoice 1043 and Dolphins Transport's invoice 1043 are
// different invoices, and a broker looking at one has no idea the other exists.
//
// FAILS CLOSED. If allocation cannot produce a number, the caller's operation
// fails. There is no fallback, because every fallback is a guess and a guessed
// invoice number is a collision waiting for month end.
//
// WHAT 100 AT ONCE ACTUALLY DOES, measured. Every allocation runs inside an
// interactive transaction, and every interactive transaction holds one pooled
// connection for its whole life — so a hundred concurrent callers queue behind
// the pool rather than running together. Prisma stops waiting for a connection
// after 2 seconds by default, and the hundredth caller gets
// "Unable to start a transaction in the given time".
//
// That is a refusal, not a duplicate: the series stays contiguous and nothing
// is double-allocated. But it means bulk work has to say so — pass
// `maxWaitMs` — and it is the concrete form of the ceiling in brief §6: the
// shape to reach for is short read, compute, short write, not one long
// transaction per item.
// ---------------------------------------------------------------------------

export const COUNTER_KEYS = [
  'LOAD_NUMBER',
  'INVOICE_NUMBER',
  'SETTLEMENT_NUMBER',
] as const

export type CounterKey = (typeof COUNTER_KEYS)[number]

/** Where a fresh series starts. The first number handed out is this plus one. */
const SERIES_START = 1000

export class CounterAllocationError extends Error {
  constructor(companyId: string, key: CounterKey, cause?: string) {
    super(
      `Could not allocate ${key} for company ${companyId}${cause ? `: ${cause}` : ''}. ` +
        'The calling operation must fail — a guessed number collides.',
    )
    this.name = 'CounterAllocationError'
  }
}

/**
 * Take the next number in a company's series.
 *
 * Must run inside `runInOrg`. Counter is behind row-level security, so a
 * transaction with no tenant set updates nothing and this throws — which is
 * the correct outcome, not an inconvenience.
 *
 * Two statements, and only ever one on the hot path:
 *
 *   1. The increment from §10, verbatim. This is what runs every time after
 *      the first.
 *   2. If and only if that matched no row, create the series and take its
 *      first number in a single `INSERT ... ON CONFLICT DO UPDATE`. Two
 *      requests racing to create the same series both go through it and
 *      Postgres resolves them on the unique index; the loser takes the update
 *      branch and gets the next value rather than an error.
 *
 * Initialising a missing series is not the "guessed number" §10 forbids. The
 * guess it forbids is deriving a number from existing rows. This derives it
 * from a counter, atomically, and the only difference from step 1 is whether
 * the counter existed a millisecond earlier.
 */
export async function allocateNumber(
  tx: TxClient,
  companyId: string,
  key: CounterKey,
): Promise<number> {
  const incremented = await tx.$queryRaw<{ value: number }[]>`
    UPDATE "Counter" SET value = value + 1
      WHERE "companyId" = ${companyId} AND key = ${key}
      RETURNING value
  `

  const existing = incremented[0]?.value
  if (typeof existing === 'number') return existing

  // No series yet. Create it and take its first number atomically. The
  // organizationId comes from the company row so the RLS check on insert has
  // something true to compare against.
  const created = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("id", "organizationId", "companyId", "key", "value", "updatedAt")
    SELECT gen_random_uuid()::text, c."organizationId", c."id", ${key}, ${SERIES_START + 1}, now()
      FROM "Company" c WHERE c."id" = ${companyId}
    ON CONFLICT ("companyId", "key")
      DO UPDATE SET value = "Counter".value + 1, "updatedAt" = now()
    RETURNING value
  `

  const value = created[0]?.value
  if (typeof value !== 'number') {
    // Either the company does not exist, or it belongs to another tenant and
    // row-level security filtered it out of the SELECT. Both are refusals.
    throw new CounterAllocationError(
      companyId,
      key,
      'no such company in this organization',
    )
  }

  return value
}

/**
 * Create a company's series without consuming a number.
 *
 * For provisioning a new authority, so the first real allocation takes the
 * cheap path. Idempotent.
 */
export async function ensureCounters(
  tx: TxClient,
  companyId: string,
  keys: readonly CounterKey[] = COUNTER_KEYS,
): Promise<void> {
  for (const key of keys) {
    await tx.$executeRaw`
      INSERT INTO "Counter" ("id", "organizationId", "companyId", "key", "value", "updatedAt")
      SELECT gen_random_uuid()::text, c."organizationId", c."id", ${key}, ${SERIES_START}, now()
        FROM "Company" c WHERE c."id" = ${companyId}
      ON CONFLICT ("companyId", "key") DO NOTHING
    `
  }
}

/**
 * Reading the series without moving it — for showing "next invoice will be…".
 * Never use this to choose a number.
 */
export async function peekCounter(
  tx: TxClient,
  companyId: string,
  key: CounterKey,
): Promise<number | null> {
  const counter = await tx.counter.findUnique({
    where: { companyId_key: { companyId, key } },
    select: { value: true },
  })
  return counter?.value ?? null
}

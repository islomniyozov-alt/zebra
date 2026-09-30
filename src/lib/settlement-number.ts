import type { Prisma } from '@/generated/prisma/client'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// WHAT A BATCH AND A STATEMENT ARE CALLED, AND WHEN THEY EARN THE NAME.
//
// ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────
//
// It lived in `settlement-batch.ts`, which imports `settlements.ts`. Owner's
// ruling of 2026-09-30 makes `approveSettlement` — in `settlements.ts` — mint
// a statement number, so that file now needs `allocateSeries` too, and
// importing it back would be a cycle.
//
// THE SPLIT IS BY IMPORTER, NOT BY STRING (AGENTS.md). Three files referenced
// these symbols and each was opened and asked what IT takes: the backfill
// script wants `BATCH_SERIES` and `batchNumberOf`, the batch integration test
// wants both formatters, and `settlement-batch.ts` wants all of it. Every one
// of them now imports from here, and none goes through a re-export shim —
// two paths to one symbol is how a module ends up with two homes.
// ---------------------------------------------------------------------------

export const BATCH_SERIES = 'SETTLEMENT_BATCH'
export const STATEMENT_SERIES = 'SETTLEMENT_STATEMENT'

/** Where a fresh series starts. Datatruck's was already in the five thousands. */
const SERIES_START = 0

/**
 * Take the next number in an ORGANIZATION-WIDE series.
 *
 * One run across both carriers — the artefact interleaves SB-000436 (RAM),
 * SB-000437 (Dolphins), SB-000438 (RAM). Behind row-level security, so a
 * transaction with no tenant set updates nothing and this throws, which is the
 * correct outcome rather than an inconvenience.
 */
export async function allocateSeries(
  tx: TxClient,
  organizationId: string,
  key: string,
): Promise<number> {
  const incremented = await tx.$queryRaw<{ value: number }[]>`
    UPDATE "SeriesCounter" SET value = value + 1, "updatedAt" = now()
      WHERE "organizationId" = ${organizationId} AND key = ${key}
      RETURNING value
  `
  const existing = incremented[0]?.value
  if (typeof existing === 'number') return existing

  const created = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "SeriesCounter" ("id", "organizationId", "key", "value", "updatedAt")
    VALUES (gen_random_uuid()::text, ${organizationId}, ${key}, ${SERIES_START + 1}, now())
    ON CONFLICT ("organizationId", "key")
      DO UPDATE SET value = "SeriesCounter".value + 1, "updatedAt" = now()
    RETURNING value
  `
  const value = created[0]?.value
  if (typeof value !== 'number') {
    throw new Error(`Could not allocate ${key}; the operation must fail.`)
  }
  return value
}

export const batchNumberOf = (value: number) =>
  `SB-${String(value).padStart(6, '0')}`
export const statementNumberOf = (value: number) =>
  `ST-${String(value).padStart(6, '0')}`

// ── THE PLACEHOLDER ──────────────────────────────────────────────────────
//
// A settlement is created inside a batch draft before anybody has decided it
// will exist, and a number issued to something that may never exist is a gap
// in a series nobody can explain later. So a draft carries a placeholder built
// from two row ids, and the placeholder is REPLACED — never shown in a heading
// (§8), never allowed to survive into a paid document (§6.2.2).

export const DRAFT_NUMBER_PREFIX = 'DRAFT-'

export const draftNumberFor = (batchId: string, driverId: string) =>
  `${DRAFT_NUMBER_PREFIX}${batchId.slice(-8)}-${driverId.slice(-8)}`

/**
 * The prefixes a statement number is actually ISSUED under.
 *
 * `ST-` is the organization-wide series; `STL-` is the older per-driver path
 * that predates batches and still owns two paid rows on dev.
 */
export const ISSUED_STATEMENT_PREFIXES = ['ST-', 'STL-'] as const

export const isIssuedNumber = (value: string | null | undefined) =>
  typeof value === 'string' &&
  ISSUED_STATEMENT_PREFIXES.some((prefix) => value.startsWith(prefix))

/**
 * Is this an internal id wearing a number's clothes?
 *
 * AN ALLOWLIST, NOT A BLOCKLIST, and that is the whole design of it. The first
 * version tested for `DRAFT-` and was wrong within the hour: auditing dev
 * turned up FOUR drafts numbered `TMP-1788982650101` — an epoch timestamp —
 * and nothing in this repository or its git history produces that prefix. So
 * a blocklist is a list of the placeholder shapes somebody has already met,
 * and this is the third one found by looking rather than by knowing.
 *
 * Failing closed means an unrecognised number is treated as NOT A NAME: it
 * stays out of the heading, and a document leaving DRAFT gets a real one. The
 * cost of being wrong that way is a heading that describes the document; the
 * cost of the other way is a cuid at the top of a page about somebody's pay.
 */
export const isPlaceholderNumber = (value: string | null | undefined) =>
  typeof value === 'string' && !isIssuedNumber(value)

/**
 * Mint a statement number if the settlement is still carrying a placeholder.
 *
 * IDEMPOTENT AND THE ONLY WAY A STATEMENT GETS ITS NAME. Called from every
 * path that takes a settlement out of DRAFT, so the invariant — a document
 * that is not a draft carries an issued number — holds no matter which one
 * somebody used. Returns the number the row ends up with, issued or already
 * held, so a caller never has to re-read to find out.
 */
export async function ensureStatementNumber(
  tx: TxClient,
  settlement: {
    id: string
    organizationId: string
    settlementNumber: string
  },
): Promise<string> {
  if (!isPlaceholderNumber(settlement.settlementNumber)) {
    return settlement.settlementNumber
  }
  const issued = statementNumberOf(
    await allocateSeries(tx, settlement.organizationId, STATEMENT_SERIES),
  )
  await tx.settlement.update({
    where: { id: settlement.id },
    data: { settlementNumber: issued },
  })
  return issued
}

/**
 * What the statement page and the browser tab are called (§8, §6.2.2).
 *
 * THE TEMPLATE IS PASSED IN RATHER THAN GLUED HERE. `{driver}` and `{period}`
 * around an em dash and a middle dot look like punctuation and are in fact
 * word order: the Farsi statement rendered "of $2,450.00 gross 30%" the first
 * time words were assembled next to values in this codebase, and that is the
 * lesson §12 keeps repeating.
 */
export function statementTitle(input: {
  settlementNumber: string
  driverName: string
  periodStart: Date
  periodEnd: Date
  /** Translated, with `{driver}` and `{period}`. */
  draftTemplate: string
}): string {
  if (!isPlaceholderNumber(input.settlementNumber)) {
    return input.settlementNumber
  }
  const day = (value: Date) => value.toISOString().slice(0, 10)
  return input.draftTemplate
    .replace('{driver}', input.driverName)
    .replace('{period}', `${day(input.periodStart)} – ${day(input.periodEnd)}`)
}

import type { Prisma } from '@/generated/prisma/client'
import {
  BEHAVIOURAL_DEDUCTION_TYPES,
  KNOWN_DEDUCTION_TYPES,
} from './deduction-types'
import { refreshDraft } from './settlement-batch'
import { isPlaceholderNumber } from './settlement-number'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// ADD DEDUCTION ON THE BATCH SCREEN (§6.2.10 part 7 step 3, v11.32).
//
// ── A ONE-TIME CHARGE THE ENGINE ALREADY READS, NOT A LINE ON THE DRAFT ──
//
// `batchInputForOrg` reads every unsettled `SettlementCharge` of the batch's
// drivers, `computeDriverSettlement` takes the ones dated inside the period,
// and `finaliseBatch` marks them settled so no later batch takes them again.
// So this writes that row — signed negative, dated the batch's last day — and
// refreshes the draft in the same transaction, so the statement shows it the
// moment the screen reloads. The engine is not touched.
//
// A `SettlementLine` added to the draft by hand would look the same for an
// hour: `refreshDraft` deletes and rebuilds every draft statement, so the
// next Save of the ticks would erase it with no trace. That is why the
// statement page's own "Add charges" is not reused here.
//
// ── PER STATEMENT, REFUSED BY NAME ───────────────────────────────────────
//
// The selection can mix Unposted and Posted statements. A Posted one is a
// document and gains nothing; it is refused by name and the rest proceed,
// the same shape as Post on Driver statements.
// ---------------------------------------------------------------------------

/**
 * The labels Add deduction offers: the known ones, minus the two the engine
 * branches on (`Escrow` has a ledger, `Fuel` comes from the import). A
 * one-time `Escrow` charge would sit beside the escrow rule and be read as
 * neither.
 */
export const BATCH_CHARGE_TYPES = KNOWN_DEDUCTION_TYPES.filter(
  (type) => !(BEHAVIOURAL_DEDUCTION_TYPES as readonly string[]).includes(type),
)

export type BatchChargeFailure =
  | 'not_found'
  | 'not_draft'
  | 'no_statements'
  | 'no_description'
  | 'bad_amount'
  | 'bad_type'

export type BatchChargeStatementRefusal = {
  /** What the reader calls it: the number, else the driver. */
  statement: string
  reason: 'not_unposted' | 'not_on_batch'
}

export type BatchChargeOutcome =
  | { ok: true; added: number; refused: BatchChargeStatementRefusal[] }
  | { ok: false; reason: BatchChargeFailure }

export interface BatchChargeInput {
  batchId: string
  settlementIds: readonly string[]
  type: string
  description: string
  /** What the office typed, POSITIVE: the amount that comes off. */
  amountCents: number
}

/** The checks that need no database, in the order the form is read. */
export function batchChargeInputRefusal(
  input: Pick<
    BatchChargeInput,
    'settlementIds' | 'type' | 'description' | 'amountCents'
  >,
): BatchChargeFailure | null {
  if (input.settlementIds.length === 0) return 'no_statements'
  if (!(BATCH_CHARGE_TYPES as readonly string[]).includes(input.type)) {
    return 'bad_type'
  }
  if (input.description.trim() === '') return 'no_description'
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return 'bad_amount'
  }
  return null
}

export async function addBatchCharge(
  tx: TxClient,
  input: BatchChargeInput,
): Promise<BatchChargeOutcome> {
  const refusal = batchChargeInputRefusal(input)
  if (refusal) return { ok: false, reason: refusal }

  const batch = await tx.settlementBatch.findFirst({
    where: { id: input.batchId, deletedAt: null },
    select: {
      id: true,
      organizationId: true,
      companyId: true,
      status: true,
      periodEnd: true,
    },
  })
  if (!batch) return { ok: false, reason: 'not_found' }
  // A FINAL or PAID batch is a document; the draft refresh would refuse it
  // anyway, and a charge written before that refusal would wait, unsettled,
  // for whatever batch came next.
  if (batch.status !== 'DRAFT' && batch.status !== 'PARTIAL') {
    return { ok: false, reason: 'not_draft' }
  }

  const ids = [...new Set(input.settlementIds)]
  const statements = await tx.settlement.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      batchId: true,
      status: true,
      driverId: true,
      settlementNumber: true,
      driver: { select: { firstName: true, lastName: true } },
    },
  })
  const byId = new Map(statements.map((row) => [row.id, row]))

  const refused: BatchChargeStatementRefusal[] = []
  const drivers = new Set<string>()
  for (const id of ids) {
    const row = byId.get(id)
    if (!row || row.batchId !== batch.id) {
      refused.push({
        statement: row ? nameOf(row) : id.slice(0, 8),
        reason: 'not_on_batch',
      })
      continue
    }
    if (row.status !== 'DRAFT') {
      refused.push({ statement: nameOf(row), reason: 'not_unposted' })
      continue
    }
    drivers.add(row.driverId)
  }

  if (drivers.size > 0) {
    await tx.settlementCharge.createMany({
      data: [...drivers].map((driverId) => ({
        organizationId: batch.organizationId,
        driverId,
        type: input.type,
        description: input.description.trim(),
        // SIGNED: negative is money off the driver (schema).
        amountCents: -input.amountCents,
        // INSIDE THE PERIOD, so the engine takes it on this batch.
        appliesOn: batch.periodEnd,
        // THIS BATCH'S AUTHORITY AND THE BATCH ITSELF (MONEY-DESIGN §4,
        // 2026-11-18): only a batch of the same authority takes it
        // (`chargeScopeWhere`), so the driver's statement in another
        // authority's overlapping batch is not charged too.
        companyId: batch.companyId,
        batchId: batch.id,
      })),
    })
    await refreshDraft(tx, batch.id)
  }

  return { ok: true, added: drivers.size, refused }
}

export type StatementChargeFailure =
  | BatchChargeFailure
  /** A statement with no batch keeps the add-row; nothing rebuilds it. */
  | 'no_batch'
  | 'not_unposted'

/**
 * ADD DEDUCTION ON THE STATEMENT PAGE (TMS §6.2.10 part 7 step 4): step 3's
 * verb for ONE statement. The statement's own batch is read here — the form
 * names only the statement — and the charge carries that batch's authority,
 * so the guard of 2026-11-18 holds on this page too.
 */
export async function addStatementCharge(
  tx: TxClient,
  input: Omit<BatchChargeInput, 'batchId' | 'settlementIds'> & {
    settlementId: string
  },
): Promise<
  | {
      ok: true
      /**
       * The statement as rebuilt. `refreshDraft` deletes and recreates every
       * draft on the batch, so the id the office opened no longer exists;
       * this is the same driver's draft on the same batch, to land on.
       */
      settlementId: string | null
    }
  | { ok: false; reason: StatementChargeFailure }
> {
  const statement = await tx.settlement.findFirst({
    where: { id: input.settlementId, deletedAt: null },
    select: { batchId: true, driverId: true },
  })
  if (!statement) return { ok: false, reason: 'not_found' }
  if (statement.batchId === null) return { ok: false, reason: 'no_batch' }
  const outcome = await addBatchCharge(tx, {
    batchId: statement.batchId,
    settlementIds: [input.settlementId],
    type: input.type,
    description: input.description,
    amountCents: input.amountCents,
  })
  if (!outcome.ok) return outcome
  if (outcome.added === 0) return { ok: false, reason: 'not_unposted' }
  const rebuilt = await tx.settlement.findFirst({
    where: {
      batchId: statement.batchId,
      driverId: statement.driverId,
      status: 'DRAFT',
      deletedAt: null,
    },
    select: { id: true },
  })
  return { ok: true, settlementId: rebuilt?.id ?? null }
}

function nameOf(row: {
  settlementNumber: string
  driver: { firstName: string; lastName: string }
}): string {
  return isPlaceholderNumber(row.settlementNumber)
    ? `${row.driver.firstName} ${row.driver.lastName}`
    : row.settlementNumber
}

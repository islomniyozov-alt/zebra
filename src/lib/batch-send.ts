import type { Prisma } from '@/generated/prisma/client'
import type { MessageKey } from './i18n'
import { isPlaceholderNumber } from './settlement-number'
import {
  sendStatementToDriver,
  type StatementSendFailure,
  type StatementSendLabels,
} from './statement-send'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// SEND (SELECTED) ON THE BATCH SCREEN (§6.2.10 part 7 step 3, R13).
//
// POSTED ONLY, AND NOT BY A NEW RULE: `sendStatementToDriver` already refuses a
// draft (`not_final`) and a void (`voided`), and the dev guard, the missing
// address and the transport's four failures, each by name. This wraps it for
// one statement on one batch — the statement must be on THIS batch, and the
// refusal carries the statement's name — and the action loops it, one
// transaction per statement, as Post does on Driver statements: four sent and
// a fifth refused are five real outcomes.
// ---------------------------------------------------------------------------

export type BatchSendFailure = StatementSendFailure | 'not_on_batch'

export interface BatchSendOutcome {
  /** What the reader calls it: the number, else the driver. */
  statement: string
  refusal: BatchSendFailure | null
}

/** Every refusal, as the statement page already words it. */
export const BATCH_SEND_REASON: Record<BatchSendFailure, MessageKey> = {
  not_found: 'settlements.error.notFound',
  not_on_batch: 'settlements.error.notFound',
  not_final: 'settlements.error.notFinal',
  voided: 'settlements.error.voided',
  no_email: 'settlements.error.noEmail',
  not_production: 'settlements.error.notProduction',
  not_configured: 'settlements.error.mailNotConfigured',
  rejected: 'settlements.error.mailRejected',
  unreachable: 'settlements.error.mailUnreachable',
  misconfigured: 'settlements.error.mailMisconfigured',
}

export async function sendBatchStatement(
  tx: TxClient,
  input: { batchId: string; settlementId: string },
  options: { origin: string; locale: string; labels: StatementSendLabels },
): Promise<BatchSendOutcome> {
  const row = await tx.settlement.findFirst({
    where: { id: input.settlementId, deletedAt: null },
    select: {
      batchId: true,
      settlementNumber: true,
      driver: { select: { firstName: true, lastName: true } },
    },
  })
  if (!row) {
    return { statement: input.settlementId.slice(0, 8), refusal: 'not_found' }
  }
  const statement = isPlaceholderNumber(row.settlementNumber)
    ? `${row.driver.firstName} ${row.driver.lastName}`
    : row.settlementNumber
  if (row.batchId !== input.batchId) {
    return { statement, refusal: 'not_on_batch' }
  }
  const sent = await sendStatementToDriver(tx, input.settlementId, options)
  return { statement, refusal: sent.ok ? null : sent.reason }
}

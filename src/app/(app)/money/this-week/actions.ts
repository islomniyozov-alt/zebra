'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  markBatchPaid,
  openBatch,
  SETTLEMENT_BATCH_TIMEOUT_MS,
} from '@/lib/settlement-batch'
import { payWeekFor } from '@/lib/settlement-week'

// MONEY → THIS WEEK — the only two writes on the page, and neither is new.
//
// `openBatch` and `markBatchPaid` are item 3's own functions, called with the
// period this screen is about. Nothing here decides anything about money: the
// period comes from `payWeekFor`, the create comes from `openBatch`, and the
// transition comes from `markBatchPaid`.

export interface MoneyWeekState {
  error: string | null
}

/**
 * Open a batch for the period that is due, prefilled.
 *
 * THE CHECK DATE IS NO LONGER PASSED. `openBatch` derives it from the period
 * (§0 as amended 2026-09-28), so this action cannot offer a wrong one and no
 * longer offers a right one either. The statement date is still an input and is
 * still prefilled with today, which the batch screen can change.
 *
 * `payWeekFor` IS CALLED HERE RATHER THAN PASSED IN. A period arriving from the
 * browser is a period a stale tab can be wrong about, and opening a batch for
 * last fortnight's freight because somebody left the page open over the weekend
 * is exactly the kind of quiet error this screen exists to prevent.
 */
export async function openBatchForWeekAction(
  _previous: MoneyWeekState,
): Promise<MoneyWeekState> {
  const { t } = await getLocaleContext()
  const { period } = payWeekFor(new Date())

  const outcome = await withCurrentOrg(
    'create',
    'settlement',
    (tx, session) =>
      openBatch(tx, {
        organizationId: session.organizationId,
        period,
        // Today, per the brief. The batch screen can change it.
        statementDate: new Date(
          Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate(),
          ),
        ),
      }),
    { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
  )

  if (!outcome.ok) {
    // A BATCH ALREADY COVERS THIS WEEK, which is the ruling's one-per-period
    // rule refusing rather than the database colliding. Says so, and says
    // which — the screen's Continue draft link goes to the same place.
    return {
      error:
        outcome.reason.kind === 'period_taken'
          ? t('money.error.periodTaken')
          : t('money.error.couldNotOpen'),
    }
  }

  revalidatePath('/money/this-week')
  redirect(`/settlements/batches/${outcome.batchId}`)
}

export async function markWeekPaidAction(
  batchId: string,
  _previous: MoneyWeekState,
): Promise<MoneyWeekState> {
  const { t } = await getLocaleContext()
  const outcome = await withCurrentOrg('update', 'settlement', (tx, session) =>
    markBatchPaid(tx, batchId, session.userId),
  )
  revalidatePath('/money/this-week')
  return outcome.ok ? { error: null } : { error: t('money.error.couldNotPay') }
}

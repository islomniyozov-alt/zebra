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
 * THE PREFILL IS A DEFAULT, NOT A DERIVATION, and §0's rule survives it: the
 * statement date and the check date land on the batch screen as editable
 * fields. What this removes is the retyping, not the decision — somebody who
 * cut cheques on Thursday that week changes the date and the batch obeys.
 *
 * `payWeekFor` IS CALLED HERE RATHER THAN PASSED IN. A period arriving from the
 * browser is a period a stale tab can be wrong about, and opening a batch for
 * last fortnight's freight because somebody left the page open over the weekend
 * is exactly the kind of quiet error this screen exists to prevent.
 */
export async function openBatchForWeekAction(
  companyId: string,
  _previous: MoneyWeekState,
): Promise<MoneyWeekState> {
  const { t } = await getLocaleContext()
  const { period, payDay } = payWeekFor(new Date())

  const outcome = await withCurrentOrg(
    'create',
    'settlement',
    (tx, session) =>
      openBatch(tx, {
        organizationId: session.organizationId,
        companyId,
        period,
        // Today, per the brief. The batch screen can change it.
        statementDate: new Date(
          Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate(),
          ),
        ),
        // Period end + 13 — the Friday the money actually moves (§0).
        checkDate: payDay,
      }),
    { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
  )

  if (!outcome.ok) return { error: t('money.error.couldNotOpen') }

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

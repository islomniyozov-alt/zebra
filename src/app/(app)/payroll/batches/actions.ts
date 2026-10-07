'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { openBatch, SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import { weekFromParam } from '@/lib/payroll'
import type { PayrollFormState } from './state'

// ACCOUNTING → PAYROLL, the one write this page adds.
//
// Refresh, Finalise and Mark paid already exist as actions on the batch screen
// and are reused unchanged; the only thing Payroll needed that nothing had was
// OPEN A BATCH FOR THE WEEK BEING LOOKED AT. `/money/this-week` could open one
// week — the one that was due — because its period came from `payWeekFor` and
// nothing could ask it for another.
//
// READS THE FORM, CALLS ONE FUNCTION, REVALIDATES. `openBatch` decides
// everything: whether the period is a week, whether one is already open, and the
// check date (which it derives — §0 as amended 2026-09-28, so there is nothing
// here to pass wrong).

export async function openWeekAction(
  _previous: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const { t } = await getLocaleContext()
  const week = weekFromParam(String(formData.get('week') ?? ''))

  // THE WEEK COMES FROM THE FORM AND IS RE-VALIDATED HERE. It arrived in a URL,
  // so it is as trustworthy as anything else a browser sends — `weekFromParam`
  // snaps it to its Sunday and refuses anything that is not a settlement week,
  // and `openBatch` refuses again on its own account.
  if (week === null) return { error: t('batch.error.notAWeek') }

  // ── THE AUTHORITY, AND THE TRIPS THE OFFICE DECLINED (§6.2.10) ─────────
  //
  // `shown` carries every trip the grid rendered and `trip` carries the ticked
  // ones, so the difference IS the exclusion set — computed here rather than by
  // re-reading the window, because a trip delivered between the render and this
  // click is absent from `shown` and must therefore join the batch rather than
  // look unticked. That is the monotonicity the exclusion design is for.
  const companyId = String(formData.get('companyId') ?? '').trim()
  const shown = formData.getAll('shown').map(String)
  const ticked = new Set(formData.getAll('trip').map(String))
  const excludeLoadIds = shown.filter((loadId) => !ticked.has(loadId))

  const outcome = await withCurrentOrg(
    'create',
    'settlement',
    (tx, session) =>
      openBatch(tx, {
        organizationId: session.organizationId,
        // EMPTY MEANS THE WHOLE ORGANIZATION, which is the default and Islom's
        // 2026-09-11 ruling. A named authority is Datatruck's shape.
        companyId: companyId === '' ? null : companyId,
        excludeLoadIds,
        excludedByUserId: session.userId,
        period: week,
        // Today. §0 keeps the statement date an input, and this is the default
        // the batch screen can change — it is when the paperwork was cut.
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
    // `period_taken` is not a collision to report — it is the one-per-period
    // rule refusing, and the batch it hands back is the batch for this week.
    // OPEN A BATCH LANDS ON THE BATCH (§6.2.10 part 2b): the one just opened,
    // or the one already covering the week.
    if (outcome.reason.kind === 'period_taken') {
      revalidatePath('/accounting/payroll')
      redirect(`/settlements/batches/${outcome.reason.batchId}`)
    }
    return { error: t('batch.error.notAWeek') }
  }

  revalidatePath('/accounting/payroll')
  revalidatePath('/payroll/batches')
  redirect(`/settlements/batches/${outcome.batchId}`)
}

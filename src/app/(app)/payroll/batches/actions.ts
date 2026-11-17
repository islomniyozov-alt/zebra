'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { openBatch, SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import { dayFromParam } from '@/lib/settlement-week'
import type { MessageKey } from '@/lib/i18n'
import type { PayrollFormState } from './state'

// PAYROLL → BATCHES → CREATE BATCH (§6.2.10 part 1; part 7 step 2, owner's
// rulings 2026-11-17).
//
// READS THE FORM, CALLS ONE FUNCTION, REVALIDATES. `openBatch` decides
// everything: whether the period is a period, whether a batch for an
// overlapping scope already touches it, and the check date (which it derives —
// §0 as amended 2026-09-28, so there is nothing here to pass wrong).
//
// ── A FREE RANGE, AND AN AUTHORITY (part 7, R1 and R2) ───────────────────
//
// From and To arrive as the office typed them, through the same parser the
// screen read them with. The authority is required for a new batch: an empty
// one is refused here by name, before a transaction opens, because the screen
// already withholds the button and anything arriving without one did not come
// from it.

const REFUSAL: Partial<Record<string, MessageKey>> = {
  bad_range: 'batch.error.badRange',
  not_a_week: 'batch.error.badRange',
}

export async function openBatchAction(
  _previous: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const { t } = await getLocaleContext()
  const start = dayFromParam(formData.get('from'))
  const end = dayFromParam(formData.get('to'))
  if (start === null || end === null) {
    return { error: t('batch.error.badRange') }
  }

  const companyId = String(formData.get('companyId') ?? '').trim()
  if (companyId === '') return { error: t('batch.error.noAuthority') }

  // ── THE TRIPS THE OFFICE DECLINED (§6.2.10 part 2) ─────────────────────
  //
  // `shown` carries every trip the grid rendered and `trip` carries the ticked
  // ones, so the difference IS the exclusion set — computed here rather than by
  // re-reading the window, because a trip delivered between the render and this
  // click is absent from `shown` and must therefore join the batch rather than
  // look unticked. That is the monotonicity the exclusion design is for.
  const shown = formData.getAll('shown').map(String)
  const ticked = new Set(formData.getAll('trip').map(String))
  const excludeLoadIds = shown.filter((loadId) => !ticked.has(loadId))

  const outcome = await withCurrentOrg(
    'create',
    'settlement',
    (tx, session) =>
      openBatch(tx, {
        organizationId: session.organizationId,
        companyId,
        excludeLoadIds,
        excludedByUserId: session.userId,
        period: { start, end },
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
    // AN OVERLAPPING BATCH IS HANDED BACK, AND CREATE LANDS ON IT (§6.2.10
    // part 2b): the screen already named it above the grid and withheld the
    // button, so arriving here means it was opened in the meantime.
    if (outcome.reason.kind === 'period_taken') {
      revalidatePath('/payroll/batches')
      redirect(`/settlements/batches/${outcome.reason.batchId}`)
    }
    return {
      error: t(REFUSAL[outcome.reason.kind] ?? 'batch.error.badRange'),
    }
  }

  revalidatePath('/payroll/batches')
  redirect(`/settlements/batches/${outcome.batchId}`)
}

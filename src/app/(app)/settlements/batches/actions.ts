'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  finaliseBatch,
  markBatchPaid,
  openBatch,
  refreshDraft,
  SETTLEMENT_BATCH_TIMEOUT_MS,
  type BatchRefusal,
} from '@/lib/settlement-batch'
import { isSettlementWeek, weekOf } from '@/lib/settlement-week'
import { setExclusions } from '@/lib/batch-exclusions'
import type { MessageKey } from '@/lib/i18n'

// MONEY-DESIGN item 3 — the batch screen's writes.
//
// Every rule is in `settlement-batch.ts` and `settlement-week.ts`. What is here
// is the permission gate, the form read, and the revalidate. See AGENTS.md:
// an action body runs behind `withCurrentOrg`, so a rule placed in one ships on
// a reading rather than on a test.

export interface BatchState {
  error: string | null
  /** Blockers, already named, when FINAL was refused for them. */
  blocked: string[]
}

// NOT EXPORTED. A 'use server' file may only export async functions — the
// custom lint rule beside this one says what happens otherwise: it compiles,
// it typechecks, and it fails at runtime as a 500 with no message. Each client
// component declares its own initial state.

const REFUSAL: Record<BatchRefusal['kind'], MessageKey> = {
  not_a_week: 'batch.error.notAWeek',
  not_found: 'batch.error.notFound',
  not_draft: 'batch.error.notDraft',
  blocked: 'batch.error.blocked',
  period_taken: 'money.error.periodTaken',
}

/**
 * Create a batch for one company and one week.
 *
 * THE TWO DATES ARE TYPED. MONEY-DESIGN says so twice, and the artefact is why
 * it is worth saying: on all six statements the check date is the statement
 * date plus two, and deriving it from that would be turning a coincidence into
 * a rule about when somebody's cheque is cut.
 */
export async function createBatchAction(
  _previous: BatchState,
  formData: FormData,
): Promise<BatchState> {
  const { t } = await getLocaleContext()
  const companyId = String(formData.get('companyId') ?? '')
  const day = String(formData.get('periodStart') ?? '')
  const statementDate = String(formData.get('statementDate') ?? '')
  // NO `checkDate` READ. `openBatch` derives it from the period, so a posted
  // field would be ignored — and a field that is read and ignored is worse than
  // one that is never read, because the form looks like it still decides.
  // §0 as amended 2026-09-28.

  if (!companyId || !day || !statementDate) {
    return { error: t('batch.error.incomplete'), blocked: [] }
  }

  // ANY DAY IN THE WEEK IS ACCEPTED and snapped to its Sunday. A person
  // choosing "the week of the 19th" should not have to know which day that
  // week began on, and a typed Monday would otherwise create a period that
  // settles the same loads under a different name.
  const period = weekOf(new Date(`${day}T00:00:00.000Z`))
  if (!isSettlementWeek(period)) {
    return { error: t('batch.error.notAWeek'), blocked: [] }
  }

  // THE SAME `openBatch` THE MONEY SCREEN CALLS. Two entry points, one create
  // — a second would be a second place for the period to be got wrong.
  const created = await withCurrentOrg(
    'create',
    'settlement',
    (tx, session) =>
      openBatch(tx, {
        organizationId: session.organizationId,
        period,
        statementDate: new Date(`${statementDate}T00:00:00.000Z`),
      }),
    { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
  )

  if (!created.ok) {
    return { error: t(REFUSAL[created.reason.kind]), blocked: [] }
  }

  revalidatePath('/settlements/batches')
  redirect(`/settlements/batches/${created.batchId}`)
}

/**
 * The batch screen's Save (§6.2.10 part 2b). `shown` is every trip the grid
 * offered and `trip` the ones left ticked; `setExclusions` writes the delta
 * through the two exclusion verbs and refreshes the draft. Reads the form,
 * calls one function, revalidates.
 */
export async function saveTicksAction(
  batchId: string,
  _previous: BatchState,
  formData: FormData,
): Promise<BatchState> {
  const { t } = await getLocaleContext()
  const shownLoadIds = formData.getAll('shown').map(String)
  const tickedLoadIds = formData.getAll('trip').map(String)

  const outcome = await withCurrentOrg(
    'update',
    'settlement',
    (tx, session) =>
      setExclusions(tx, {
        batchId,
        shownLoadIds,
        tickedLoadIds,
        byUserId: session.userId,
      }),
    { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
  )

  revalidatePath(`/settlements/batches/${batchId}`)
  revalidatePath('/payroll/batches')
  if (outcome.ok) return { error: null, blocked: [] }
  return {
    error: t(
      outcome.reason.kind === 'not_draft'
        ? 'batch.error.notDraft'
        : outcome.reason.kind === 'not_found'
          ? 'batch.error.notFound'
          : 'batch.error.incomplete',
    ),
    blocked: [],
  }
}

export async function refreshBatchAction(
  batchId: string,
  _previous: BatchState,
): Promise<BatchState> {
  const { t } = await getLocaleContext()
  const outcome = await withCurrentOrg('update', 'settlement', (tx) =>
    refreshDraft(tx, batchId),
  )
  revalidatePath(`/settlements/batches/${batchId}`)
  return outcome.ok
    ? { error: null, blocked: [] }
    : { error: t(REFUSAL[outcome.reason.kind]), blocked: [] }
}

/**
 * DRAFT -> FINAL.
 *
 * A BLOCKED BATCH IS REFUSED WITH THE NAMES. "Cannot finalise" sends somebody
 * to compare a list of drivers against a list of pay rules by hand; this says
 * which driver and what is missing.
 */
export async function finaliseBatchAction(
  batchId: string,
  _previous: BatchState,
): Promise<BatchState> {
  const { t } = await getLocaleContext()
  const outcome = await withCurrentOrg(
    'update',
    'settlement',
    (tx, session) => finaliseBatch(tx, batchId, session.userId),
    { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
  )

  if (!outcome.ok) {
    const blocked =
      outcome.reason.kind === 'blocked'
        ? outcome.reason.blockers.map(
            (row) =>
              `${row.driverName}: ${
                row.blocker.kind === 'no_pay_rule'
                  ? t('batch.blocker.noPayRule')
                  : t('batch.blocker.ruleUnusable')
              }`,
          )
        : []
    return { error: t(REFUSAL[outcome.reason.kind]), blocked }
  }

  revalidatePath(`/settlements/batches/${batchId}`)
  revalidatePath('/settlements/batches')
  return { error: null, blocked: [] }
}

/** FINAL -> PAID. A person saw the money leave. */
export async function markBatchPaidAction(
  batchId: string,
  _previous: BatchState,
): Promise<BatchState> {
  const { t } = await getLocaleContext()
  const outcome = await withCurrentOrg('update', 'settlement', (tx, session) =>
    markBatchPaid(tx, batchId, session.userId),
  )
  revalidatePath(`/settlements/batches/${batchId}`)
  return outcome.ok
    ? { error: null, blocked: [] }
    : { error: t(REFUSAL[outcome.reason.kind]), blocked: [] }
}

/**
 * Dispatch confirms what a held load actually settles on (§3).
 *
 * THE ONLY WAY A HELD LINE EVER SETTLES. Until this is set, a short or over
 * remittance keeps its load out of every batch, and the draft names it.
 */
export async function confirmSettledGrossAction(
  loadId: string,
  _previous: BatchState,
  formData: FormData,
): Promise<BatchState> {
  const { t } = await getLocaleContext()
  const raw = String(formData.get('settledGrossCents') ?? '')
  const cents = Number.parseInt(raw, 10)
  if (!Number.isFinite(cents) || cents < 0) {
    return { error: t('batch.error.badGross'), blocked: [] }
  }

  await withCurrentOrg('update', 'load.financials', (tx, session) =>
    tx.load.update({
      where: { id: loadId },
      data: {
        settledGrossCents: cents,
        settledGrossConfirmedAt: new Date(),
        settledGrossConfirmedById: session.userId,
      },
    }),
  )

  revalidatePath('/settlements/batches')
  return { error: null, blocked: [] }
}

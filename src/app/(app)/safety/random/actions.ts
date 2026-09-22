'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { drawQuarter, resolveSelection } from '@/lib/random-testing'
import type { PoolSource, SelectionOutcome } from '@/lib/random-testing'
import { toFormState } from '../../_reference/shared'
import type { RecordFormState } from '@/components/forms/RecordForm'

// ITEM 15 — THREE ACTIONS, EACH ONE LINE OF DOMAIN.
//
// Everything §382.305 has to say lives in `src/lib/random-testing.ts`, where
// it is tested without an auth context. AGENTS.md: an action reads the form,
// calls one function and revalidates.

const PATH = '/safety/random'

export async function recordRateAction(
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()

  try {
    await withCurrentOrg('create', 'randomTesting', async (tx, session) => {
      // THE CITATION IS REQUIRED BY THE COLUMN, not by this function. A rate
      // with no notice behind it is a number somebody remembered, and the
      // database is where that is settled.
      await tx.randomTestingRate.create({
        data: {
          organizationId: session.organizationId,
          year: Number(formData.get('year')),
          drugRateBps: Math.round(
            Number(formData.get('drugRatePercent')) * 100,
          ),
          alcoholRateBps: Math.round(
            Number(formData.get('alcoholRatePercent')) * 100,
          ),
          citation: String(formData.get('citation') ?? '').trim(),
        },
      })
    })
  } catch (error) {
    return toFormState(error, t)
  }

  revalidatePath(PATH)
  return { error: null, field: null }
}

export async function drawQuarterAction(
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()

  try {
    await withCurrentOrg('create', 'randomTesting', (tx, session) =>
      drawQuarter(
        tx,
        session.organizationId,
        {
          companyId: String(formData.get('companyId') ?? ''),
          year: Number(formData.get('year')),
          quarter: Number(formData.get('quarter')),
          source: String(formData.get('source') ?? 'DERIVED') as PoolSource,
          // THE SEED IS SUPPLIED AND RECORDED. A seed the system invented and
          // threw away is a seed nobody can check the draw against — which is
          // the entire thing an auditor is asking about.
          seed: String(formData.get('seed') ?? '').trim(),
        },
        { byUserId: session.userId },
      ),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  revalidatePath(PATH)
  return { error: null, field: null }
}

export async function resolveSelectionAction(
  id: string,
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()

  try {
    await withCurrentOrg('update', 'randomTesting', (tx) =>
      resolveSelection(tx, id, {
        outcome: String(formData.get('outcome') ?? '') as SelectionOutcome,
        reason: formData.get('reason'),
        testedAt: formData.get('testedAt'),
      }),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  revalidatePath(PATH)
  return { error: null, field: null }
}

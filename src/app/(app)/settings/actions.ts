'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { savePayrollCutover } from '@/lib/payroll-cutover'
import type { CutoverFormState } from './cutover-state'

// SETTINGS → PAYROLL CUTOVER (MONEY-DESIGN §6, owner's ruling 2026-11-17).
//
// Reads the form, calls one function, revalidates. `organization:update` —
// OWNER and ADMIN — as every other setting on this screen. The audit extension
// writes the change as one row with its from and to; nothing here audits by
// hand.
export async function savePayrollCutoverAction(
  _previous: CutoverFormState,
  formData: FormData,
): Promise<CutoverFormState> {
  const { t } = await getLocaleContext()
  const result = await withCurrentOrg('update', 'organization', (tx, session) =>
    savePayrollCutover(tx, session.organizationId, formData.get('cutover')),
  )
  if (!result.ok) return { error: t('settings.error.badCutover'), saved: false }
  revalidatePath('/settings')
  revalidatePath('/payroll/batches/new')
  return { error: null, saved: true }
}

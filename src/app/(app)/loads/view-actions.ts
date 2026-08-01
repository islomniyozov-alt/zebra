'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  deleteView,
  parseDensity,
  saveView,
  writePreference,
  PREFERENCE_KEYS,
} from '@/lib/preferences'
import { VIEW_INITIAL, type ViewState } from './view-state'

// Saved views (§7.4). Per user, in the database, for the reason recorded on
// src/lib/preferences.ts — a bookmark that only exists on one machine is a
// bookmark the dispatcher stops trusting.

export async function saveViewAction(
  _previous: ViewState,
  formData: FormData,
): Promise<ViewState> {
  const { t } = await getLocaleContext()
  const name = String(formData.get('name') ?? '')
  // The CURRENT query string, sent by the client. It is re-parsed server-side
  // before storage, so what lands is a query this application can read back.
  const query = String(formData.get('query') ?? '')

  const outcome = await withCurrentOrg('read', 'load', (tx, session) =>
    saveView(tx, session.organizationId, session.userId, name, query),
  )

  if (!outcome.ok) {
    return {
      error:
        outcome.reason === 'too_many'
          ? t('views.tooMany')
          : t('ref.error.required'),
    }
  }

  revalidatePath('/loads')
  return VIEW_INITIAL
}

/**
 * §5.1 row density, per user, on the same store as saved views.
 *
 * Not a cookie and not localStorage, for the reason on src/lib/preferences.ts:
 * a dispatcher who sets Compact on the office machine means Compact, not
 * Compact-here. `revalidatePath('/', 'layout')` because the attribute lives on
 * the app shell — revalidating the page alone would leave the change invisible
 * until the next navigation, which reads as "the control does nothing".
 */
export async function setDensityAction(formData: FormData): Promise<void> {
  const density = parseDensity(formData.get('density'))

  await withCurrentOrg('read', 'load', (tx, session) =>
    writePreference(
      tx,
      session.organizationId,
      session.userId,
      PREFERENCE_KEYS.density,
      density,
    ),
  )

  revalidatePath('/', 'layout')
}

export async function deleteViewAction(slug: string): Promise<void> {
  await withCurrentOrg('read', 'load', (tx, session) =>
    deleteView(tx, session.organizationId, session.userId, slug),
  )
  revalidatePath('/loads')
}

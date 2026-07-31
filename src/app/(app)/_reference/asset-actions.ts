'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  restoreAsset,
  retireAsset,
  transferAsset,
  type FleetKind,
} from '@/lib/fleet'
import { optionalText } from '@/lib/reference'
import { toFormState } from './shared'
import type { RecordFormState } from '@/components/forms/RecordForm'

// Retire, restore and transfer, for all three fleet kinds.
//
// One file rather than three, because the rules are identical and the only
// thing that differs is which column the id lands in. `withCurrentOrg` carries
// the permission check and the audit attribution, so the transfer that moves a
// truck between authorities is recorded with the name of whoever moved it —
// which is the entire reason AssetAssignment exists.

const PATHS: Record<FleetKind, string> = {
  truck: '/trucks',
  trailer: '/trailers',
  driver: '/drivers',
}

export async function transferAssetAction(
  kind: FleetKind,
  id: string,
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()
  const toCompanyId = String(formData.get('toCompanyId') ?? '')
  const reason = optionalText(formData.get('reason'))

  try {
    await withCurrentOrg('update', kind, (tx, session) =>
      transferAsset(tx, session.organizationId, kind, id, toCompanyId, {
        reason,
        byUserId: session.userId,
      }),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  revalidatePath(PATHS[kind])
  revalidatePath(`${PATHS[kind]}/${id}`)
  return { error: null, field: null }
}

export async function retireAssetAction(
  kind: FleetKind,
  id: string,
): Promise<void> {
  await withCurrentOrg('delete', kind, (tx) => retireAsset(tx, kind, id))
  revalidatePath(PATHS[kind])
  revalidatePath(`${PATHS[kind]}/${id}`)
}

export async function restoreAssetAction(
  kind: FleetKind,
  id: string,
): Promise<void> {
  await withCurrentOrg('update', kind, (tx, session) =>
    restoreAsset(tx, kind, id, session.organizationId),
  )
  revalidatePath(PATHS[kind])
  revalidatePath(`${PATHS[kind]}/${id}`)
}

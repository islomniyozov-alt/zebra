'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { updateTrailer } from '@/lib/fleet'
import type { NewAssetState } from '@/lib/new-asset'
import { toFormState } from '../_reference/shared'
import { saveNewAsset } from '../_reference/new-asset-action'
import type { RecordFormState } from '@/components/forms/RecordForm'
import type { OwnershipType, TruckStatus } from '@/generated/prisma/client'

function read(formData: FormData) {
  return {
    companyId: String(formData.get('companyId') ?? ''),
    unitNumber: String(formData.get('unitNumber') ?? ''),
    vin: formData.get('vin'),
    type: formData.get('type'),
    year: formData.get('year'),
    plate: formData.get('plate'),
    plateState: formData.get('plateState'),
    status: (formData.get('status') || undefined) as TruckStatus | undefined,
    ownershipType: (formData.get('ownershipType') || undefined) as
      | OwnershipType
      | undefined,
    notes: formData.get('notes'),
  }
}

/** The short form's Save, as the truck's (§6.5 parts 3 and 4). */
export async function createTrailerAction(
  _previous: NewAssetState,
  formData: FormData,
): Promise<NewAssetState> {
  const { t } = await getLocaleContext()
  const outcome = await saveNewAsset('trailer', read(formData), formData, t)
  if (!outcome.done) return outcome.state
  if (outcome.registrationId) {
    return { error: null, field: null, created: outcome }
  }
  // §6.5 part 3: Save opens the record.
  redirect(`/trailers/${outcome.id}`)
}

export async function updateTrailerAction(
  id: string,
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()

  try {
    await withCurrentOrg('update', 'trailer', (tx) =>
      updateTrailer(tx, id, read(formData)),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  revalidatePath('/trailers')
  redirect('/trailers')
}

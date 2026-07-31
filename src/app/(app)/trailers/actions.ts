'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { createTrailer, updateTrailer } from '@/lib/fleet'
import { rememberAuthority, toFormState } from '../_reference/shared'
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

export async function createTrailerAction(
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()
  const input = read(formData)

  try {
    await withCurrentOrg('create', 'trailer', (tx, session) =>
      createTrailer(tx, session.organizationId, input, {
        byUserId: session.userId,
      }),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  await rememberAuthority(input.companyId)
  revalidatePath('/trailers')
  redirect('/trailers')
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

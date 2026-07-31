'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { createTruck, updateTruck } from '@/lib/fleet'
import { rememberAuthority, toFormState } from '../_reference/shared'
import type { RecordFormState } from '@/components/forms/RecordForm'
import type { OwnershipType, TruckStatus } from '@/generated/prisma/client'

// The route calls; it does not decide. Every rule about unit numbers, model
// years and odometers lives in src/lib/fleet.ts, where ESLint's ban on `prisma`
// under src/app means a page cannot reach past it.

function read(formData: FormData) {
  return {
    companyId: String(formData.get('companyId') ?? ''),
    unitNumber: String(formData.get('unitNumber') ?? ''),
    vin: formData.get('vin'),
    make: formData.get('make'),
    model: formData.get('model'),
    year: formData.get('year'),
    plate: formData.get('plate'),
    plateState: formData.get('plateState'),
    currentOdometer: formData.get('currentOdometer'),
    status: (formData.get('status') || undefined) as TruckStatus | undefined,
    ownershipType: (formData.get('ownershipType') || undefined) as
      | OwnershipType
      | undefined,
    notes: formData.get('notes'),
  }
}

export async function createTruckAction(
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()
  const input = read(formData)

  try {
    await withCurrentOrg('create', 'truck', (tx, session) =>
      createTruck(tx, session.organizationId, input, {
        byUserId: session.userId,
      }),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  await rememberAuthority(input.companyId)
  revalidatePath('/trucks')
  redirect('/trucks')
}

export async function updateTruckAction(
  id: string,
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()

  try {
    await withCurrentOrg('update', 'truck', (tx) =>
      updateTruck(tx, id, read(formData)),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  revalidatePath('/trucks')
  redirect('/trucks')
}

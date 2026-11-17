'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { createDriver, updateDriver } from '@/lib/fleet'
import { rememberAuthority, toFormState } from '../_reference/shared'
import type { RecordFormState } from '@/components/forms/RecordForm'
import type { DriverStatus, DriverType } from '@/generated/prisma/client'

/**
 * A field the form may not render: `undefined` when it is absent, so
 * `updateDriver` leaves the column as it is (§6.4 part 2 v11.22) — `get`
 * alone returns null for a missing field, which would clear it.
 */
const sent = (formData: FormData, name: string) =>
  formData.has(name) ? formData.get(name) : undefined

function read(formData: FormData) {
  return {
    companyId: String(formData.get('companyId') ?? ''),
    firstName: String(formData.get('firstName') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    phone: formData.get('phone'),
    email: formData.get('email'),
    addressLine1: formData.get('addressLine1'),
    addressCity: formData.get('addressCity'),
    addressState: formData.get('addressState'),
    addressPostalCode: formData.get('addressPostalCode'),
    // The confirm step's tick, and the marker saying it was asked for.
    codesPresented: formData.get('codesPresented'),
    codesConfirmed: formData.get('codesConfirmed'),
    cdlNumber: formData.get('cdlNumber'),
    cdlState: formData.get('cdlState'),
    cdlClass: formData.get('cdlClass'),
    hireDate: formData.get('hireDate'),
    status: (formData.get('status') || undefined) as DriverStatus | undefined,
    driverType: (formData.get('driverType') || undefined) as
      | DriverType
      | undefined,
    notes: formData.get('notes'),
    // Queue item 17: a person or a referral payee, and the tags as typed.
    // `fleet.ts` refuses a kind outside the list and splits the tags.
    kind: formData.get('kind') || undefined,
    tags: formData.get('tags'),
    // Main's four new fields (migration 73); the create form has none of them.
    middleName: sent(formData, 'middleName'),
    birthDate: sent(formData, 'birthDate'),
    telegram: sent(formData, 'telegram'),
    dispatcherUserId: sent(formData, 'dispatcherUserId'),
    assignedTruckId: formData.get('assignedTruckId'),
    assignedTrailerId: formData.get('assignedTrailerId'),
    // Both create-only, and both null on an edit because the form does not
    // render them there: expiry belongs to a ComplianceItem that has its own
    // life once written, and pay belongs to the dated rules on the driver
    // screen. `createDriver` writes them; `updateDriver` ignores them.
    cdlExpiresAt: formData.get('cdlExpiresAt'),
    payPercent: formData.get('payPercent'),
  }
}

export async function createDriverAction(
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()
  const input = read(formData)

  try {
    await withCurrentOrg('create', 'driver', (tx, session) =>
      createDriver(tx, session.organizationId, input, {
        byUserId: session.userId,
      }),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  await rememberAuthority(input.companyId)
  revalidatePath('/drivers')
  // The trucks list shows who is in each truck, so a pairing changes it too.
  revalidatePath('/trucks')
  redirect('/drivers')
}

export async function updateDriverAction(
  id: string,
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()

  try {
    await withCurrentOrg('update', 'driver', (tx) =>
      updateDriver(tx, id, read(formData)),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  revalidatePath('/drivers')
  revalidatePath('/trucks')
  redirect('/drivers')
}

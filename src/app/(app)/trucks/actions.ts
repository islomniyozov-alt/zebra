'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { updateTruck, type TruckEdit } from '@/lib/fleet'
import type { NewAssetState } from '@/lib/new-asset'
import { toFormState } from '../_reference/shared'
import { saveNewAsset } from '../_reference/new-asset-action'
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
    // Item 12. Every one optional; the service layer refuses a code-list
    // value it does not recognise rather than dropping it.
    fleetStatus: formData.get('fleetStatus'),
    fuelType: formData.get('fuelType'),
    ownerName: formData.get('ownerName'),
    axles: formData.get('axles'),
    grossWeightLbs: formData.get('grossWeightLbs'),
  }
}

/** A field the form did not render is `undefined` — left as it is. */
const sent = (formData: FormData, name: string) =>
  formData.has(name) ? formData.get(name) : undefined

/**
 * THE EDIT READS ONLY WHAT THE FORM SENT (TMS v11.36 §6.5 part 2). The record
 * has two tabs, each its own form; `updateTruck` leaves an unsent field as it
 * is, so Details' Save cannot clear Main's fields or the other way round.
 */
function readEdit(formData: FormData): TruckEdit {
  const status = sent(formData, 'status')
  const ownershipType = sent(formData, 'ownershipType')
  const unitNumber = sent(formData, 'unitNumber')
  return Object.fromEntries(
    Object.entries({
      unitNumber: unitNumber === undefined ? undefined : String(unitNumber),
      vin: sent(formData, 'vin'),
      make: sent(formData, 'make'),
      model: sent(formData, 'model'),
      year: sent(formData, 'year'),
      plate: sent(formData, 'plate'),
      plateState: sent(formData, 'plateState'),
      currentOdometer: sent(formData, 'currentOdometer'),
      status: (status || undefined) as TruckStatus | undefined,
      ownershipType: (ownershipType || undefined) as OwnershipType | undefined,
      notes: sent(formData, 'notes'),
      fleetStatus: sent(formData, 'fleetStatus'),
      fuelType: sent(formData, 'fuelType'),
      ownerName: sent(formData, 'ownerName'),
      axles: sent(formData, 'axles'),
      grossWeightLbs: sent(formData, 'grossWeightLbs'),
    }).filter(([, value]) => value !== undefined),
  ) as TruckEdit
}

/**
 * The short form's Save (§6.5 parts 3 and 4). Without a registration it opens
 * the record; with one it answers the ids, so the browser can put the file on
 * the registration item before it opens the record.
 */
export async function createTruckAction(
  _previous: NewAssetState,
  formData: FormData,
): Promise<NewAssetState> {
  const { t } = await getLocaleContext()
  const outcome = await saveNewAsset('truck', read(formData), formData, t)
  if (!outcome.done) return outcome.state
  if (outcome.registrationId) {
    return { error: null, field: null, created: outcome }
  }
  // §6.5 part 3: Save opens the record, where the Details tab is.
  redirect(`/trucks/${outcome.id}`)
}

export async function updateTruckAction(
  id: string,
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()

  try {
    await withCurrentOrg('update', 'truck', (tx) =>
      updateTruck(tx, id, readEdit(formData)),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  revalidatePath('/trucks')
  redirect('/trucks')
}

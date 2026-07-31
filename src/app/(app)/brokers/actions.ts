'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  createBroker,
  restoreBroker,
  retireBroker,
  updateBroker,
} from '@/lib/brokers'
import { toFormState } from '../_reference/shared'
import type { RecordFormState } from '@/components/forms/RecordForm'
import type { CustomerStatus, CustomerType } from '@/generated/prisma/client'

function read(formData: FormData) {
  return {
    name: String(formData.get('name') ?? ''),
    type: (formData.get('type') || undefined) as CustomerType | undefined,
    mcNumber: formData.get('mcNumber'),
    dotNumber: formData.get('dotNumber'),
    addressLine1: formData.get('addressLine1'),
    city: formData.get('city'),
    state: formData.get('state'),
    postalCode: formData.get('postalCode'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    billingEmail: formData.get('billingEmail'),
    paymentTermsDays: formData.get('paymentTermsDays'),
    status: (formData.get('status') || undefined) as CustomerStatus | undefined,
    blockedReason: formData.get('blockedReason'),
    notes: formData.get('notes'),
  }
}

export async function createBrokerAction(
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()

  try {
    await withCurrentOrg('create', 'customer', (tx, session) =>
      createBroker(tx, session.organizationId, read(formData)),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  revalidatePath('/brokers')
  redirect('/brokers')
}

export async function updateBrokerAction(
  id: string,
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()

  try {
    await withCurrentOrg('update', 'customer', (tx) =>
      updateBroker(tx, id, read(formData)),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  revalidatePath('/brokers')
  redirect('/brokers')
}

export async function retireBrokerAction(id: string): Promise<void> {
  await withCurrentOrg('delete', 'customer', (tx) => retireBroker(tx, id))
  revalidatePath('/brokers')
  revalidatePath(`/brokers/${id}`)
}

export async function restoreBrokerAction(id: string): Promise<void> {
  await withCurrentOrg('update', 'customer', (tx) => restoreBroker(tx, id))
  revalidatePath('/brokers')
  revalidatePath(`/brokers/${id}`)
}

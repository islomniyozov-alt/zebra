'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  currentUserCan,
  requireSession,
  withCurrentOrg,
} from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  DuplicateBrokerError,
  createBroker,
  restoreBroker,
  retireBroker,
  updateBroker,
} from '@/lib/brokers'
import {
  renderConcerns,
  renderStatus,
  runCarrierLookup,
} from '@/lib/fmcsa-lookup'
import type { LookupAudience } from '@/lib/fmcsa'
import type { FmcsaAnswer } from '@/components/forms/fmcsa-labels'
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
    // NAMED, AND UNDER THE FIELD IT IS ABOUT. Handled before `toFormState`
    // because that maps a code to a fixed sentence and this one carries the
    // number and the broker who already has it.
    if (error instanceof DuplicateBrokerError) {
      return {
        error: t('brokers.error.duplicateMc')
          .replace('{mc}', error.mcNumber)
          .replace('{name}', error.existingName),
        field: 'mcNumber',
      }
    }
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

// ---------------------------------------------------------------------------
// THE FMCSA LOOKUP, for somebody who will owe us money.
//
// The same register, the same budget and the same sentences as the Add
// authority screen — `fmcsa-lookup.ts` holds all three. What is different is
// the AUDIENCE, and it is the whole point of this caller: a broker's authority
// is judged as a broker's, so an inactive one is said out loud and a carrier's
// missing common authority is not.
//
// REACHABLE BY EVERY ROLE, unlike the authority lookup, which two hold.
// `customer:create` belongs to DISPATCHER because §9's create-on-miss needs it
// and to ACCOUNTING through RECORDS_WRITE, since a broker's billing email and
// terms are accounting's to keep current. That is the "wider hands" flag 24
// parked the rate limit against — wider than the flag guessed — and why the
// budget in `fmcsa-gate.ts` lands in the same commit as this file.
// ---------------------------------------------------------------------------

/**
 * Extends `Record<string, string>` so `RecordForm` can take it as a prefill
 * without a cast, while the named fields still typecheck at the one place they
 * are built.
 */
export interface BrokerPrefill extends Record<string, string> {
  name: string
  mcNumber: string
  dotNumber: string
  addressLine1: string
  city: string
  state: string
  postalCode: string
  phone: string
}

export async function lookupBrokerAction(input: {
  dot: string
  mc: string
  /** What the form's Type select currently says. Decides what is warned about. */
  type: string
}): Promise<FmcsaAnswer<BrokerPrefill>> {
  const { t } = await getLocaleContext()

  if (!(await currentUserCan('create', 'customer'))) {
    return { error: t('fmcsa.error.refused'), found: null }
  }
  const session = await requireSession()

  const outcome = await runCarrierLookup({
    dot: input.dot,
    mc: input.mc,
    userId: session.userId,
  })
  if (!outcome.ok) {
    const message = Object.entries(outcome.values ?? {}).reduce(
      (sentence, [key, value]) => sentence.replaceAll(`{${key}}`, value),
      t(outcome.messageKey),
    )
    return { error: message, found: null }
  }

  const carrier = outcome.carrier

  // THE TYPE SELECT DECIDES WHAT IS WORTH WARNING ABOUT. A SHIPPER — a factory
  // handing us freight — holds no authority of any kind and is not supposed
  // to; warning that they have none would be an accusation built out of the
  // ordinary case. Only a BROKER gets the broker-authority sentences.
  const audience: LookupAudience =
    input.type === 'BROKER' ? 'broker' : 'shipper'

  return {
    error: null,
    found: {
      prefill: {
        // THE LEGAL NAME FIRST HERE, and the authority form does the opposite.
        //
        // `Customer` has no `legalName` column, so this one field is the only
        // place the entity's name can live — and the entity is who signs the
        // rate confirmation, who the invoice is addressed to, and who a
        // collections letter names. A trade name in that field is a trade name
        // on an invoice that has to be paid by a legal person.
        //
        // The DBA is not lost: it is on the panel beside the fields, and
        // `CustomerAlias` learns whatever the rate confirmations actually
        // print the first time a dispatcher corrects it.
        name: carrier.legalName ?? carrier.dbaName ?? '',
        mcNumber: input.mc.trim(),
        dotNumber: carrier.dotNumber ?? '',
        addressLine1: carrier.addressLine1 ?? '',
        city: carrier.city ?? '',
        state: carrier.state ?? '',
        postalCode: carrier.postalCode ?? '',
        phone: carrier.phone ?? '',
      },
      entityType: carrier.entityType,
      operation: carrier.operation,
      safetyRating: carrier.safetyRating,
      dbaName: carrier.dbaName,
      status: renderStatus(carrier, t),
      concerns: renderConcerns(carrier, audience, t),
    },
  }
}

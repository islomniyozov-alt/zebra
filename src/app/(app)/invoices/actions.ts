'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { generateInvoice, markInvoiceSent } from '@/lib/invoices'
import { INVOICE_INITIAL, type InvoiceState } from './invoice-state'
import type { MessageKey } from '@/lib/i18n'

// The two writes the invoice screens make. Both gated on `invoice`, which
// OWNER, ADMIN and ACCOUNTING hold and nobody else does.

const CREATE_ERRORS: Record<string, MessageKey> = {
  no_loads: 'invoices.error.noLoads',
  not_ready: 'invoices.error.notReady',
  mixed_customers: 'invoices.error.mixedCustomers',
  mixed_companies: 'invoices.error.mixedCompanies',
}

const SENT_ERRORS: Record<string, MessageKey> = {
  not_found: 'invoices.error.notFound',
  already_sent: 'invoices.error.alreadySent',
  no_channel: 'invoices.error.noChannel',
}

export async function createInvoiceAction(
  _previous: InvoiceState,
  formData: FormData,
): Promise<InvoiceState> {
  const { t } = await getLocaleContext()
  const loadIds = formData
    .getAll('loadIds')
    .map((value) => String(value))
    .filter((value) => value !== '')

  const outcome = await withCurrentOrg('create', 'invoice', (tx, session) =>
    generateInvoice(tx, session.organizationId, {
      loadIds,
      // The line descriptions are written in the ADMIN's locale at the moment
      // of generation and then frozen — an invoice is a document, and a
      // document does not change language because a different person opens it.
      labels: {
        linehaul: t('rate.linehaul'),
        fuelSurcharge: t('rate.fuelSurcharge'),
        accessorial: (type: string) => t(`accessorial.${type}` as MessageKey),
      },
    }),
  )

  if (!outcome.ok) {
    return {
      error: CREATE_ERRORS[outcome.reason] ?? 'invoices.error.noLoads',
      loadNumbers: outcome.loadNumbers ?? [],
      createdId: null,
    }
  }

  revalidatePath('/invoices')
  revalidatePath('/loads')
  redirect(`/invoices/${outcome.invoiceId}`)
}

export async function markSentAction(
  invoiceId: string,
  _previous: InvoiceState,
  formData: FormData,
): Promise<InvoiceState> {
  const outcome = await withCurrentOrg('update', 'invoice', (tx) =>
    markInvoiceSent(tx, invoiceId, {
      channel: String(formData.get('channel') ?? ''),
      sentToEmail: String(formData.get('sentToEmail') ?? '') || null,
    }),
  )

  if (!outcome.ok) {
    return {
      error: SENT_ERRORS[outcome.reason] ?? 'invoices.error.notFound',
      loadNumbers: [],
      createdId: null,
    }
  }

  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/invoices')
  return INVOICE_INITIAL
}

'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { markInvoiceSent } from '@/lib/invoices'
import type { SentRefusal, SentState } from './bulk-state'
import type { MessageKey } from '@/lib/i18n'

// ACCOUNTING → INVOICES: record a selection as sent (§6.2, v10.8).
//
// ── IT IS NOT A SEND, AND THE BULK PATH MUST NOT PRETEND OTHERWISE ───────
//
// `markInvoiceSent` records that an invoice WENT OUT and by what route. §6:
// the only working sender reaches the owner's inbox alone until a sending
// domain is verified, so the honest flow is download, send it yourself, tell
// the system you did. A bulk button labelled "Send" would be the exact lie
// that function's comment exists to prevent — this one says Mark sent, and
// the channel it records is the one the person picked.
//
// ── THE CHANNEL IS ASKED ONCE, NOT GUESSED PER INVOICE ───────────────────
//
// `markInvoiceSent` refuses an empty channel, because "did we send it" and
// "where did it go" are different questions in a payment chase and the second
// is the one answered wrong from memory a month later. Defaulting it to
// `email` for twenty invoices would put an answer in the record that nobody
// gave. So the control asks, and the answer applies to the selection.
//
// `sentToEmail` stays null on this path: it is per-customer, and a single
// address stamped across twenty invoices would be worse than none.
//
// ── ONE TRANSACTION PER INVOICE, REFUSALS BY NAME ────────────────────────
//
// Same argument as bulk Change status on batches. "17 of 20 sent" tells
// somebody three brokers were not billed and not which three; each refusal
// carries the invoice number the reader knows it by.

const REASON: Record<string, MessageKey> = {
  not_found: 'invoices.error.notFound',
  already_sent: 'invoices.error.alreadySent',
  no_channel: 'invoices.error.noChannel',
}

export async function markSentBulkAction(
  _previous: SentState,
  formData: FormData,
): Promise<SentState> {
  const ids = formData.getAll('invoice').map(String).filter(Boolean)
  const channel = String(formData.get('channel') ?? '').trim()
  if (ids.length === 0) return { changed: 0, refusals: [] }

  let changed = 0
  const refusals: SentRefusal[] = []

  for (const id of ids) {
    const outcome = await withCurrentOrg('update', 'invoice', async (tx) => {
      // THE NUMBER FIRST, so a refusal can name the invoice even when the
      // reason is `not_found` — an id in an error message is the thing the
      // reader then has to go and look up.
      const invoice = await tx.invoice.findFirst({
        where: { id, deletedAt: null },
        select: { invoiceNumber: true },
      })
      const name = invoice?.invoiceNumber ?? id.slice(0, 8)

      const result = await markInvoiceSent(tx, id, { channel })
      if (result.ok) return { name, refusal: null }
      return {
        name,
        refusal: {
          invoice: name,
          reason: REASON[result.reason] ?? 'invoices.error.notFound',
        } satisfies SentRefusal,
      }
    })

    if (outcome.refusal === null) changed += 1
    else refusals.push(outcome.refusal)
  }

  revalidatePath('/accounting/invoices')
  revalidatePath('/invoices')
  return { changed, refusals }
}

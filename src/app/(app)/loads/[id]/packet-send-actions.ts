'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { sendEmail } from '@/lib/email'
import { invoicePacketRefusalDetail } from '@/lib/invoice-packet-store'
import {
  packetRefusalOf,
  packetSendMessage,
  sendInvoicePacket,
} from '@/lib/invoice-packet-send'
import { getLocaleContext } from '@/lib/locale'
import { objectBytes, putObject, r2ConfigFromEnv } from '@/lib/r2'

// MERGE & SEND (TMS §7.14 item 6). Reads nothing from the form: the load is
// the whole input, and the rule — recipient, packet, the 24-hour claim, the
// send, the invoice — is `sendInvoicePacket`. Read under `load.financials`
// (the packet carries the rate con and the invoice); written under
// `invoice:update`, because sending the invoice is what this is.

export interface PacketSendState {
  error: string | null
  notice: string | null
}

export async function sendInvoicePacketAction(
  loadId: string,
  _previous: PacketSendState,
  _formData: FormData,
): Promise<PacketSendState> {
  const { t, locale } = await getLocaleContext()
  const config = r2ConfigFromEnv()
  const outcome = await sendInvoicePacket(
    {
      read: (fn) => withCurrentOrg('read', 'load.financials', (tx) => fn(tx)),
      write: (fn) =>
        withCurrentOrg('update', 'invoice', (tx, session) =>
          fn(tx, session.userId),
        ),
      fetchBytes: (key) => objectBytes(config, key),
      putBytes: (key, bytes) =>
        putObject(config, key, bytes, 'application/pdf'),
      newId: () => crypto.randomUUID(),
      send: (message) => sendEmail(message),
      now: () => new Date(),
    },
    loadId,
  )

  const message = packetSendMessage(outcome, locale)
  if (!message) {
    // A packet refusal (nothing to merge, too large, a file that will not
    // read) says what to fetch, as Merge download does.
    const reason = outcome.ok ? null : packetRefusalOf(outcome.reason)
    return {
      error:
        reason === null
          ? t('loads.mergeSend.notFound')
          : invoicePacketRefusalDetail(reason),
      notice: null,
    }
  }
  let text = t(message.key)
  for (const [name, value] of Object.entries(message.values)) {
    text = text.replace(`{${name}}`, value)
  }
  if (outcome.ok) {
    revalidatePath(`/loads/${loadId}`)
    return { error: null, notice: text }
  }
  return { error: text, notice: null }
}

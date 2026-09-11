'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  filePacketForLoad,
  markFactoredPaid,
  type FilingRefusal,
  type PaidRefusal,
} from '@/lib/factoring-filing'
import { objectBytes, r2ConfigFromEnv } from '@/lib/r2'
import type { MessageKey } from '@/lib/i18n'

// §7 — one button, one packet. The action reads nothing from a form: the load
// is the whole input, and the four-piece question is answered from rows.
//
// ── WHY THIS FILE HAS NO RULES IN IT ────────────────────────────────────
//
// The order — read, fetch, assemble, write — is `filePacketForLoad`'s, in
// `src/lib/factoring-filing.ts`, where a test runs it. What is left here is
// the three things an action is allowed to be: the permission gate, the I/O
// the gate makes available, and the revalidate. See AGENTS.md; PHASE-6 flag 97
// is what putting the order in here would cost.
//
// ── THE TWO TRANSACTIONS ARE TWO `withCurrentOrg` CALLS ──────────────────
//
// Not one held open across the bucket. `objectBytes` calls
// `assertOutsideTransaction` and would throw on the first document — which is
// the guard working, since a packet fetches four objects and a 5-second
// interactive transaction has no business waiting on a third party's network.

export interface FilingActionState {
  error: string | null
  /** Set when the packet built and the load is now filed. */
  filed: boolean
}

// THE INITIAL STATE IS NOT EXPORTED FROM HERE. A 'use server' file may only
// export async functions — Next refuses the build with "can only export async
// functions, found object", and it refuses at BUILD time, which `npm run check`
// never reaches. `FactoringPanel` declares its own. The TYPE above is fine:
// types are erased before Next sees the module.

const REFUSAL_MESSAGE: Record<FilingRefusal['kind'], MessageKey> = {
  load_not_found: 'packet.error.notFound',
  not_factored: 'packet.error.notFactored',
  already_filed: 'packet.error.alreadyFiled',
  not_ready: 'packet.error.notReady',
  packet: 'packet.error.packet',
}

const PAID_MESSAGE: Record<PaidRefusal['kind'], MessageKey> = {
  load_not_found: 'packet.error.notFound',
  not_filed: 'packet.error.notFiled',
}

export async function filePacketAction(
  loadId: string,
  _previous: FilingActionState,
): Promise<FilingActionState> {
  const { t } = await getLocaleContext()
  const config = r2ConfigFromEnv()

  const outcome = await filePacketForLoad(
    {
      read: (fn) => withCurrentOrg('read', 'load.financials', (tx) => fn(tx)),
      fetchBytes: (key) => objectBytes(config, key),
      write: (fn) =>
        withCurrentOrg('update', 'load.financials', (tx) => fn(tx)),
    },
    loadId,
  )

  if (!outcome.ok) {
    return { error: t(REFUSAL_MESSAGE[outcome.reason.kind]), filed: false }
  }

  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')
  return { error: null, filed: true }
}

/**
 * The PAID click, and nothing else can produce it.
 *
 * Factoring money stays out of the software by ruling (§7), so no funding
 * advice ever arrives to move this on its own. A person saw the money land.
 */
export async function markFactoredPaidAction(
  loadId: string,
  _previous: FilingActionState,
): Promise<FilingActionState> {
  const { t } = await getLocaleContext()

  const outcome = await withCurrentOrg('update', 'load.financials', (tx) =>
    markFactoredPaid(tx, loadId),
  )

  if (!outcome.ok) {
    return { error: t(PAID_MESSAGE[outcome.reason.kind]), filed: true }
  }

  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')
  return { error: null, filed: false }
}

'use server'

import { revalidatePath } from 'next/cache'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { RelayCsvError, parseRelayCsv } from '@/lib/relay-csv'
import {
  type ImportPlan,
  ensureRelayCustomer,
  importRelayLoad,
  planRelayImport,
  planSignature,
  previewMoment,
} from '@/lib/relay-import'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { rememberAuthority } from '../../_reference/shared'
import { EMPTY_IMPORT, type PlanView, type RelayImportState } from './state'

// ---------------------------------------------------------------------------
// PREVIEW, THEN CONFIRM (Phase 6 §3a).
//
// ONE ACTION, TWO STEPS, told apart by whether a signature came back. The
// preview writes NOTHING — not the customer, not a location, not a load — so a
// dispatcher who is curious what a file contains can look without leaving
// anything behind.
//
// THE SIGNATURE IS THE GATE. `warningSignature` proved the shape in Phase 5:
// a confirm is only good for the exact plan that was shown. Change the file,
// or let somebody else import the same rows in the seconds between looking and
// clicking, and the signature stops matching — the preview comes back with
// `stale` set instead of the write happening on the strength of a click about
// something else.
// ---------------------------------------------------------------------------

export async function relayImportAction(
  _previous: RelayImportState,
  formData: FormData,
): Promise<RelayImportState> {
  const { t, locale } = await getLocaleContext()

  const csv = String(formData.get('csv') ?? '')
  const companyId = String(formData.get('companyId') ?? '')
  const acknowledged = String(formData.get('signature') ?? '')

  if (csv.trim() === '') {
    return { ...EMPTY_IMPORT, error: t('relay.error.noFile') }
  }

  // §1.3 AND PHASE 3'S RATE_ENTRY, decided once, up here. It governs both what
  // the preview may show and what the write may set — a single answer rather
  // than one per step, because two answers is how they drift apart.
  const maySeeMoney = await currentUserCan('update', 'load.financials')

  let plan: ImportPlan
  try {
    const trips = parseRelayCsv(csv)
    plan = await withCurrentOrg('read', 'load', (tx) =>
      planRelayImport(tx, { trips, maySeeMoney }),
    )
  } catch (error) {
    if (error instanceof RelayCsvError) {
      return {
        ...EMPTY_IMPORT,
        error: t(`relay.error.${error.reason}` as 'relay.error.empty'),
      }
    }
    throw error
  }

  const signature = planSignature(plan)
  const view = renderPlan(plan, { t, locale, maySeeMoney })

  // STEP ONE: show it. Nothing has been written and nothing is about to be.
  if (acknowledged === '') {
    return { ...EMPTY_IMPORT, plan: view, signature }
  }

  // The plan moved under the confirm. Shown again rather than run.
  if (acknowledged !== signature) {
    return { ...EMPTY_IMPORT, plan: view, signature, stale: true }
  }

  if (plan.create.length === 0) {
    return { ...EMPTY_IMPORT, plan: view, signature }
  }

  // STEP TWO: write it.
  //
  // The customer first, in its own transaction and under its own permission —
  // `customer:create`, which every role that may book a load already holds for
  // the create-on-miss broker field. Doing it under `load:create` would be
  // this screen deciding it needed less permission than the brokers typeahead.
  const customer = await withCurrentOrg('create', 'customer', (tx, session) =>
    ensureRelayCustomer(tx, session.organizationId),
  )

  // ONE TRANSACTION PER LOAD. See the note at the top of relay-import.ts: a
  // create is ~31 statements and forty-five of them cannot share one lock.
  // Sequential rather than parallel, because they all take the same authority's
  // load-number counter and racing for it is how a series gets a gap.
  let created = 0
  let failed = 0
  for (const planned of plan.create) {
    try {
      await withCurrentOrg(
        'create',
        'load',
        (tx, session) =>
          importRelayLoad(tx, session.organizationId, planned, {
            companyId,
            customerId: customer.id,
            byUserId: session.userId,
          }),
        { timeoutMs: LOAD_WRITE_TIMEOUT_MS },
      )
      created++
    } catch {
      // COUNTED, NOT THROWN. Row 40 failing must not undo rows 1 to 39 — they
      // are separate freight and they are already committed. The count is
      // reported in words, and the loads that did not land are still in the
      // file, which is what makes re-running it safe: the duplicate warning
      // catches everything that did.
      failed++
    }
  }

  await rememberAuthority(companyId)
  revalidatePath('/loads')

  return { ...EMPTY_IMPORT, created, failed }
}

/**
 * The plan, as the screen sees it.
 *
 * Every date and every warning is rendered HERE, on the server, for the reason
 * the create form renders its warnings here: the client gets sentences, not a
 * message catalogue and a locale to apply it with. And the rate key is added
 * only when the role has one — see `PlanRowView.rate`.
 */
function renderPlan(
  plan: ImportPlan,
  context: {
    t: (key: 'relay.title') => string
    locale: string
    maySeeMoney: boolean
  },
): PlanView {
  const t = context.t as (key: string) => string

  return {
    showsMoney: context.maySeeMoney,
    settlement: plan.customerIsNew
      ? t('relay.customerNew')
      : plan.settlesDirectly
        ? t('relay.customerDirect')
        : t('relay.customerInvoiced'),
    create: plan.create.map((load) => {
      const first = load.stops[0]!
      const last = load.stops[load.stops.length - 1]!
      return {
        rowNumber: load.rowNumber,
        loadId: load.loadId,
        lane: load.lane,
        stops: load.stops.length,
        // EACH IN ITS OWN STOP'S ZONE, which on a cross-zone run is two
        // different zones on one row — `23:30 CDT` out and `16:30 EDT` in.
        // That is design rule 3 and it is also the check: these are the
        // clock faces the Relay portal shows.
        first: previewMoment(first.scheduledAt, first.zone, context.locale),
        last: previewMoment(last.scheduledAt, last.zone, context.locale),
        miles: load.distanceMiles === null ? '—' : String(load.distanceMiles),
        ...(load.costCents === null
          ? {}
          : { rate: formatCents(load.costCents, context.locale) }),
        warnings: load.warnings.map((warning) =>
          Object.entries(warning.values).reduce(
            (message, [key, value]) => message.replaceAll(`{${key}}`, value),
            t(warning.messageKey),
          ),
        ),
      }
    }),
    skip: plan.skip.map((row) => ({
      rowNumber: row.rowNumber,
      loadId: row.loadId ?? '—',
      reason: t(`relay.skip.${row.reason}`),
    })),
  }
}

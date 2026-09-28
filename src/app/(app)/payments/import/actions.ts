'use server'

import { revalidatePath } from 'next/cache'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { readRemittance, totalsAgree } from '@/lib/amazon/remittance'
import {
  previewRemittance,
  referenceOfKey,
} from '@/lib/amazon/remittance-preview'
import {
  adjustmentNote,
  freightForReferences,
  isAdjustmentOnly,
  matchRemittanceCarrier,
  remittanceReferences,
  writeRemittance,
  REMITTANCE_IMPORT_TIMEOUT_MS,
} from '@/lib/amazon/remittance-write'
import {
  EMPTY_REMITTANCE_IMPORT,
  type RemittanceImportState,
  type RemittancePlanView,
  type RemittanceRowView,
} from './state'

// Money → Payments → Import an Amazon remittance.
//
// PREVIEW THEN CONFIRM, the shape the trips importer uses, and for the same
// reason: this writes a Payment, its applications and an accessorial per money
// column, and a person must see what it will do before it does it.
//
// ── `writeRemittance` HAD NO ROUTE FOR SEVENTEEN DAYS ─────────────────────
//
// Its own header has said since 2026-09-11 that it shipped with no caller. A
// script arrived on 2026-09-25; this is the screen. Everything below is
// assembly — the decisions are all in `src/lib/amazon/`, which is why the
// carrier match and the freight map were lifted out of the script rather than
// retyped here.
//
// THE CUSTOMER IS `Amazon Relay`, resolved by name, the same as the script. A
// remittance that cannot find it refuses rather than booking cash against a
// customer it invented.

const CUSTOMER_NAME = 'Amazon Relay'

/**
 * A fingerprint of what the preview showed, posted back with the confirm.
 *
 * THE SAME HAZARD `planSignature` NAMES on the trips importer: preview and
 * confirm are two round trips over one file, and between them a person can pick
 * a different one. Without this the second submit writes whatever the browser
 * last held while the screen still shows the plan for something else — the worst
 * shape a money write can take, because it looks reviewed.
 *
 * THE INVOICE AND ITS TOTAL ARE THE WHOLE FINGERPRINT. Two downloads of one
 * invoice are the same cash; a different invoice or a different total is a
 * different file, and `remittanceKey` makes the first case idempotent anyway.
 */
const signatureOf = (invoiceNumber: string, totalCents: number) =>
  `${invoiceNumber}-${String(totalCents)}`

export async function remittanceImportAction(
  _previous: RemittanceImportState,
  formData: FormData,
): Promise<RemittanceImportState> {
  const { t, locale } = await getLocaleContext()

  if (!(await currentUserCan('create', 'payment'))) {
    return { ...EMPTY_REMITTANCE_IMPORT, error: 'ref.error.required' }
  }
  // §1.3'S MONEY WALL. A role that may not see money does not get the figures in
  // its payload at all — the keys are absent rather than blanked.
  const maySeeMoney = await currentUserCan('update', 'load.financials')

  const file = formData.get('workbook')
  if (!(file instanceof File) || file.size === 0) {
    return { ...EMPTY_REMITTANCE_IMPORT, error: 'remittance.error.noFile' }
  }

  const outcome = await readRemittance(new Uint8Array(await file.arrayBuffer()))
  if (!outcome.ok) {
    // THE REFUSAL'S OWN WORDS, not a generic one. `unrecognised_item_type` cost
    // a day on 2026-09-28 precisely because the report said only its name; the
    // screen names the reason so an office can act on it.
    return {
      ...EMPTY_REMITTANCE_IMPORT,
      error: `remittance.refusal.${outcome.reason.kind}` as never,
    }
  }
  const reading = outcome.reading

  // THREE TOTALS MUST AGREE BEFORE ANYTHING IS SHOWN. A workbook whose body,
  // header and footer disagree is one nobody should read a figure out of.
  if (!totalsAgree(reading)) {
    return { ...EMPTY_REMITTANCE_IMPORT, error: 'remittance.error.totals' }
  }

  const invoiceNumber = reading.summary.invoiceNumber ?? ''
  if (invoiceNumber === '') {
    return { ...EMPTY_REMITTANCE_IMPORT, error: 'remittance.error.noInvoice' }
  }
  const signature = signatureOf(invoiceNumber, reading.totals.headerCents)

  // --- what it would do, decided against the database -----------------------
  const decided = await withCurrentOrg('read', 'payment', async (tx) => {
    const companies = await tx.company.findMany({
      select: { id: true, name: true, legalName: true, scac: true },
    })
    const carrier = matchRemittanceCarrier(reading.summary, companies)
    const customer = await tx.customer.findFirst({
      where: { name: CUSTOMER_NAME },
      select: { id: true },
    })
    const freight = await freightForReferences(
      tx,
      remittanceReferences(reading),
    )
    return { carrier, customerId: customer?.id ?? null, freight }
  })

  if (!decided.carrier.ok) {
    // ONE AUTHORITY, EXACTLY. A week's cash is not routed by a near miss, and
    // two companies in this group differ by one word.
    return { ...EMPTY_REMITTANCE_IMPORT, error: 'remittance.error.carrier' }
  }
  if (decided.customerId === null) {
    return { ...EMPTY_REMITTANCE_IMPORT, error: 'remittance.error.customer' }
  }

  const preview = previewRemittance(reading, decided.freight)

  const rows: RemittanceRowView[] = preview.lines.map((line) => {
    const row: RemittanceRowView = {
      reference: referenceOfKey(line.key) ?? '—',
      outcome: line.outcome,
      outcomeLabel: t(`remittance.outcome.${line.outcome}` as never),
      loads: line.loads.map((load) => load.loadNumber).join(', ') || '—',
    }
    if (maySeeMoney) {
      row.remitted = formatCents(line.remittedCents, locale)
      row.rated = formatCents(line.ratedCents, locale)
    }
    return row
  })

  const view: RemittancePlanView = {
    invoiceNumber,
    workPeriod: reading.summary.workPeriod ?? '—',
    carrier: reading.summary.carrier ?? '—',
    companyName: decided.carrier.company.name,
    rows,
    counts: Object.entries(preview.counts).map(([label, n]) => ({
      label: t(`remittance.outcome.${label}` as never),
      n,
    })),
    unmatchedReferences: [
      ...new Set(
        preview.lines
          .filter((line) => line.outcome === 'unmatched')
          .map((line) => referenceOfKey(line.key) ?? '—'),
      ),
    ],
    isCredit: isAdjustmentOnly(reading),
    creditText: adjustmentNote(reading),
    showsMoney: maySeeMoney,
  }
  if (maySeeMoney) {
    view.total = formatCents(reading.totals.headerCents, locale)
  }

  const acknowledged = String(formData.get('signature') ?? '')
  if (acknowledged === '') {
    return { ...EMPTY_REMITTANCE_IMPORT, plan: view, signature }
  }
  if (acknowledged !== signature) {
    return { ...EMPTY_REMITTANCE_IMPORT, plan: view, signature, stale: true }
  }

  // --- write ----------------------------------------------------------------
  //
  // THE FREIGHT IS READ AGAIN INSIDE THIS TRANSACTION. `freightForReferences`
  // says why: the tour-base predicate compares the remitted total against the
  // load's rate, and a map read before the transaction is the state the last run
  // left behind.
  const written = await withCurrentOrg(
    'create',
    'payment',
    async (tx, session) =>
      writeRemittance(tx, {
        organizationId: session.organizationId,
        companyId: decided.carrier.ok ? decided.carrier.company.id : '',
        customerId: decided.customerId ?? '',
        reading,
        freightByReference: await freightForReferences(
          tx,
          remittanceReferences(reading),
        ),
        receivedAt: reading.summary.paymentDate
          ? new Date(`${reading.summary.paymentDate} UTC`)
          : new Date(),
        recordedByUserId: session.userId ?? null,
      }),
    { timeoutMs: REMITTANCE_IMPORT_TIMEOUT_MS },
  )

  revalidatePath('/payments')
  revalidatePath('/money/this-week')
  return {
    ...EMPTY_REMITTANCE_IMPORT,
    paymentId: written.paymentId,
    appliedUnits: written.appliedUnits,
    applied: maySeeMoney ? formatCents(written.appliedCents, locale) : null,
    unapplied: maySeeMoney ? formatCents(written.unappliedCents, locale) : null,
    alreadyImported: written.alreadyImported,
  }
}

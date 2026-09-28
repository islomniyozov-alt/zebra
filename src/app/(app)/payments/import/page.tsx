import { notFound } from 'next/navigation'
import { currentUserCan } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { RemittanceImportForm } from './RemittanceImportForm'
import type { MessageKey } from '@/lib/i18n'

// Payments → Import an Amazon remittance.
//
// GATED ON `payment:create`, because that is what this screen does: it books one
// Payment, its applications and an accessorial per money column. The money
// FIGURES are gated separately inside the action on `load.financials`, so a role
// that may record cash without seeing load rates gets a preview with the
// outcomes and no amounts — §1.3, the field absent rather than blanked.
//
// ── IT LIVES UNDER PAYMENTS, NOT UNDER LOADS ──────────────────────────────
//
// The trips and load-board importers sit under `/loads/import` because they book
// freight. This books CASH against freight that already exists, which is what
// makes `/payments` its home: an accountant looking for "where did Amazon's
// money go" looks at payments, and the list links here.

/** The refusals and errors the form renders, translated once on the server. */
const ERROR_KEYS: MessageKey[] = [
  'remittance.error.noFile',
  'remittance.error.totals',
  'remittance.error.noInvoice',
  'remittance.error.carrier',
  'remittance.error.customer',
  'remittance.refusal.sheet_missing',
  'remittance.refusal.columns_changed',
  'remittance.refusal.unrecognised_item_type',
  'remittance.refusal.no_invoice_total',
  'remittance.refusal.leaked_object',
  'remittance.refusal.totals_disagree',
  'ref.error.required',
]

export default async function RemittanceImportPage() {
  if (!(await currentUserCan('create', 'payment'))) notFound()

  const { t } = await getLocaleContext()

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-z4">
      <RemittanceImportForm
        translate={Object.fromEntries(ERROR_KEYS.map((key) => [key, t(key)]))}
        labels={{
          title: t('remittance.title'),
          hint: t('remittance.hint'),
          choose: t('remittance.choose'),
          file: t('remittance.file'),
          preview: t('remittance.preview'),
          confirm: t('remittance.confirm'),
          back: t('remittance.back'),
          invoice: t('remittance.invoice'),
          period: t('remittance.period'),
          carrier: t('remittance.carrier'),
          company: t('remittance.company'),
          total: t('remittance.total'),
          reference: t('remittance.reference'),
          loads: t('remittance.loads'),
          remitted: t('remittance.remitted'),
          rated: t('remittance.rated'),
          outcomeColumn: t('remittance.outcomeColumn'),
          credit: t('remittance.credit'),
          unmatchedTitle: t('remittance.unmatchedTitle'),
          done: t('remittance.done'),
          alreadyImported: t('remittance.alreadyImported'),
          applied: t('remittance.applied'),
          unapplied: t('remittance.unapplied'),
          toPayments: t('remittance.toPayments'),
          stale: t('remittance.stale'),
        }}
      />
    </div>
  )
}

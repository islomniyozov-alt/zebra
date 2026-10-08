import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { listedAuthorities } from '@/lib/companies'
import { factorsForCompanies } from '@/lib/factoring'
import { bpsToInput } from '@/lib/money'
import { EmptyState } from '@/components/ui/EmptyState'
import { FactorForm, type FactorDraft } from './FactorForm'
import type { MessageKey } from '@/lib/i18n'

// FACTORING TERMS ARE PER AUTHORITY (§5 step 4).
//
// Both carriers factor, and they negotiated separately. One shared record with
// an exception written down somewhere else is how the wrong advance rate ends
// up on the wrong invoice, so the row itself carries the authority and
// `markFactored` refuses a mismatch rather than warning about one.

const ERROR_KEYS: MessageKey[] = [
  'factoring.error.noName',
  'factoring.error.noCompany',
  'factoring.error.badRate',
  'factoring.error.overHundred',
  'factoring.error.notFound',
]

export default async function FactoringSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ factor?: string }>
}) {
  if (!(await currentUserCan('update', 'receivable'))) notFound()

  const { t } = await getLocaleContext()
  const { factor: editing } = await searchParams

  const data = await withCurrentOrg(
    'read',
    'receivable',
    async (tx, session) => {
      const [factors, companies] = await Promise.all([
        factorsForCompanies(tx, companyScopeFilter(session.companyScopes)),
        listedAuthorities(tx, session.companyScopes),
      ])
      return { factors, companies }
    },
  )

  const target = editing
    ? (data.factors.find((factor) => factor.id === editing) ?? null)
    : null

  const draft: FactorDraft | null = target
    ? {
        id: target.id,
        companyId: target.companyId,
        name: target.name,
        contactName: target.contactName,
        phone: target.phone,
        email: target.email,
        remitAddressLine1: target.remitAddressLine1,
        remitAddressLine2: target.remitAddressLine2,
        remitCity: target.remitCity,
        remitState: target.remitState,
        remitPostalCode: target.remitPostalCode,
        // Rendered from basis points, never from a float: 9700 -> "97".
        advanceRate:
          target.advanceRateBps === null
            ? ''
            : bpsToInput(target.advanceRateBps),
        feeRate: target.feeBps === null ? '' : bpsToInput(target.feeBps),
        notes: target.notes,
      }
    : null

  const translate = Object.fromEntries(ERROR_KEYS.map((key) => [key, t(key)]))

  const rate = (bps: number | null) =>
    bps === null ? t('factoring.noTermsYet') : `${bpsToInput(bps)}%`

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('factoring.setup')}</h1>
        <Link
          href="/receivables"
          className="text-sm text-accent hover:underline"
        >
          {t('receivables.title')}
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <div className="flex max-w-[860px] flex-col gap-z4">
          <p className="max-w-[68ch] text-sm text-ink-3">
            {t('factoring.setupHint')}
          </p>

          {data.factors.length === 0 ? (
            <EmptyState
              title={t('factoring.title')}
              body={t('factoring.none')}
            />
          ) : (
            <ul className="flex flex-col gap-z2">
              {data.factors.map((factor) => (
                <li
                  key={factor.id}
                  className="flex flex-wrap items-baseline gap-x-z4 gap-y-z1 rounded-card border border-border bg-surface p-z3 text-sm"
                >
                  <span className="font-medium text-ink">{factor.name}</span>
                  <span className="text-ink-2">{factor.companyName}</span>
                  <span className="text-ink-2">
                    {t('receivables.advance')}{' '}
                    <span className="font-mono tabular-nums text-ink">
                      {rate(factor.advanceRateBps)}
                    </span>
                  </span>
                  <span className="text-ink-2">
                    {t('receivables.fee')}{' '}
                    <span className="font-mono tabular-nums text-ink">
                      {rate(factor.feeBps)}
                    </span>
                  </span>
                  {factor.contactName ? (
                    <span className="text-ink-3">{factor.contactName}</span>
                  ) : null}
                  <Link
                    href={`/receivables/factoring?factor=${factor.id}`}
                    className="ms-auto text-accent hover:underline"
                  >
                    {t('factoring.edit')}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <FactorForm
            factor={draft}
            companies={[
              // An empty first option so a new factor cannot be saved against
              // whichever authority happens to sort first by accident.
              { value: '', label: '—' },
              ...data.companies.map((company) => ({
                value: company.id,
                label: company.name,
              })),
            ]}
            translate={translate}
            labels={{
              heading: draft ? t('factoring.edit') : t('factoring.add'),
              name: t('factoring.name'),
              authority: t('factoring.authority'),
              contact: t('factoring.contact'),
              phone: t('factoring.phone'),
              email: t('factoring.email'),
              advanceRate: t('factoring.advanceRate'),
              feeRate: t('factoring.feeRate'),
              percentHint: t('factoring.percentHint'),
              notes: t('factoring.notes'),
              remitHeading: t('factoring.remitHeading'),
              remitHint: t('factoring.remitHint'),
              remitLine1: t('factoring.remitLine1'),
              remitLine2: t('factoring.remitLine2'),
              remitCity: t('factoring.remitCity'),
              remitState: t('factoring.remitState'),
              remitPostalCode: t('factoring.remitPostalCode'),
              save: t('factoring.save'),
              cancel: t('factoring.cancel'),
              saved: t('factoring.saved'),
            }}
          />
        </div>
      </div>
    </>
  )
}

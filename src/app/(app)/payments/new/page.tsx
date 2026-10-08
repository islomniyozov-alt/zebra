import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { listedAuthorities } from '@/lib/companies'
import { RecordForm } from './RecordForm'
import type { PaymentMethod } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

const METHODS: PaymentMethod[] = [
  'ACH',
  'CHECK',
  'WIRE',
  'ZELLE',
  'CREDIT_CARD',
  'FACTORING_ADVANCE',
  'FACTORING_RESERVE',
  'CASH',
  'OTHER',
]

const ERROR_KEYS: MessageKey[] = [
  'payments.error.noCompany',
  'payments.error.badAmount',
  'payments.error.noDate',
  'payments.error.customerNotFound',
]

export default async function NewPaymentPage() {
  if (!(await currentUserCan('create', 'payment'))) notFound()

  const { t } = await getLocaleContext()

  const data = await withCurrentOrg('read', 'payment', async (tx, session) => {
    const [companies, customers] = await Promise.all([
      listedAuthorities(tx, session.companyScopes),
      // Brokers are shared across authorities (schema note at Company), so
      // this list is not scoped the way the authority list is.
      tx.customer.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        take: 500,
        select: { id: true, name: true },
      }),
    ])
    return { companies, customers }
  })

  const translate = Object.fromEntries(ERROR_KEYS.map((key) => [key, t(key)]))

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('payments.record')}</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <div className="max-w-[860px]">
          <RecordForm
            companies={data.companies.map((company) => ({
              value: company.id,
              label: company.name,
            }))}
            customers={[
              // Optional on purpose: an ACH with no remittance advice often
              // arrives before anybody knows who sent it, and refusing to
              // record it until that is answered is how bank lines go
              // unrecorded for a fortnight.
              { value: '', label: '—' },
              ...data.customers.map((customer) => ({
                value: customer.id,
                label: customer.name,
              })),
            ]}
            methods={METHODS.map((method) => ({
              value: method,
              label: t(`payments.method.${method}` as MessageKey),
            }))}
            today={new Date().toISOString().slice(0, 10)}
            translate={translate}
            labels={{
              heading: t('payments.record'),
              authority: t('payments.authority'),
              payer: t('payments.payer'),
              method: t('payments.method'),
              reference: t('payments.reference'),
              referenceHint: t('payments.referenceHint'),
              amount: t('payments.amount'),
              received: t('payments.received'),
              notes: t('payments.notes'),
              save: t('payments.save'),
              cancel: t('factoring.cancel'),
            }}
          />
        </div>
      </div>
    </>
  )
}

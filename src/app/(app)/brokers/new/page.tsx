import { notFound } from 'next/navigation'
import { currentUserCan } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { RecordForm } from '@/components/forms/RecordForm'
import { createBrokerAction } from '../actions'
import { brokerFields } from '../fields'

// A DISPATCHER holds `customer:create` but not `customer:update` — they can
// add a broker mid-booking and cannot edit one afterwards. That asymmetry is
// deliberate (§9's create-on-miss needs the first; nothing needs the second),
// so this route exists for them and `/brokers/[id]` renders read-only.

export default async function NewBrokerPage() {
  if (!(await currentUserCan('create', 'customer'))) notFound()

  const { t } = await getLocaleContext()

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('brokers.new')}</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <RecordForm
          fields={brokerFields(t)}
          values={{
            type: 'BROKER',
            status: 'ACTIVE',
            paymentTermsDays: '30',
          }}
          action={createBrokerAction}
          cancelHref="/brokers"
          labels={{ save: t('ref.save'), cancel: t('ref.cancel') }}
        />
      </div>
    </>
  )
}

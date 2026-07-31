import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { RecordForm } from '@/components/forms/RecordForm'
import { RetireActions } from '../RetireActions'
import {
  restoreBrokerAction,
  retireBrokerAction,
  updateBrokerAction,
} from '../actions'
import { brokerFields } from '../fields'
import { orDash } from '../../_reference/shared'

export default async function EditBrokerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { t } = await getLocaleContext()

  const broker = await withCurrentOrg('read', 'customer', (tx) =>
    tx.customer.findUnique({ where: { id } }),
  )
  if (!broker) notFound()

  const mayEdit = await currentUserCan('update', 'customer')
  const mayDelete = await currentUserCan('delete', 'customer')

  // A DISPATCHER may read a broker and not change one. They get the facts, not
  // a form with a save button that would fail — §7's rule about not shipping
  // something the role cannot use applies to controls as much as to fields.
  if (!mayEdit) {
    const facts: Array<[string, string]> = [
      [t('brokers.name'), broker.name],
      [t('brokers.mc'), orDash(broker.mcNumber)],
      [t('brokers.dot'), orDash(broker.dotNumber)],
      [
        t('brokers.city'),
        orDash([broker.city, broker.state].filter(Boolean).join(', ')),
      ],
      [t('brokers.phone'), orDash(broker.phone)],
      [t('brokers.email'), orDash(broker.email)],
      [t('brokers.terms'), String(broker.paymentTermsDays)],
      [t('ref.status'), t(`brokers.status.${broker.status}` as never)],
      [t('brokers.blockedReason'), orDash(broker.blockedReason)],
    ]

    return (
      <>
        <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
          <h1 className="text-lg font-medium text-ink">{broker.name}</h1>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
          <dl className="max-w-[520px] rounded-card border border-border bg-surface p-z4">
            {facts.map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-z4 border-b border-border py-z2 last:border-b-0"
              >
                <dt className="text-sm text-ink-2">{label}</dt>
                <dd className="text-base text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">
          {t('brokers.edit')} <span className="text-ink-2">{broker.name}</span>
        </h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <RecordForm
          fields={brokerFields(t)}
          values={{
            name: broker.name,
            type: broker.type,
            mcNumber: broker.mcNumber ?? '',
            dotNumber: broker.dotNumber ?? '',
            addressLine1: broker.addressLine1 ?? '',
            city: broker.city ?? '',
            state: broker.state ?? '',
            postalCode: broker.postalCode ?? '',
            phone: broker.phone ?? '',
            email: broker.email ?? '',
            billingEmail: broker.billingEmail ?? '',
            paymentTermsDays: String(broker.paymentTermsDays),
            status: broker.status,
            blockedReason: broker.blockedReason ?? '',
            notes: broker.notes ?? '',
          }}
          action={updateBrokerAction.bind(null, id)}
          cancelHref="/brokers"
          labels={{ save: t('ref.save'), cancel: t('ref.cancel') }}
        >
          <RetireActions
            isRetired={broker.deletedAt !== null}
            retireAction={
              mayDelete
                ? retireBrokerAction.bind(null, id)
                : async () => {
                    'use server'
                  }
            }
            restoreAction={restoreBrokerAction.bind(null, id)}
            labels={{
              retire: t('ref.retire'),
              retireConfirm: t('ref.retireConfirm'),
              retireBody: t('ref.retireBody'),
              restore: t('ref.restore'),
              cancel: t('ref.cancel'),
            }}
          />
        </RecordForm>
      </div>
    </>
  )
}

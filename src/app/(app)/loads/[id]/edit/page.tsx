import { notFound } from 'next/navigation'
import { assignableDriver, ASSIGNABLE_TRUCK } from '@/lib/driver-availability'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { centsToInput } from '@/lib/money'
import { stopFormValues } from '@/lib/load-form'
import { STORED_STOP_SELECT } from '@/lib/load-edit'
import { CreateLoadForm } from '../../new/CreateLoadForm'
import { loadFormLabels } from '../../new/labels'
import { saveLoadEditAction } from './actions'

// EDIT LOAD (TMS §7.14 part 7, v11.60) — Add load's own form, prefilled.
//
// One form, not two: the fields, the stop list, the date convention and the
// keyboard path are Add load's, so an edit cannot learn to read a stop
// differently from a booking. The stops are shown through `stopFormValues`,
// the same function the save compares against, so "unchanged" means the
// same thing on both sides of the round trip.

export default async function EditLoadPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await currentUserCan('update', 'load'))) notFound()
  const { id } = await params
  const { t } = await getLocaleContext()
  const mayEnterRate = await currentUserCan('update', 'load.financials')

  const data = await withCurrentOrg('read', 'load', async (tx) => {
    const load = await tx.load.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true } },
        customer: { select: { name: true } },
        stops: { orderBy: { sequence: 'asc' }, select: STORED_STOP_SELECT },
      },
    })
    // A cancelled load is not edited (`updateLoad` refuses it); the page
    // says so the same way it says a missing one is missing.
    if (!load || load.isCancelled) return null

    // The fleet of THE LOAD'S authority, and whoever is already on it — a
    // select whose options lack the current value falls back to blank, and
    // the next save would unassign the load without anyone touching it.
    const [trucks, drivers, brokers, places] = await Promise.all([
      tx.truck.findMany({
        where: {
          companyId: load.companyId,
          OR: [
            ASSIGNABLE_TRUCK,
            ...(load.truckId ? [{ id: load.truckId }] : []),
          ],
        },
        orderBy: { unitNumber: 'asc' },
        take: 500,
        select: { id: true, unitNumber: true },
      }),
      tx.driver.findMany({
        where: {
          companyId: load.companyId,
          OR: [
            assignableDriver(),
            ...(load.driverId ? [{ id: load.driverId }] : []),
          ],
        },
        orderBy: { lastName: 'asc' },
        take: 500,
        select: { id: true, firstName: true, lastName: true },
      }),
      tx.customer.findMany({
        where: { deletedAt: null, status: { not: 'BLOCKED' } },
        orderBy: { name: 'asc' },
        take: 500,
        select: { name: true },
      }),
      tx.location.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        take: 500,
        select: { name: true },
      }),
    ])
    return { load, trucks, drivers, brokers, places }
  })
  if (!data) notFound()
  const { load } = data

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">
          {t('loads.editTitle').replace('{number}', load.loadNumber)}
        </h1>
        <p className="text-xs text-ink-3">{t('loads.editHint')}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <CreateLoadForm
          editing={{
            loadId: load.id,
            action: saveLoadEditAction.bind(null, load.id),
            broker: load.customer.name,
            truckId: load.truckId ?? '',
            driverId: load.driverId ?? '',
            stops: load.stops.map((stop) => {
              const shown = stopFormValues(stop)
              return {
                id: shown.id,
                place: shown.place,
                type: shown.type,
                date: shown.date,
                from: shown.from,
                to: shown.to,
              }
            }),
            bol: load.bolNumber ?? '',
            po: load.poNumber ?? '',
            reference: load.referenceNumber ?? '',
            miles:
              load.dispatchedMiles === null ? '' : String(load.dispatchedMiles),
            // §1.3: a role that may not set a rate is not sent one to edit.
            rate: mayEnterRate ? centsToInput(load.linehaulCents) : '',
          }}
          authorities={[{ value: load.company.id, label: load.company.name }]}
          defaultAuthority={load.company.id}
          brokers={data.brokers.map((broker) => broker.name)}
          recentCustomers={[]}
          trucks={data.trucks.map((truck) => ({
            value: truck.id,
            label: truck.unitNumber,
          }))}
          drivers={data.drivers.map((driver) => ({
            value: driver.id,
            label: `${driver.lastName}, ${driver.firstName}`,
          }))}
          places={data.places.map((place) => place.name)}
          economics={null}
          mayEnterRate={mayEnterRate}
          labels={loadFormLabels(t)}
        />
      </div>
    </>
  )
}

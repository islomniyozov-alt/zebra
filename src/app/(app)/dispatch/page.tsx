import { assignableDriver, ASSIGNABLE_TRUCK } from '@/lib/driver-availability'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { operationalTone } from '@/lib/status'
import { KpiCard } from '@/components/ui/KpiCard'
import { Board, type BoardLoad, type BoardTruck } from './Board'
import {
  ACTIVE_LOAD,
  BOARD_LOAD,
  headingToForTrucks,
} from '@/lib/dispatch-fields'

// §11 — the dispatch board. Zebra's own, not the wall display.
//
// Seven days from today, because a dispatcher's question at 6am is "what is
// running this week" and a longer window is a smaller cell. The company filter
// applies, so a group running three authorities can look at one.

const DAYS = 7

/** Midnight UTC of the day `at` falls on, for bucketing into columns. */
function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10)
}

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, locale } = await getLocaleContext()
  const companyParam =
    typeof params['company'] === 'string' ? params['company'] : undefined

  const today = new Date()
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  )
  const columns = Array.from({ length: DAYS }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    return date
  })
  const columnKeys = columns.map(dayKey)
  const windowEnd = new Date(start)
  windowEnd.setUTCDate(start.getUTCDate() + DAYS)

  const data = await withCurrentOrg('read', 'dispatch', async (tx, session) => {
    const scope = companyScopeFilter(session.companyScopes)
    const where = {
      ...scope,
      ...(companyParam ? { companyId: companyParam } : {}),
    }

    const [trucks, drivers, loads, available] = await Promise.all([
      tx.truck.findMany({
        where: { ...where, ...ASSIGNABLE_TRUCK },
        orderBy: [{ company: { name: 'asc' } }, { unitNumber: 'asc' }],
        select: {
          id: true,
          unitNumber: true,
          company: { select: { name: true } },
          drivers: {
            where: { deletedAt: null },
            take: 1,
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      // Every active driver, not only the paired ones. A truck with nobody in
      // it is the normal state of a yard, and a board that can only assign
      // trucks that already have a driver would leave the load at Booked with
      // no way to say who is driving it — §7 needs both before it dispatches.
      tx.driver.findMany({
        where: { ...where, ...assignableDriver(today) },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: 300,
        select: { id: true, firstName: true, lastName: true },
      }),
      tx.load.findMany({
        // `BOARD_LOAD`, not `deletedAt: null`: closed Datatruck history is not
        // work, and it was filling the Unassigned rail (§6.1.1's billing axis).
        where: { ...where, ...BOARD_LOAD },
        orderBy: { bookedAt: 'desc' },
        take: 300,
        select: {
          id: true,
          loadNumber: true,
          truckId: true,
          isCancelled: true,
          operationalStatus: true,
          customer: { select: { name: true } },
          stops: {
            orderBy: { sequence: 'asc' },
            select: {
              scheduledAt: true,
              // `name` for the same reason the loads list selects it: a Relay
              // import writes the facility code and no city at all.
              name: true,
              city: true,
              state: true,
              type: true,
            },
          },
        },
      }),
      // ── COMPUTED FROM THE FREIGHT (owner's ruling, 2026-09-21) ────────
      //
      // This counted `Truck.status = AVAILABLE`, a word somebody typed on
      // the truck page. A unit hauling to Gastonia stayed "available" until
      // somebody went back and said otherwise, so the number a dispatcher
      // plans the week from was the most confident thing on the screen and
      // the least connected to what the trucks were doing.
      //
      // `ACTIVE_LOAD` is the same predicate `headingTo` derives from, so a
      // truck counted here is exactly a truck whose Heading to cell is
      // blank. Still one statement — a relation filter, not a fan-out.
      tx.truck.count({
        where: {
          ...where,
          ...ASSIGNABLE_TRUCK,
          loads: { none: ACTIVE_LOAD },
        },
      }),
    ])

    // ONE MORE STATEMENT FOR THE WHOLE BOARD, after the trucks are known.
    // It cannot join the `Promise.all` above because it takes their ids,
    // and it is not a per-row read: `headingToForTrucks` takes the array.
    //
    // The board already holds 300 loads, and they are still the wrong
    // source — that take is ordered by booking and windowed to the week, so
    // a truck on a load booked a month ago is heading nowhere according to
    // it. Deriving from the set that happens to be on screen is how a
    // derived field acquires the staleness it was meant to avoid.
    const headingTo = await headingToForTrucks(
      tx,
      trucks.map((truck) => truck.id),
    )

    return { trucks, drivers, loads, available, headingTo }
  })

  const canAssign = await currentUserCan('update', 'dispatch')

  // THE SAME FALLBACK THE LOADS LIST AND THE LOAD DETAIL USE. City and state
  // alone rendered "— → —" for every imported load, because the board export
  // carries no addresses and its stops hold the facility code in `name`. Three
  // screens showing one row differently is the defect; one expression is the
  // fix.
  type StopPlace = {
    name: string | null
    city: string | null
    state: string | null
  }
  const routeOf = (stops: StopPlace[]) => {
    const place = (stop?: StopPlace) => {
      if (!stop) return '—'
      const address = [stop.city, stop.state].filter(Boolean).join(', ')
      return address || stop.name || '—'
    }
    return `${place(stops[0])} → ${place(stops[stops.length - 1])}`
  }

  const toBoardLoad = (
    load: (typeof data.loads)[number],
    dayIndex: number | null,
  ): BoardLoad => ({
    id: load.id,
    loadNumber: load.loadNumber,
    customerName: load.customer.name,
    route: routeOf(load.stops),
    tone: operationalTone(load.operationalStatus),
    dayIndex,
    isCancelled: load.isCancelled,
  })

  // A load lands in the column of its FIRST dated stop. A load whose pickup is
  // outside the window still shows if its delivery is inside it — the truck is
  // busy either way, which is the question the board answers.
  const columnFor = (load: (typeof data.loads)[number]): number | null => {
    for (const stop of load.stops) {
      if (!stop.scheduledAt) continue
      const index = columnKeys.indexOf(dayKey(stop.scheduledAt))
      if (index !== -1) return index
    }
    return null
  }

  const trucks: BoardTruck[] = data.trucks.map((truck) => {
    const driver = truck.drivers[0]
    const loadsByDay: Record<number, BoardLoad[]> = {}
    for (const load of data.loads) {
      if (load.truckId !== truck.id) continue
      const index = columnFor(load)
      if (index === null) continue
      ;(loadsByDay[index] ??= []).push(toBoardLoad(load, index))
    }
    return {
      id: truck.id,
      unitNumber: truck.unitNumber,
      driverName: driver ? `${driver.lastName}, ${driver.firstName}` : null,
      driverId: driver?.id ?? null,
      companyName: truck.company.name,
      loadsByDay,
      headingTo: data.headingTo.get(truck.id) ?? null,
    }
  })

  // The rail: anything without a truck, and not cancelled. A cancelled load is
  // not waiting for a truck.
  const unassigned = data.loads
    .filter((load) => load.truckId === null && !load.isCancelled)
    .map((load) => toBoardLoad(load, columnFor(load)))

  const active = data.loads.filter(
    (load) =>
      !load.isCancelled &&
      load.operationalStatus !== 'POD_RECEIVED' &&
      load.operationalStatus !== 'DELIVERED',
  ).length
  const inTransit = data.loads.filter(
    (load) => !load.isCancelled && load.operationalStatus === 'IN_TRANSIT',
  ).length
  const awaitingPod = data.loads.filter(
    (load) => !load.isCancelled && load.operationalStatus === 'DELIVERED',
  ).length

  const dayLabels = columns.map((date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(date),
  )

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('nav.dispatch')}</h1>
        <p className="text-xs text-ink-3">{t('loads.stripeMeaning')}</p>
      </div>

      {/* §11 — KpiCards across the top. The component has existed since Phase 1
       * with nothing to put in it; this is what it was for. */}
      <div className="grid shrink-0 grid-cols-2 gap-z3 border-b border-border bg-surface-2 px-gutter py-z3 lg:grid-cols-4">
        <KpiCard label={t('dispatch.kpi.active')} value={String(active)} />
        <KpiCard
          label={t('dispatch.kpi.inTransit')}
          value={String(inTransit)}
        />
        <KpiCard
          label={t('dispatch.kpi.awaitingPod')}
          value={String(awaitingPod)}
        />
        <KpiCard
          label={t('dispatch.kpi.available')}
          value={String(data.available)}
        />
      </div>

      <Board
        days={dayLabels}
        trucks={trucks}
        drivers={data.drivers.map((driver) => ({
          id: driver.id,
          name: `${driver.lastName}, ${driver.firstName}`,
        }))}
        unassigned={unassigned}
        canAssign={canAssign}
        labels={{
          truck: t('loads.column.truck'),
          unassigned: t('dispatch.unassigned'),
          unassignedEmpty: t('dispatch.unassignedEmpty'),
          assign: t('dispatch.assign'),
          assignTitle: t('dispatch.assignTitle'),
          assignBody: t('dispatch.assignBody'),
          warnTitle: t('dispatch.warnTitle'),
          warnBody: t('dispatch.warnBody'),
          warnConfirm: t('dispatch.warnConfirm'),
          driverNone: t('dispatch.driverNone'),
          driverKeep: t('dispatch.driverKeep'),
          cancel: t('ref.cancel'),
          empty: t('dispatch.empty'),
          noTrucks: t('dispatch.noTrucks'),
          headingTo: t('dispatch.headingTo'),
        }}
      />
    </>
  )
}

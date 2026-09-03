import { notFound } from 'next/navigation'
import Link from 'next/link'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  billingLabelKey,
  billingTone,
  operationalLabelKey,
  operationalTone,
  TONE_STRIPE,
} from '@/lib/status'
import { formatAddress } from '@/lib/locations'
import { newestFirst } from '@/lib/load-timeline'
import {
  ACCESSORIAL_TYPES,
  accessorialChoicesFor,
  loadDetailView,
} from '@/lib/load-detail-view'
import { renderStopTime, ZONE_CHOICES } from '@/lib/stop-time'
import { latenessLabel, shownStopTime } from '@/lib/stop-actuals'
import { isMessageKey, type MessageKey } from '@/lib/i18n'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { RatePanel, type AccessorialRow } from './RatePanel'
import { StatusTimeline, type TimelineEntry } from './StatusTimeline'
import { LoadDocuments, type DocumentSlot } from './LoadDocuments'
import { LoadActions, LoadNotes } from './LoadActions'
import { LoadAssignment } from './LoadAssignment'
import { NoteComposer } from './NoteComposer'
import { Copyable } from './Copyable'
import { MilesField } from './MilesField'
import { StopAddress } from './StopAddress'
import {
  addNoteAction,
  assignLoadAction,
  setMilesAction,
  cancelLoadAction,
  markDeliveredAction,
  refreshLoadAction,
  setStopAddressAction,
  setStopZoneAction,
  uncancelLoadAction,
} from './actions'
import type {
  LoadBillingStatus,
  LoadOperationalStatus,
} from '@/generated/prisma/client'

// §10 — the load detail screen.
//
// Status stripe per §2 (operational meaning, stated in the header), two badges
// in the two constructions §7.2 requires, stop panels in the STOP's timezone
// with the zone shown (rule 3), documents grouped by type with dashed warning
// placeholders for what is missing at this stage, a notes thread writing
// `Communication` rows, and the timeline rendered from `LoadStatusEvent`.

const ALL_OPERATIONAL: LoadOperationalStatus[] = [
  'AVAILABLE',
  'BOOKED',
  'DISPATCHED',
  'AT_PICKUP',
  'LOADED',
  'IN_TRANSIT',
  'AT_DELIVERY',
  'DELIVERED',
  'POD_RECEIVED',
]

/** The other axis, for the timeline's label map. Both now write events. */
const ALL_BILLING: LoadBillingStatus[] = [
  'UNINVOICED',
  'READY_TO_INVOICE',
  'INVOICED',
  'PARTIALLY_PAID',
  'PAID',
  'DISPUTED',
  'WRITTEN_OFF',
]

const bytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${Math.round(size / 1024)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`

export default async function LoadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { t, locale } = await getLocaleContext()

  const data = await withCurrentOrg('read', 'load', async (tx) => {
    const load = await tx.load.findUnique({
      where: { id },
      include: {
        company: { select: { name: true, timezone: true } },
        customer: { select: { id: true, name: true } },
        truck: { select: { unitNumber: true } },
        driver: { select: { firstName: true, lastName: true } },
        trailer: { select: { unitNumber: true } },
        stops: {
          orderBy: { sequence: 'asc' },
          include: {
            // THE ADDRESS COMES FROM THE FACILITY BOOK when the stop has none
            // of its own. A Relay import writes the facility code and nothing
            // else — the seed's 4,367 rows are where the street lives — and a
            // code is not something a driver can be sent to.
            location: {
              select: {
                timezone: true,
                addressLine1: true,
                city: true,
                state: true,
                postalCode: true,
              },
            },
          },
        },
        accessorials: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            type: true,
            amountCents: true,
            isBillable: true,
          },
        },
      },
    })
    if (!load) return null

    // THE FLEET THIS LOAD COULD BE GIVEN TO, for the assignment panel.
    //
    // Scoped by the load's own company, not the session's whole scope: a load
    // runs under one authority and a truck belongs to one, so offering the
    // other company's fleet would offer an assignment that cannot legally be
    // made. `assertAssignable` would not catch it either — it asks about
    // double-booking, not about authority.
    const [events, documents, notes, trucks, drivers] = await Promise.all([
      tx.loadStatusEvent.findMany({
        where: { loadId: id },
        orderBy: { occurredAt: 'desc' },
        include: { changedBy: { select: { name: true } } },
      }),
      tx.document.findMany({
        where: { loadId: id, deletedAt: null },
        orderBy: { uploadedAt: 'desc' },
        include: { uploadedBy: { select: { name: true } } },
      }),
      tx.communication.findMany({
        where: { loadId: id, type: 'NOTE' },
        orderBy: { occurredAt: 'desc' },
        take: 50,
        include: { user: { select: { name: true } } },
      }),
      tx.truck.findMany({
        where: { deletedAt: null, companyId: load.companyId },
        orderBy: { unitNumber: 'asc' },
        take: 500,
        select: { id: true, unitNumber: true },
      }),
      tx.driver.findMany({
        where: { deletedAt: null, companyId: load.companyId },
        orderBy: { lastName: 'asc' },
        take: 500,
        select: { id: true, firstName: true, lastName: true },
      }),
    ])

    return { load, events, documents, notes, trucks, drivers }
  })

  if (!data) notFound()
  const { load, events, documents, notes, trucks, drivers } = data

  // WHAT THIS SCREEN SHOWS, decided in one place and testable without a
  // browser. Seven display items branch on whether this freight settles
  // directly; they were seven inline reads until `load-detail-view.ts` gave
  // them a name and a test file that reads both answers side by side.
  //
  // The flag is on the LOAD, copied from the customer at booking and never
  // re-read — see the module for why that matters.
  const view = loadDetailView(load)

  // One pair of words for every copy affordance on the screen.
  const copyLabels = { copy: t('loads.copy'), copied: t('loads.copied') }
  const mayUpdate = await currentUserCan('update', 'load')
  const mayUpload = await currentUserCan('create', 'document')

  // §7 and rule 8: a role that cannot see money is not handed money and told
  // not to look. The whole panel — and every figure in it — is absent from a
  // dispatcher's payload, which is what verify-dispatcher asserts by reading
  // the response body rather than the rendered text.
  const maySeeRate = await currentUserCan('read', 'load.financials')
  const maySetRate = await currentUserCan('update', 'load.financials')

  const zone = load.company.timezone
  const stripeTone = load.isCancelled
    ? 'muted'
    : operationalTone(load.operationalStatus)

  // Blank first, and it means "derive it from the state" — the same fallback
  // the row had before anybody touched it.
  const zoneOptions = [
    { value: '', label: t('places.timezoneAuto') },
    ...ZONE_CHOICES.map((choice) => ({ value: choice, label: choice })),
  ]

  // Built only when the role may see it. `accessorials` is selected in the
  // query above for everyone, so this is where it stops for a dispatcher —
  // the payload carries the array, but nothing derived from money reaches the
  // component tree. (Step 2 moves the select itself behind the check.)
  const accessorialRows: AccessorialRow[] = maySeeRate
    ? load.accessorials.map((row) => ({
        id: row.id,
        type: row.type,
        typeLabel: t(`accessorial.${row.type}` as MessageKey),
        amountCents: row.amountCents,
        isBillable: row.isBillable,
      }))
    : []

  const rateMessages = Object.fromEntries(
    (
      [
        'rate.error.badAmount',
        'rate.error.negative',
        'rate.error.notFound',
      ] as MessageKey[]
    ).map((key) => [key, t(key)]),
  )

  // BOTH AXES. The timeline query has no axis filter, and since step 7 the
  // billing axis writes events too — so the label map has to cover them or a
  // reader sees the raw enum. The billing badge beside the load number is
  // already ungated, so the timeline showing the same fact adds no exposure.
  const statusLabels = Object.fromEntries([
    ...ALL_OPERATIONAL.map((status) => [
      status,
      t(operationalLabelKey(status)),
    ]),
    ...ALL_BILLING.map((status) => [status, t(billingLabelKey(status))]),
  ])

  // ITEM 8 — ONE TIMELINE, sorted while the times are still Dates.
  //
  // Notes are `Communication` rows carrying `occurredAt` and a `user`, so they
  // interleave with the status events on the same axis with nothing invented —
  // no migration, no backfill, no entry with a made-up time. The sort happens
  // HERE because by the time an entry reaches the component its `at` is a
  // rendered string, and sorting rendered strings is alphabetical order
  // wearing a chronology's clothes.
  //
  // Both lists arrive `occurredAt: 'desc'` from the query, so this is a merge
  // rather than a sort; it is written as a sort anyway, because relying on two
  // queries staying ordered the same way is the kind of coupling that survives
  // exactly until somebody adds a `take`.
  const statusEntries: TimelineEntry[] = events.map((event) => ({
    kind: 'status' as const,
    id: event.id,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    outcome: event.outcome,
    source: event.source,
    at:
      renderStopTime(event.occurredAt, null, {
        fallbackZone: zone,
        locale,
      })?.text ?? '',
    by: event.changedBy?.name ?? null,
    // Ours gets translated; a human's is shown exactly as typed. §12: the
    // system's own words are chrome and belong in the reader's language; a
    // dispatcher's sentence is evidence and belongs verbatim.
    note: event.note && isMessageKey(event.note) ? t(event.note) : event.note,
  }))

  const noteEntries: TimelineEntry[] = notes.map((note) => ({
    kind: 'note' as const,
    id: note.id,
    at:
      renderStopTime(note.occurredAt, null, {
        fallbackZone: zone,
        locale,
      })?.text ?? '',
    by: note.user?.name ?? null,
    body: note.body,
  }))

  // Newest first, sorted while the times are still Dates. `newestFirst` is
  // tested in tests/load-timeline.test.ts, including the case where text order
  // and clock order disagree.
  const timeline: TimelineEntry[] = newestFirst(
    events.map((event, index) => ({
      at: event.occurredAt,
      value: statusEntries[index]!,
    })),
    view.notesInTimeline
      ? notes.map((note, index) => ({
          at: note.occurredAt,
          value: noteEntries[index]!,
        }))
      : [],
  )

  // §7.8 — grouped by type, and "required" means required AT THIS STAGE. A
  // rate confirmation is always expected; a POD only once the load is
  // delivered, because before that its absence is not a problem.
  const podRequired =
    load.operationalStatus === 'DELIVERED' ||
    load.operationalStatus === 'POD_RECEIVED'

  // FINISHED, for the purpose of whose clock is operative. The same two
  // statuses `podRequired` uses: a load with a POD expected is a load whose
  // stops have been driven.
  const delivered = podRequired

  const slotFor = (
    type: string,
    label: string,
    required: boolean,
  ): DocumentSlot => ({
    type,
    label,
    required,
    documents: documents
      .filter((document) => document.type === type)
      .map((document) => ({
        id: document.id,
        type: document.type,
        filename: document.filename,
        size: bytes(document.sizeBytes),
        uploadedAt:
          renderStopTime(document.uploadedAt, null, {
            fallbackZone: zone,
            locale,
          })?.text ?? '',
        uploadedBy: document.uploadedBy?.name ?? null,
      })),
  })

  const slots: DocumentSlot[] = [
    slotFor('RATE_CONFIRMATION', t('documents.type.RATE_CONFIRMATION'), true),
    slotFor('POD', t('documents.type.POD'), podRequired),
    slotFor('BOL', t('documents.type.BOL'), false),
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <div className="flex items-center gap-z3">
          {/* §2 — the 3px stripe on the leading edge, never animated. */}
          <span
            aria-hidden
            className={`h-z5 w-[3px] ${TONE_STRIPE[stripeTone]}`}
          />
          <h1 className="text-lg font-medium text-ink">
            {view.copyableIdentifiers ? (
              <Copyable
                value={load.loadNumber}
                className="font-mono"
                labels={copyLabels}
              />
            ) : (
              <span className="font-mono">{load.loadNumber}</span>
            )}
            {/* THE NUMBER DISPATCH QUOTES TO AMAZON, in the header where it is
             * read from rather than buried in the summary list. Our load
             * number is what this office calls the freight; the reference is
             * what the broker calls it, and a phone call about a trip starts
             * with theirs. Dimmer, because it identifies the same load.
             *
             * ITEM 1: and on Amazon freight the reference IS the Trip ID —
             * the string that gets pasted into Relay's search — so it is the
             * one identifier on this screen most worth not retyping. */}
            {load.referenceNumber === null ? null : (
              <span className="ms-z2 font-mono text-sm text-ink-2" dir="ltr">
                · {t('loads.column.reference')}{' '}
                {view.copyableIdentifiers ? (
                  <Copyable
                    value={load.referenceNumber}
                    className="font-mono"
                    labels={copyLabels}
                  />
                ) : (
                  load.referenceNumber
                )}
              </span>
            )}
          </h1>
          {/* §7.2 — operational FILLED, billing OUTLINED, side by side. */}
          <StatusBadge
            tone={operationalTone(load.operationalStatus)}
            label={t(operationalLabelKey(load.operationalStatus))}
          />
          <StatusBadge
            tone={billingTone(load.billingStatus)}
            variant="outlined"
            label={t(billingLabelKey(load.billingStatus))}
          />
          {load.isCancelled ? (
            <StatusBadge tone="muted" label={t('loads.cancelled')} />
          ) : null}
        </div>

        <div className="flex items-center gap-z3">
          <p className="text-xs text-ink-3">{t('loads.stripeMeaning')}</p>
          {mayUpdate ? (
            <LoadActions
              isCancelled={load.isCancelled}
              canDeliver={
                load.operationalStatus !== 'POD_RECEIVED' &&
                load.operationalStatus !== 'DELIVERED'
              }
              markDelivered={markDeliveredAction.bind(null, id)}
              cancel={cancelLoadAction.bind(null, id)}
              uncancel={uncancelLoadAction.bind(null, id)}
              labels={{
                markDelivered: t('loads.markDelivered'),
                cancel: t('ref.cancel'),
                cancelTitle: t('loads.cancelTitle'),
                cancelBody: t('loads.cancelBody'),
                reason: t('loads.cancelReason'),
                confirmCancel: t('loads.cancel'),
                uncancel: t('loads.uncancel'),
                close: t('ref.cancel'),
              }}
            />
          ) : null}
        </div>
      </div>

      <div
        className={`min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5 ${load.isCancelled ? 'opacity-60' : ''}`}
      >
        <div className="grid max-w-[1100px] gap-z4 lg:grid-cols-2">
          <section className="rounded-card border border-border bg-surface p-z4">
            <h2 className="text-md font-medium text-ink">
              {t('loads.summary')}
            </h2>
            <dl className="mt-z3 grid grid-cols-2 gap-x-z4 gap-y-z2 text-sm">
              <dt className="text-ink-2">{t('ref.authority')}</dt>
              <dd className="text-ink">{load.company.name}</dd>
              <dt className="text-ink-2">{t('loads.column.customer')}</dt>
              <dd className="text-ink">
                <Link
                  href={`/brokers/${load.customer.id}`}
                  className="hover:text-accent"
                >
                  {load.customer.name}
                </Link>
              </dd>
              <dt className="text-ink-2">{t('loads.column.truck')}</dt>
              {/* ITEM 1 — the unit number goes onto a gate ticket and into
               * Relay; the driver name below it does not. */}
              <dd className="font-mono text-ink">
                {load.truck?.unitNumber == null ? (
                  '—'
                ) : view.copyableIdentifiers ? (
                  <Copyable value={load.truck.unitNumber} labels={copyLabels} />
                ) : (
                  load.truck.unitNumber
                )}
              </dd>
              <dt className="text-ink-2">{t('loads.column.driver')}</dt>
              <dd className="text-ink">
                {load.driver
                  ? `${load.driver.lastName}, ${load.driver.firstName}`
                  : '—'}
              </dd>
              {/* ITEM 4, RELOCATED. Editable here rather than in the rate
               * panel: miles are operational and this panel is not behind
               * `load.financials`, so the dispatcher the field was asked for
               * can actually reach it. */}
              <dt className="text-ink-2">{t('loads.miles')}</dt>
              <dd className="text-end font-mono text-ink">
                {view.editMiles && mayUpdate ? (
                  <MilesField
                    dispatchedMiles={load.dispatchedMiles}
                    save={setMilesAction.bind(null, id)}
                    locale={locale}
                    labels={{
                      miles: t('loads.miles'),
                      edit: t('loads.editValue'),
                      saving: t('loads.assignSaving'),
                      failed: t('loads.saveFailed'),
                    }}
                  />
                ) : load.dispatchedMiles === null ? (
                  '—'
                ) : (
                  load.dispatchedMiles.toLocaleString(locale)
                )}
              </dd>
            </dl>
            {load.isCancelled && load.cancelReason ? (
              <p className="mt-z3 rounded-control border border-danger bg-danger-soft px-z2 py-z1 text-sm text-danger">
                {load.cancelReason}
              </p>
            ) : null}
          </section>

          {/* ASSIGNMENT, ON AMAZON LOADS. `load.directSettled` is the whole
           * discriminator for this redesign — copied from the customer when the
           * load was booked and never re-read, so freight keeps the screen it
           * was booked under even if the broker's terms change next year.
           *
           * BROKER FREIGHT HAS THE IDENTICAL GAP and does not get this panel,
           * because the ruling scoped the redesign to direct-settled loads and
           * "Werner and broker freight keep the full screen". Lifting the gate
           * is deleting one condition; it is flagged rather than assumed. */}
          {view.showAssignment && mayUpdate ? (
            <LoadAssignment
              trucks={trucks.map((truck) => ({
                value: truck.id,
                label: truck.unitNumber,
              }))}
              drivers={drivers.map((driver) => ({
                value: driver.id,
                label: `${driver.lastName}, ${driver.firstName}`,
              }))}
              truckId={load.truckId}
              driverId={load.driverId}
              disabled={load.isCancelled}
              assign={assignLoadAction.bind(null, id)}
              labels={{
                title: t('loads.assignment'),
                truck: t('loads.column.truck'),
                driver: t('loads.column.driver'),
                unassigned: t('loads.unassigned'),
                save: t('loads.assignSave'),
                saving: t('loads.assignSaving'),
              }}
            />
          ) : null}

          <section className="rounded-card border border-border bg-surface p-z4">
            <h2 className="text-md font-medium text-ink">{t('loads.stops')}</h2>
            {mayUpdate ? (
              <p className="mt-z1 text-xs text-ink-3">
                {t('places.timezoneHint')}
              </p>
            ) : null}
            <ol className="mt-z3 flex flex-col gap-z3">
              {load.stops.map((stop) => {
                // Rule 3. In the STOP's zone, with the abbreviation shown.
                // ACTUALS ARE OPERATIVE ON A FINISHED TRIP. The rule lives in
                // stop-actuals.ts so this screen and the settlement document
                // cannot come to different conclusions about the same stop.
                const shown = shownStopTime(stop, { delivered })
                const when = renderStopTime(shown.at, stop.state, {
                  fallbackZone: zone,
                  locale,
                  zone: stop.location?.timezone ?? null,
                })
                // The plan, rendered only when it says something the actual
                // does not — and always labelled, never bare.
                const planned = renderStopTime(shown.scheduledAt, stop.state, {
                  fallbackZone: zone,
                  locale,
                  zone: stop.location?.timezone ?? null,
                })
                const departed = renderStopTime(shown.departedAt, stop.state, {
                  fallbackZone: zone,
                  locale,
                  zone: stop.location?.timezone ?? null,
                })
                const lateness = latenessLabel(shown.latenessMinutes, {
                  late: t('stop.late'),
                  early: t('stop.early'),
                })
                // The stop's own address wins; the facility book fills the
                // silence. `formatAddress` returns null rather than '' so
                // "has none" is distinguishable from "has an empty one".
                const address =
                  formatAddress(stop) ?? formatAddress(stop.location)
                return (
                  <li
                    key={stop.id}
                    className="border-b border-border pb-z2 last:border-b-0"
                  >
                    <div className="flex items-baseline justify-between gap-z2">
                      {/* ITEM 1 (round 2) — THE ORDER, NOT JUST THE KIND.
                       * A Relay trip runs six to eight stops and
                       * "PICKUP"/"DELIVERY" alone does not say which comes
                       * third. Broker freight is two stops, where the labels
                       * are the order. */}
                      <span className="text-xs uppercase tracking-[0.04em] text-ink-2">
                        {view.numberedStops
                          ? t('loads.stopN').replace(
                              '{n}',
                              String(stop.sequence),
                            ) + ` · ${t(`stop.${stop.type}` as never)}`
                          : t(`stop.${stop.type}` as never)}
                      </span>
                      <span className="flex items-baseline gap-z2">
                        {/* A PLAN IS NEVER SHOWN AS A RECORD. On a delivered
                         * load its neighbours are actuals, which is exactly
                         * when an unlabelled plan reads as one. */}
                        {shown.at && !shown.isActual ? (
                          <span className="text-xs text-ink-3">
                            {t('stop.scheduled')}
                          </span>
                        ) : null}
                        <span
                          className="font-mono text-sm text-ink"
                          title={when?.zone ?? zone}
                        >
                          {when?.text ?? '—'}
                        </span>
                      </span>
                    </div>
                    {/* ITEM 1 — THE FACILITY CODE, which is what gets typed
                     * into Relay to find a dock, and the leg's own Load ID
                     * beside it, which is what Relay calls this segment.
                     * Both are carried to another system; the city under
                     * them is read, so it stays plain text. */}
                    <p className="mt-z1 flex flex-wrap items-baseline gap-z2 text-base text-ink">
                      {view.copyableIdentifiers && stop.name ? (
                        <Copyable value={stop.name} labels={copyLabels} />
                      ) : (
                        (stop.name ??
                        [stop.city, stop.state].filter(Boolean).join(', '))
                      )}
                      {view.copyableIdentifiers && stop.referenceNumber ? (
                        <Copyable
                          value={stop.referenceNumber}
                          className="font-mono text-sm text-ink-2"
                          labels={copyLabels}
                        />
                      ) : null}
                    </p>
                    {/* THE ADDRESS, UNDER THE NAME A DISPATCHER RECOGNISES.
                     * The stop's own address first — somebody typed or
                     * corrected it — and the linked facility's only when the
                     * stop has none, which is every Relay-imported stop.
                     *
                     * TEXT, WITH AN EDIT BEHIND IT (item 4, round 2). An
                     * address that resolved from the book is already correct;
                     * eight stops of four input boxes made the screen look
                     * like an abandoned form and buried the lane a dispatcher
                     * came to read.
                     *
                     * AND ABSENCE LOOKS LIKE ABSENCE (item 2). A facility with
                     * no street used to render as blank space, which is a
                     * driver being sent to a code nobody has an address for
                     * with the screen saying nothing. */}
                    {view.flagMissingAddress ? (
                      <StopAddress
                        shown={address}
                        missing={address === null}
                        value={{
                          addressLine1: stop.addressLine1 ?? '',
                          city: stop.city ?? '',
                          state: stop.state ?? '',
                          postalCode: stop.postalCode ?? '',
                        }}
                        fallback={{
                          addressLine1: stop.location?.addressLine1 ?? '',
                          city: stop.location?.city ?? '',
                          state: stop.location?.state ?? '',
                          postalCode: stop.location?.postalCode ?? '',
                        }}
                        mayEdit={mayUpdate}
                        save={setStopAddressAction.bind(null, id, stop.id)}
                        labels={{
                          street: t('loads.stopStreet'),
                          city: t('loads.stopCity'),
                          state: t('loads.stopState'),
                          zip: t('loads.stopZip'),
                          edit: t('loads.editAddress'),
                          save: t('ref.save'),
                          cancel: t('ref.cancel'),
                          saving: t('loads.assignSaving'),
                          missing: t('loads.noAddress'),
                        }}
                      />
                    ) : address !== null && address !== stop.name ? (
                      // Broker freight, unchanged: suppressed when it would
                      // only repeat the line above — a stop typed as
                      // "Chicago, IL" has that as its name AND its whole
                      // address, and printing it twice is noise.
                      <p className="mt-z1 text-sm text-ink-2" dir="ltr">
                        {address}
                      </p>
                    ) : null}
                    {/* THE PLAN BENEATH THE RECORD, small, for reference —
                     * and the lateness Relay itself shows, derived here from
                     * the two columns rather than stored as a third. */}
                    {planned ? (
                      <p className="mt-z1 text-xs text-ink-3">
                        {t('stop.scheduled')} {planned.text}
                        {lateness ? ` · ${lateness}` : ''}
                      </p>
                    ) : null}
                    {departed ? (
                      <p className="mt-z1 text-xs text-ink-3">
                        {t('stop.departed')} {departed.text}
                      </p>
                    ) : null}
                    {when?.approximate ? (
                      <p className="mt-z1 text-xs text-ink-3">
                        {t('loads.zoneApprox').replace('{zone}', when.zone)}
                      </p>
                    ) : null}
                    {/* ITEM 3 — NO ZONE PICKER ON AMAZON FREIGHT.
                     *
                     * "America/Boise" is not a question a dispatcher can
                     * answer, and on Relay freight it is not a question worth
                     * asking: the export names the facility, the facility
                     * carries its zone, and the offset column cross-checks it.
                     * The control stays on broker freight, where a dock is
                     * often typed once and never seen again. */}
                    {mayUpdate && view.showStopTimezone && stop.locationId ? (
                      <form
                        action={setStopZoneAction.bind(
                          null,
                          id,
                          stop.locationId,
                        )}
                        className="mt-z2 flex items-center gap-z2"
                      >
                        <Select
                          name="timezone"
                          label={t('places.timezone')}
                          labelHidden
                          defaultValue={stop.location?.timezone ?? ''}
                          options={zoneOptions}
                        />
                        <Button type="submit" variant="ghost" size="compact">
                          {t('ref.save')}
                        </Button>
                      </form>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          </section>
          {/* ITEM 4 — LINEHAUL ALONE.
           *
           * Dispatch read the second money box as a second rate and asked
           * which one Relay pays; Relay pays one figure. The COLUMN stays and
           * settlements still sum it — this hides an input, it does not change
           * what a load can carry.
           *
           * MILES ARE NOT HERE. They were, for one commit, and that put an
           * operational number behind a money gate: a dispatcher without
           * `load.financials` never sees this panel, so the field was
           * invisible to exactly the person the request was for. It lives in
           * the summary now, where it already rendered.
           *
           * ITEM 5 — TONU ONLY. It is the one accessorial Relay pays; the
           * rest are broker vocabulary, and a list of twelve is how somebody
           * bills Amazon for a lumper it will never reimburse. Filtered from
           * the shared list rather than kept as a second one, so a type added
           * upstream reaches both screens or neither. */}
          {maySeeRate ? (
            <RatePanel
              loadId={id}
              linehaulCents={load.linehaulCents}
              fuelSurchargeCents={load.fuelSurchargeCents}
              showFuelSurcharge={view.showFuelSurcharge}
              accessorials={accessorialRows}
              mayEdit={maySetRate}
              accessorialTypes={accessorialChoicesFor(
                ACCESSORIAL_TYPES,
                load,
              ).map((type) => ({
                value: type,
                label: t(`accessorial.${type}` as MessageKey),
              }))}
              locale={locale}
              translate={rateMessages}
              labels={{
                title: t('rate.title'),
                linehaul: t('rate.linehaul'),
                fuelSurcharge: t('rate.fuelSurcharge'),
                accessorials: t('rate.accessorials'),
                total: t('rate.total'),
                save: t('rate.save'),
                saved: t('rate.saved'),
                add: t('rate.addAccessorial'),
                amount: t('rate.amount'),
                billable: t('rate.billable'),
                remove: t('rate.remove'),
                none: t('rate.none'),
              }}
            />
          ) : null}

          {/* ITEM 6 — NO DOCUMENTS PANEL ON AMAZON FREIGHT. Drivers upload
           * everything into Relay, so a Rate con / POD / BOL prompt here asks
           * for paperwork that by agreement lives somewhere else.
           *
           * SAFE ONLY BECAUSE OF THE TRANSITION RULING. `podConfirmed` fired
           * from exactly one place — a POD attaching — and BOTH driver
           * settlement and the ACH reconciliation queue select on
           * POD_RECEIVED. Removing this panel on its own would have stopped
           * driver pay for every Amazon load, silently, with the loads looking
           * finished on every screen. `transitionOperational` now fires the
           * POD when a direct-settled load reaches Delivered. */}
          {view.showDocuments ? (
            <LoadDocuments
              loadId={id}
              slots={slots}
              mayUpload={mayUpload && !load.isCancelled}
              onUploaded={refreshLoadAction.bind(null, id)}
              labels={{
                title: t('loads.documents'),
                missing: t('loads.documentMissing'),
                upload: t('loads.documentUpload'),
                preparing: t('upload.preparing'),
                uploading: t('upload.uploading'),
                done: t('upload.done'),
                failed: t('upload.failed'),
                none: t('loads.documentNone'),
                by: t('loads.by'),
                downloadFailed: t('documents.downloadFailed'),
              }}
            />
          ) : null}

          <StatusTimeline
            entries={timeline}
            {...(view.notesInTimeline && mayUpdate
              ? {
                  composer: (
                    <NoteComposer
                      add={addNoteAction.bind(null, id)}
                      labels={{
                        label: t('loads.notes'),
                        placeholder: t('loads.notePlaceholder'),
                        post: t('loads.notePost'),
                      }}
                    />
                  ),
                }
              : {})}
            statusLabels={statusLabels}
            labels={{
              title: t('loads.timeline'),
              manual: t('loads.source.manual'),
              automatic: t('loads.source.automatic'),
              driverPortal: t('loads.source.driverPortal'),
              integration: t('loads.source.integration'),
              refused: t('loads.source.refused'),
              refusedBody: t('loads.refusedBody'),
              by: t('loads.by'),
              empty: t('loads.timelineEmpty'),
            }}
          />

          {/* ITEM 8 — the separate Notes panel is gone on Amazon loads; its
           * entries are in the timeline above and its box is inside that
           * section. Broker freight keeps the panel, so `LoadNotes` stays. */}
          {view.notesInTimeline ? null : (
            <div className="lg:col-span-2">
              <LoadNotes
                notes={notes.map((note) => ({
                  id: note.id,
                  body: note.body,
                  at:
                    renderStopTime(note.occurredAt, null, {
                      fallbackZone: zone,
                      locale,
                    })?.text ?? '',
                  by: note.user?.name ?? null,
                }))}
                add={addNoteAction.bind(null, id)}
                labels={{
                  title: t('loads.notes'),
                  placeholder: t('loads.notePlaceholder'),
                  post: t('loads.notePost'),
                  empty: t('loads.notesEmpty'),
                }}
              />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

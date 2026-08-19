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
import { renderStopTime, ZONE_CHOICES } from '@/lib/stop-time'
import { isMessageKey, type MessageKey } from '@/lib/i18n'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { RatePanel, type AccessorialRow } from './RatePanel'
import { StatusTimeline, type TimelineEvent } from './StatusTimeline'
import { LoadDocuments, type DocumentSlot } from './LoadDocuments'
import { LoadActions, LoadNotes } from './LoadActions'
import {
  addNoteAction,
  cancelLoadAction,
  markDeliveredAction,
  refreshLoadAction,
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

const ACCESSORIAL_TYPES = [
  'DETENTION',
  'LAYOVER',
  'TONU',
  'LUMPER',
  'EXTRA_STOP',
  'DRIVER_ASSIST',
  'REDELIVERY',
  'STORAGE',
  'FUEL_ADVANCE_FEE',
  'OTHER',
] as const

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

    const [events, documents, notes] = await Promise.all([
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
    ])

    return { load, events, documents, notes }
  })

  if (!data) notFound()
  const { load, events, documents, notes } = data

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

  const timeline: TimelineEvent[] = events.map((event) => ({
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

  // §7.8 — grouped by type, and "required" means required AT THIS STAGE. A
  // rate confirmation is always expected; a POD only once the load is
  // delivered, because before that its absence is not a problem.
  const podRequired =
    load.operationalStatus === 'DELIVERED' ||
    load.operationalStatus === 'POD_RECEIVED'

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
            <span className="font-mono">{load.loadNumber}</span>
            {/* THE NUMBER DISPATCH QUOTES TO AMAZON, in the header where it is
             * read from rather than buried in the summary list. Our load
             * number is what this office calls the freight; the reference is
             * what the broker calls it, and a phone call about a trip starts
             * with theirs. Dimmer, because it identifies the same load. */}
            {load.referenceNumber === null ? null : (
              <span className="ms-z2 font-mono text-sm text-ink-2" dir="ltr">
                · {t('loads.column.reference')} {load.referenceNumber}
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
                cancel: t('loads.cancel'),
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
              <dd className="font-mono text-ink">
                {load.truck?.unitNumber ?? '—'}
              </dd>
              <dt className="text-ink-2">{t('loads.column.driver')}</dt>
              <dd className="text-ink">
                {load.driver
                  ? `${load.driver.lastName}, ${load.driver.firstName}`
                  : '—'}
              </dd>
              <dt className="text-ink-2">{t('loads.miles')}</dt>
              <dd className="text-end font-mono text-ink">
                {load.dispatchedMiles === null
                  ? '—'
                  : load.dispatchedMiles.toLocaleString(locale)}
              </dd>
            </dl>
            {load.isCancelled && load.cancelReason ? (
              <p className="mt-z3 rounded-control border border-danger bg-danger-soft px-z2 py-z1 text-sm text-danger">
                {load.cancelReason}
              </p>
            ) : null}
          </section>

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
                const when = renderStopTime(stop.scheduledAt, stop.state, {
                  fallbackZone: zone,
                  locale,
                  zone: stop.location?.timezone ?? null,
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
                      <span className="text-xs uppercase tracking-[0.04em] text-ink-2">
                        {t(`stop.${stop.type}` as never)}
                      </span>
                      <span
                        className="font-mono text-sm text-ink"
                        title={when?.zone ?? zone}
                      >
                        {when?.text ?? '—'}
                      </span>
                    </div>
                    <p className="mt-z1 text-base text-ink">
                      {stop.name ??
                        [stop.city, stop.state].filter(Boolean).join(', ')}
                    </p>
                    {/* THE ADDRESS, UNDER THE NAME A DISPATCHER RECOGNISES.
                     * The stop's own address first — somebody typed or
                     * corrected it — and the linked facility's only when the
                     * stop has none, which is every Relay-imported stop.
                     *
                     * Suppressed when it would only repeat the line above: a
                     * stop typed as "Chicago, IL" has that as its name AND as
                     * its whole address, and printing it twice is noise. */}
                    {address !== null && address !== stop.name ? (
                      <p className="mt-z1 text-sm text-ink-2" dir="ltr">
                        {address}
                      </p>
                    ) : null}
                    {when?.approximate ? (
                      <p className="mt-z1 text-xs text-ink-3">
                        {t('loads.zoneApprox').replace('{zone}', when.zone)}
                      </p>
                    ) : null}
                    {/* The explicit zone is set HERE, where the guess is
                     * admitted — see the note on setStopZoneAction. Blank
                     * means "derive it", so the fallback stays reachable. */}
                    {mayUpdate && stop.locationId ? (
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

          {maySeeRate ? (
            <RatePanel
              loadId={id}
              linehaulCents={load.linehaulCents}
              fuelSurchargeCents={load.fuelSurchargeCents}
              accessorials={accessorialRows}
              mayEdit={maySetRate}
              accessorialTypes={ACCESSORIAL_TYPES.map((type) => ({
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

          <StatusTimeline
            events={timeline}
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
        </div>
      </div>
    </>
  )
}

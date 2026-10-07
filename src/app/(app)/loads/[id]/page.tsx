import { notFound } from 'next/navigation'
import { teamMateFor } from '@/lib/team'
import Link from 'next/link'
import { assignableDriver, ASSIGNABLE_TRUCK } from '@/lib/driver-availability'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  billingLabelKey,
  billingTone,
  operationalLabelKey,
  operationalTone,
  TONE_STRIPE,
} from '@/lib/status'
import type { StatusTone } from '@/lib/status'
import { formatAddress } from '@/lib/locations'
import { attributionLabel, stopAttribution } from '@/lib/stop-attribution'
import { milesSummary } from '@/lib/load-miles'
import {
  deliveryFactsFromStops,
  onTimeFrom,
  type OnTime,
} from '@/lib/dispatch-fields'
import { pipelineStage } from '@/lib/load-pipeline'
import { isAssigned } from '@/lib/load-readiness'
import {
  activityEntries,
  humaniseField,
  mergeActivity,
} from '@/lib/load-activity'
import { documentTypeLabels } from '@/lib/document-types'
import { Prisma } from '@/generated/prisma/client'
import {
  ACCESSORIAL_TYPES,
  accessorialChoicesFor,
  loadDetailView,
} from '@/lib/load-detail-view'
import { renderStopTime, ZONE_CHOICES } from '@/lib/stop-time'
import {
  dwellLabel,
  dwellMinutes,
  latenessLabel,
  shownStopTime,
} from '@/lib/stop-actuals'
import { isMessageKey, type MessageKey } from '@/lib/i18n'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { RatePanel, type AccessorialRow } from './RatePanel'
import { FactoringPanel } from './FactoringPanel'
import { PaymentTypePanel } from './PaymentTypePanel'
import { setPaymentTypeAction } from './payment-type-actions'
import { PAYMENT_TYPES } from '@/lib/payment-types'
import { filePacketAction, markFactoredPaidAction } from './factoring-actions'
import { filingStateFor } from '@/lib/factoring-filing'
import { LoadDocuments, type DocumentSlot } from './LoadDocuments'
import { LoadActions } from './LoadActions'
import { LoadAssignment } from './LoadAssignment'
import { NoteComposer } from './NoteComposer'
import { Copyable } from './Copyable'
import { MilesField } from './MilesField'
import { StopAddress } from './StopAddress'
import { StopsTable, type StopRow } from './StopsTable'
import { MilesSummary } from './MilesSummary'
import { PipelineStrip } from './PipelineStrip'
import { LoadFacts, type Fact } from './LoadFacts'
import { ActivityTimeline } from './ActivityTimeline'
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

/**
 * What every audit read selects. One list, so two queries against the same
 * table cannot drift into returning differently shaped rows.
 */
const AUDIT_FIELDS = {
  id: true,
  createdAt: true,
  action: true,
  entityType: true,
  entityId: true,
  userAgent: true,
  changes: true,
  user: { select: { name: true } },
} as const

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
  'CLOSED_IN_DATATRUCK',
]

/**
 * How many audit rows the Activity panel fetches.
 *
 * A WINDOW, AND THE PANEL SAYS SO WHEN IT IS FULL. One more than this is
 * fetched purely to learn whether older rows exist; the extra row is never
 * rendered. Without that, "the oldest thing that happened" and "the oldest
 * thing we fetched" render as the same sentence — the mistake that split the
 * stop-attribution query out of this one.
 */
const ACTIVITY_WINDOW = 50

const bytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${Math.round(size / 1024)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`

/**
 * SUCCESS, DANGER, MUTED — and muted is the interesting one.
 *
 * `unknown` is not a mild failure. It is the absence of a measurement, and
 * a warning tone would read as "nearly late" to somebody scanning the
 * header. Muted says nobody recorded it, which is what happened.
 */
const ON_TIME_TONE: Record<OnTime, StatusTone> = {
  on_time: 'success',
  late: 'danger',
  unknown: 'muted',
}

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
        // ── IDS ONLY, SO THE AUDIT FILTER HAS THEM IN TIME ──────────────
        //
        // `Document.deletedAt` records THAT a document was removed and there is
        // no `deletedBy` column, so the actor comes from the audit row — and an
        // `AuditLog` row is found by `entityType` and `entityId`, with no
        // `loadId` to filter on. The ids therefore have to exist BEFORE the
        // `Promise.all` below, which is exactly why `stopIds` is read off this
        // query too.
        //
        // NOT A NINTH QUERY: `relationJoins` is on app-wide, so this is one
        // more lateral join on a query that already joins stops and
        // accessorials. The full rows are still read once, in the
        // `Promise.all`.
        documents: { select: { id: true } },
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
    const stopIds = load.stops.map((stop) => stop.id)
    const documentIds = load.documents.map((document) => document.id)

    const [events, documents, notes, clockWrites, auditRows, trucks, drivers] =
      await Promise.all([
        tx.loadStatusEvent.findMany({
          where: { loadId: id },
          orderBy: { occurredAt: 'desc' },
          include: { changedBy: { select: { name: true } } },
        }),
        // DELETED ONES TOO, AND FILTERED IN MEMORY BELOW (§7.10).
        //
        // This had `deletedAt: null`, which was right for the Documents panel
        // and wrong for a LOG: a document somebody removed was still uploaded,
        // and a history that drops it answers "what happened to this load" with
        // the one event most likely to be asked about missing.
        //
        // ONE QUERY STILL. `visibleDocuments` below is this list narrowed, so
        // the panel sees exactly what it saw before and the timeline sees all
        // of it. Widening the filter rather than adding a second read keeps the
        // screen at eight queries.
        tx.document.findMany({
          where: { loadId: id },
          orderBy: { uploadedAt: 'desc' },
          include: { uploadedBy: { select: { name: true } } },
        }),
        tx.communication.findMany({
          where: { loadId: id, type: 'NOTE' },
          orderBy: { occurredAt: 'desc' },
          take: 50,
          include: { user: { select: { name: true } } },
        }),

        // ── ATTRIBUTION'S ROWS: THE ONES THAT TOUCHED A CLOCK, HOWEVER OLD ───
        //
        // A SEPARATE FETCH BECAUSE THE NEED IS DIFFERENT, and the difference is
        // not cosmetic. From a truncated window, a stop whose check-in was
        // written before the last 200 events renders as an em dash — which reads
        // as "nobody is recorded" and actually means "we did not look far
        // enough". A limit that renders as a confident answer is the failure this
        // codebase keeps flagging, so this query is bounded by the QUESTION
        // rather than by a row count: only writes that set `arrivedAt` or
        // `departedAt`, and all of them.
        //
        // `path` + `not: DbNull` asks whether the key is present in the JSON at
        // all. A stop is written a handful of times in its life, so this is a
        // small result however old the load.
        //
        // THE PERMISSION FILTER IS STILL SHARED. Splitting the FETCH does not
        // split the rule: `activityEntries` remains the one place that decides
        // what a role may read, and `tests/load-activity.test.ts` pins that a
        // money row is dropped from the timeline while a stop's `arrivedAt`
        // attribution survives the same pass.
        tx.auditLog.findMany({
          where: {
            entityType: 'LoadStop',
            entityId: { in: stopIds },
            OR: [
              { changes: { path: ['arrivedAt'], not: Prisma.DbNull } },
              { changes: { path: ['departedAt'], not: Prisma.DbNull } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          select: AUDIT_FIELDS,
        }),
        // ITEM 8 — EVERY AUDITED WRITE TO THIS LOAD AND ITS STOPS.
        //
        // Deliberately wider than the attribution fetch above, which asks only
        // about two clock fields: this is the whole history of the row. What
        // may be READ from it is `activityEntries`' decision and not this
        // query's — the money filter lives in one place.
        tx.auditLog.findMany({
          where: {
            OR: [
              { entityType: 'Load', entityId: id },
              { entityType: 'LoadStop', entityId: { in: stopIds } },
              // THE DOCUMENTS, FOR WHO DELETED ONE. `Document` has no
              // `deletedBy`, so the actor on a deletion row is only here.
              // `activityEntries` drops these from the field-edit stream by the
              // same money filter it applies to everything else; what
              // `mergeActivity` takes from them is the actor.
              { entityType: 'Document', entityId: { in: documentIds } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: ACTIVITY_WINDOW + 1,
          select: AUDIT_FIELDS,
        }),
        // ── WHOEVER IS ALREADY ON IT STAYS IN THE LIST ──────────────────
        //
        // `defaultValue` on a select whose options do not contain it falls
        // back to the first option — the blank one — and the next save
        // UNASSIGNS the load without anybody touching that field. A driver
        // going off duty mid-load makes that ordinary rather than rare,
        // which is why it is fixed in the same change that made it likely.
        //
        // The predicate still answers "who may be given work": these two
        // arms mean "assignable, or already here", and assigning somebody
        // else is still refused by `assertAssignable`.
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
              {
                id: {
                  in: [load.driverId, load.coDriverId].filter(
                    (id): id is string => id !== null,
                  ),
                },
              },
            ],
          },
          orderBy: { lastName: 'asc' },
          take: 500,
          select: { id: true, firstName: true, lastName: true },
        }),
      ])

    return {
      load,
      events,
      documents,
      notes,
      clockWrites,
      auditRows,
      trucks,
      drivers,
      // THE SECOND SEAT, OFFERED (§6.4 part 3): the driver's team-mate, when
      // they have one AND the picker can save them. Read after the picker so
      // the control never names someone it would then refuse.
      teamMate: load.driverId ? await teamMateFor(tx, load.driverId) : null,
    }
  })

  if (!data) notFound()
  const {
    load,
    events,
    documents,
    notes,
    clockWrites,
    auditRows,
    trucks,
    drivers,
    teamMate,
  } = data
  const offeredMate =
    teamMate && drivers.some((driver) => driver.id === teamMate.id)
      ? teamMate
      : null

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

  // THE HEADER'S FOUR FACTS. Every one is ungated — see LoadFacts for why
  // that is a rule about the strip rather than a property of these four.
  const headerFacts: Fact[] = [
    { label: t('ref.authority'), value: load.company.name },
    {
      label: t('loads.column.customer'),
      value: (
        <Link
          href={`/brokers/${load.customer.id}`}
          className="hover:text-accent"
        >
          {load.customer.name}
        </Link>
      ),
    },
    {
      // ITEM 1 — the unit number goes onto a gate ticket and into Relay; the
      // driver name beside it does not.
      label: t('loads.column.truck'),
      value:
        load.truck?.unitNumber == null ? null : view.copyableIdentifiers ? (
          <Copyable
            value={load.truck.unitNumber}
            className="font-mono"
            labels={copyLabels}
          />
        ) : (
          <span className="font-mono">{load.truck.unitNumber}</span>
        ),
    },
    {
      label: t('loads.column.driver'),
      value: load.driver
        ? `${load.driver.lastName}, ${load.driver.firstName}`
        : null,
    },
  ]

  const mayUpdate = await currentUserCan('update', 'load')
  const mayUpload = await currentUserCan('create', 'document')

  // §7 and rule 8: a role that cannot see money is not handed money and told
  // not to look. The whole panel — and every figure in it — is absent from a
  // dispatcher's payload, which is what verify-dispatcher asserts by reading
  // the response body rather than the rendered text.
  const maySeeRate = await currentUserCan('read', 'load.financials')
  const maySetRate = await currentUserCan('update', 'load.financials')

  // MONEY §7 — the four-piece question, asked in its own read.
  //
  // NOT FOLDED INTO THE PAGE'S `data` QUERY. That one runs behind `load:read`,
  // which a dispatcher holds; this is money, and a role without
  // `load.financials` must never be sent the answer to hide it in CSS. It is
  // also the LIGHT read — `packetPlanFor` renders the invoice PDF, and a page
  // that called it would render one on every view of every load whose button
  // stays grey.
  const filing =
    maySetRate && view.showFactoring
      ? await withCurrentOrg('read', 'load.financials', (tx) =>
          filingStateFor(tx, id),
        )
      : null

  // ITEM 8 — the audit log, filtered by what this reader may see.
  //
  // `maySeeRate` is passed in rather than re-derived: permission is decided in
  // permissions.ts, read once above, and applied here. The extra row fetched
  // beyond the window is dropped before filtering, so "older rows exist" stays
  // a fact about the QUERY and not about how much the money filter removed.
  const activityTruncated = auditRows.length > ACTIVITY_WINDOW
  const activity = activityEntries(auditRows.slice(0, ACTIVITY_WINDOW), {
    maySeeMoney: maySeeRate,
  })

  const zone = load.company.timezone

  // ── THE STOPS TABLE'S ROWS (item 6) ───────────────────────────────────────
  //
  // Built here rather than in the component because every value is a decision
  // made elsewhere and already tested: `shownStopTime` for which clock is
  // operative, `dwellLabel` for the wait, `attributionLabel` for who wrote a
  // check-in. The component lays them out and judges nothing.
  // ITEM 7 — read from the two stored columns, never summed from the stops.
  // `milesSummary` is where "null is not zero" lives; see src/lib/load-miles.ts.
  const miles = milesSummary(load)

  const attribution = stopAttribution(clockWrites)
  const attributionLabels = {
    via: t('loads.viaIntegration'),
    unknown: '—',
  }

  const stopRows: StopRow[] = load.stops.map((stop) => {
    const zoneOf = (at: Date | null) =>
      at === null
        ? '—'
        : (renderStopTime(at, stop.state, { fallbackZone: zone, locale })
            ?.text ?? '—')

    const forStop = attribution.get(stop.id)
    const address = formatAddress(stop) ?? formatAddress(stop.location)

    return {
      id: stop.id,
      // THE ORDINAL AND THE TYPE TOGETHER, so the number appears once.
      position: `${stop.sequence} · ${t(`stop.${stop.type}` as never)}`,
      location: stop.name ?? '—',
      place: [stop.city, stop.state].filter(Boolean).join(', ') || null,
      checkedInAt: zoneOf(stop.arrivedAt),
      checkedInBy: attributionLabel(forStop?.arrival, attributionLabels),
      checkedOutAt: zoneOf(stop.departedAt),
      checkedOutBy: attributionLabel(forStop?.departure, attributionLabels),
      scheduled: zoneOf(stop.scheduledAt),
      waiting: dwellLabel(dwellMinutes(stop)),
      // The address, its missing-address flag and its editor, unchanged from
      // the card layout — prose of variable length has no business being a
      // table column.
      address: (
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
      ),
    }
  })

  const stripeTone = load.isCancelled
    ? 'muted'
    : operationalTone(load.operationalStatus)

  // ITEM 9 — THE LOAD TRACKER. Derived here, on the server, from the two axes.
  //
  // ONLY THE STAGE NAME CROSSES TO THE CLIENT. `totalRevenueCents` is read to
  // compute it and is not sent; the strip receives one of five words. See the
  // note in PHASE-5-BRIEF on what that one word still implies for a role
  // without `load.financials`, which is a ruling rather than a preference.
  const stage = pipelineStage({
    operationalStatus: load.operationalStatus,
    billingStatus: load.billingStatus,
    directSettled: load.directSettled,
    totalRevenueCents: load.totalRevenueCents,
    assigned: isAssigned(load),
  })

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

  // ── ONE STREAM (§7.10) ───────────────────────────────────────────────
  //
  // Audit rows, status events, document uploads and notes, merged in
  // `mergeActivity` — in `src/lib/`, where the ORDER can be tested, which is
  // the thing that silently goes wrong. The sort key is a `Date` on every
  // branch; by the time an entry reaches the component its time is rendered
  // text, and sorting that is alphabetical order wearing a chronology's
  // clothes.
  //
  // NOTES ARE IN IT FOR EVERY LOAD NOW, not only the direct-settled ones. Which
  // history a reader got used to depend on the customer, which is not a
  // property of a history.
  // THE PANEL'S LIST AND THE LOG'S LIST, out of one query. §7.8 shows what is
  // on file; §7.10 logs what happened, and a removed document happened.
  const visibleDocuments = documents.filter(
    (document) => document.deletedAt === null,
  )

  // WHO DELETED EACH DOCUMENT, out of the audit rows already fetched.
  //
  // `Document` has no `deletedBy`, so this is the only place the actor exists.
  // THE RAW ROWS, NOT `activity`: `activityEntries` applies the money filter
  // and drops a row that loses every field, which is right for the field-edit
  // stream and wrong here — the actor on a deletion is not a money fact, and a
  // document row emptied by that filter would silently become "nobody".
  //
  // `auditRows` is newest-first, so the FIRST delete row for a document is the
  // most recent one. A document deleted, restored and deleted again has one
  // `deletedAt`, and this is the actor who set it.
  const deletedBy: Record<string, string | null> = {}
  for (const row of auditRows) {
    if (row.entityType !== 'Document' || row.action !== 'DELETE') continue
    if (row.entityId in deletedBy) continue
    deletedBy[row.entityId] = row.user?.name ?? null
  }

  const activityStream = mergeActivity({
    entries: activity,
    statuses: events,
    documents,
    notes,
    deletedBy,
    // Ours gets translated; a human's is shown exactly as typed. §12: the
    // system's own words are chrome and belong in the reader's language; a
    // dispatcher's sentence is evidence and belongs verbatim.
    renderNote: (note) => (isMessageKey(note) ? t(note) : note),
  })

  // ONE EXHAUSTIVE MAP, from `document-types.ts`. This was built here, over
  // only the types present on THIS load, with an `isMessageKey` fallback to the
  // stored value — which meant an untranslated type rendered as
  // `WEIGHT_TICKET`. That is better than a blank badge and worse than a
  // compiler error, and the compiler can have this one: the map is
  // `satisfies Record<DocumentType, MessageKey>`, so a new enum member fails to
  // build until it has a label in all three locales.
  const docTypeLabels = documentTypeLabels(t)

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

  // ── DID IT ARRIVE ON TIME ────────────────────────────────────────────
  //
  // NO QUERY. Every stop is already on this page, and `onTimeFrom` is the
  // same function the list loader feeds — one rule, two sources.
  //
  // ONLY ONCE IT IS FINISHED. A load in transit has not failed to arrive,
  // and a badge reading "No check-in recorded" on freight that is still
  // moving would be a complaint about the future.
  const onTime: OnTime | null = delivered
    ? (() => {
        const facts = deliveryFactsFromStops(load.stops)
        return facts === null ? null : onTimeFrom(facts)
      })()
    : null

  const slotFor = (
    type: string,
    label: string,
    required: boolean,
  ): DocumentSlot => ({
    type,
    label,
    required,
    // `visibleDocuments`, NOT `documents`. The query now returns soft-deleted
    // rows so the timeline can log them; the panel shows what it always showed.
    documents: visibleDocuments
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

  // THE SAME MAP THE TIMELINE AND THE DOCUMENTS LIST READ. These three slots
  // had their own vocabulary — `documents.type.*`, three keys — and the same
  // enum member therefore carried two labels that could drift. They had: in
  // Russian `documents.type.POD` read "Документ о доставке" and
  // `docType.POD` read "POD". One map, one label.
  const slots: DocumentSlot[] = [
    slotFor('RATE_CONFIRMATION', docTypeLabels.RATE_CONFIRMATION, true),
    slotFor('POD', docTypeLabels.POD, podRequired),
    slotFor('BOL', docTypeLabels.BOL, false),
  ]

  return (
    <>
      <div className="flex flex-col gap-z3 border-b border-border bg-surface px-gutter py-z3">
        <div className="flex items-baseline justify-between gap-z4">
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
            {/* THE THIRD BADGE, AND IT IS DERIVED. `unknown` shows rather
             * than hides: a delivered load nobody checked in is a gap in
             * the record somebody can still close, and it is the reason
             * the driver rate below excludes it instead of guessing. */}
            {onTime === null ? null : (
              <StatusBadge
                tone={ON_TIME_TONE[onTime]}
                variant="outlined"
                label={t(`dispatch.onTime.${onTime}` as MessageKey)}
              />
            )}
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

        {/* THE SUMMARY CARD'S FACTS, ACROSS THE HEADER. The card that held
         * them is gone: four short strings and a number do not need half the
         * width of the screen, and they are the load's identity rather than
         * its detail — the same class of thing as the number above them. */}
        <LoadFacts facts={headerFacts} />

        {/* THE CANCELLATION REASON FOLLOWS THE CANCELLED BADGE, which is in
         * the row above. It was in the summary card only because that is where
         * the facts were; it is a statement about the whole load. */}
        {load.isCancelled && load.cancelReason ? (
          <p className="rounded-control border border-danger bg-danger-soft px-z2 py-z1 text-sm text-danger">
            {load.cancelReason}
          </p>
        ) : null}
      </div>

      <div
        className={`min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5 ${load.isCancelled ? 'opacity-60' : ''}`}
      >
        <div className="grid max-w-[1100px] gap-z4 lg:grid-cols-2">
          {/* ITEM 9 — THE SAME FIVE WORDS ON EVERY LOAD, ABOVE EVERYTHING.
           *
           * It goes first and full width because it answers the question the
           * screen is opened to answer — roughly where is this — and a summary
           * of the whole load belongs above the panels it summarises.
           *
           * A STRIP IN A CONTAINER, deliberately. When the header work moves
           * it, only this div changes; the component takes a stage and some
           * words and does not know where on the page it is. */}
          <div className="lg:col-span-2">
            <PipelineStrip
              stage={stage}
              cancelled={load.isCancelled}
              labels={{
                title: t('loads.pipelineTitle'),
                cancelled: t('loads.cancelled'),
                upcoming: t('loads.stageUpcoming'),
                inTransit: t('loads.stageInTransit'),
                delivered: t('loads.stageDelivered'),
                invoiced: t('loads.stageInvoiced'),
                paid: t('loads.stagePaid'),
              }}
            />
          </div>

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
              coDriverId={load.coDriverId}
              suggestedCoDriverId={offeredMate?.id ?? null}
              teamHint={
                offeredMate
                  ? t('team.suggested')
                      .replace(
                        '{name}',
                        `${offeredMate.firstName} ${offeredMate.lastName}`,
                      )
                      .replace('{unit}', offeredMate.truckUnit)
                  : null
              }
              disabled={load.isCancelled}
              assign={assignLoadAction.bind(null, id)}
              labels={{
                title: t('loads.assignment'),
                truck: t('loads.column.truck'),
                driver: t('loads.column.driver'),
                coDriver: t('loads.column.coDriver'),
                unassigned: t('loads.unassigned'),
                save: t('loads.assignSave'),
                saving: t('loads.assignSaving'),
              }}
            />
          ) : null}

          {/* ITEM 6 — A TABLE FOR RELAY FREIGHT, CARDS FOR EVERYTHING ELSE.
           *
           * Six to eight stops read as a route in a table and as a scroll in a
           * stack of cards. Broker freight is two stops, where eight columns
           * of mostly empty cells would be worse than the list it replaces —
           * so the cards below are not legacy, they are the right shape for
           * the other kind of load. */}
          {/* ITEM 7 — Loaded / Empty / Total, beside the stops they come from.
           * Only on freight whose legs were classified; broker loads have no
           * split to show and the panel would be two em dashes and a number. */}
          {/* BOTH SPAN THE GRID, AND THAT IS WHAT MAKES THE TABLE READABLE.
           *
           * Eight columns inside a half-width cell meant Checked out, Schedule
           * time and Waiting were all off-screen behind a horizontal scrollbar
           * — three of the eight columns invisible on the panel built to show
           * them, which is most of the point of a table gone. Miles was the
           * other half of the same mistake: three numbers given a column of
           * their own, standing as tall as the table beside it.
           *
           * So they stack, full width: the distances, then the stops they were
           * measured over. The two-column grid still holds everything else,
           * where a card of label/value pairs is exactly what fits in half a
           * width. */}
          {/* MILES ON EVERY LOAD NOW, not only on Relay freight. The panel was
           * Amazon-only because the loaded/empty split is Relay's alone — but
           * the TOTAL is every load's fact, and it was the summary card that
           * carried it for broker freight. With that card gone this is where
           * the number lives, and the split does not render where it was never
           * measured. */}
          <div className="lg:col-span-2">
            <MilesSummary
              totalMiles={miles.totalMiles}
              loadedMiles={miles.loadedMiles}
              emptyMiles={miles.emptyMiles}
              provisional={miles.provisional}
              locale={locale}
              labels={{
                title: t('loads.milesTitle'),
                loaded: t('loads.milesLoaded'),
                empty: t('loads.milesEmpty'),
                total: t('loads.milesTotal'),
                unknown: t('loads.milesUnknown'),
                unclassified: t('loads.milesProvisional'),
              }}
              editor={
                // ITEM 4's REASONING, PRESERVED. The editor sat outside the
                // rate panel so a dispatcher could reach it; this panel is not
                // behind `load.financials` either, so it still can be.
                //
                // `load:update` ALONE, WHICH IS WHERE THE SUMMARY CARD HAD IT.
                // It was `view.editMiles && mayUpdate`, and `editMiles` was
                // `directSettled` — correct while this panel was Amazon-only,
                // because a panel nobody else saw needed no rule about who else
                // could edit it.
                //
                // THE SCOPE FOLLOWED THE PANEL; IT WAS NOT WIDENED FOR
                // CONVENIENCE. The panel renders on every load because the
                // total is meaningful on every load — driver pay and
                // revenue-per-mile both rest on it — and a number that drives
                // driver pay while refusing correction is a defect whatever
                // broker the freight came from. The freight-type flag is gone
                // rather than set true, because "who may edit miles" is a
                // permission question and had no business being answered by
                // where the load came from.
                mayUpdate ? (
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
                ) : undefined
              }
            />
          </div>

          {view.stopsAsTable ? (
            <div className="lg:col-span-2">
              <StopsTable
                stops={stopRows}
                labels={{
                  title: t('loads.stopsTitle'),
                  position: t('loads.colPosition'),
                  location: t('loads.colLocation'),
                  checkedInAt: t('loads.colInAt'),
                  checkedInBy: t('loads.colInBy'),
                  checkedOutAt: t('loads.colOutAt'),
                  checkedOutBy: t('loads.colOutBy'),
                  scheduled: t('loads.colScheduled'),
                  waiting: t('loads.colWaiting'),
                  empty: t('loads.stopsEmpty'),
                  unattributed: t('loads.stopsUnattributed'),
                }}
              />
            </div>
          ) : (
            <section className="rounded-card border border-border bg-surface p-z4">
              <h2 className="text-md font-medium text-ink">
                {t('loads.stops')}
              </h2>
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
                  const planned = renderStopTime(
                    shown.scheduledAt,
                    stop.state,
                    {
                      fallbackZone: zone,
                      locale,
                      zone: stop.location?.timezone ?? null,
                    },
                  )
                  const departed = renderStopTime(
                    shown.departedAt,
                    stop.state,
                    {
                      fallbackZone: zone,
                      locale,
                      zone: stop.location?.timezone ?? null,
                    },
                  )
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
                        <span className="text-xs uppercase tracking-[0.04em] text-ink-2">
                          {t(`stop.${stop.type}` as never)}
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
          )}
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

          {/* MONEY §7 — ONE BUTTON, ONE PACKET.
           *
           * Under the rate, because it is the last thing that happens to the
           * money on a load: the rate is entered, the invoice is raised, and
           * then the whole thing is sold. Behind `load.financials:update` for
           * the same reason the rate is — this sells a receivable.
           *
           * THE PIECE NAMES ARE TRANSLATED HERE. `readiness.because` is an
           * English sentence for logs and API refusals; the screen joins its
           * own list, because "the POD and the rate confirmation" is grammar
           * rather than concatenation and three locales do it differently. */}
          <PaymentTypePanel
            value={load.paymentType}
            options={PAYMENT_TYPES}
            disabled={load.isCancelled}
            save={setPaymentTypeAction.bind(null, id)}
            labels={{
              title: t('loads.column.paymentType'),
              hint: t('loads.paymentType.hint'),
              none: t('loads.paymentType.none'),
              save: t('ref.save'),
              saving: t('loads.paymentType.saving'),
              saved: t('loads.paymentType.saved'),
            }}
          />

          {filing ? (
            <FactoringPanel
              canFile={filing.canFile}
              canMarkPaid={filing.canMarkPaid}
              missing={filing.readiness.missing.map((piece) =>
                t(`packet.piece.${piece}` as MessageKey),
              )}
              notFactored={
                filing.notFactored === null
                  ? null
                  : t('packet.error.notFactored')
              }
              isFiled={filing.billingStatus === 'FILED_WITH_FACTOR'}
              packetHref={`/api/loads/${id}/packet`}
              file={filePacketAction.bind(null, id)}
              markPaid={markFactoredPaidAction.bind(null, id)}
              labels={{
                title: t('packet.title'),
                file: t('packet.file'),
                filing: t('packet.filing'),
                filed: t('packet.filed'),
                markPaid: t('packet.markPaid'),
                marking: t('packet.marking'),
                openPacket: t('packet.openPacket'),
                missing: t('packet.missing'),
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

          {/* ── ONE ACTIVITY TIMELINE (§7.10) ────────────────────────────
           *
           * THIS WAS TWO PANELS AND THE COMMENT HERE ARGUED FOR TWO: "a status
           * transition is a business event and a column write is a record of
           * who typed something, and merging them would bury the first under
           * the second." Overturned by the owner's ruling of 2026-10-01, which
           * is recorded in §7.10 rather than only here.
           *
           * THE OLD CONCERN WAS REAL AND IS ANSWERED BY THE RAIL, not by
           * ignoring it: a status transition carries a filled dot and a badge,
           * a field edit carries a plain dot and a `label: old → new` list, a
           * document carries a SQUARE. Six kinds that do not dress alike, so
           * the business events stay findable in a stream that also holds every
           * keystroke. What the two panels could not do is answer "what
           * happened to this load" without somebody interleaving them by eye.
           *
           * FULL WIDTH, because it is now the whole history rather than half
           * of it.
           *
           * WHAT IT MAY SHOW IS STILL DECIDED IN load-activity.ts. */}
          <div className="lg:col-span-2">
            <ActivityTimeline
              entries={activityStream}
              truncated={activityTruncated}
              statusLabels={statusLabels}
              documentTypeLabels={docTypeLabels}
              locale={locale}
              timeZone={zone}
              {...(mayUpdate
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
              labels={{
                title: t('loads.activityTitle'),
                empty: t('loads.activityEmpty'),
                created: t('loads.activityCreated'),
                deleted: t('loads.activityDeleted'),
                uploaded: t('loads.activityUploaded'),
                documentDeleted: t('loads.activityDocumentDeleted'),
                via: t('loads.activityVia'),
                truncated: t('loads.activityTruncated'),
                manual: t('loads.source.manual'),
                automatic: t('loads.source.automatic'),
                driverPortal: t('loads.source.driverPortal'),
                integration: t('loads.source.integration'),
                refused: t('loads.source.refused'),
                refusedBody: t('loads.refusedBody'),
                by: t('loads.by'),
                set: t('loads.activitySet'),
                cleared: t('loads.activityCleared'),
                changed: t('loads.activityChanged'),
                // A translated name where one exists, a humanised column name
                // where none does — so a field added next month still reads
                // as a sentence rather than as nothing.
                field: (name: string) => {
                  const key = `loads.field.${name}`
                  return isMessageKey(key) ? t(key) : humaniseField(name)
                },
              }}
            />
          </div>
        </div>
      </div>
    </>
  )
}

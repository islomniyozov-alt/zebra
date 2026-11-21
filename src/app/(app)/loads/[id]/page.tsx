import { notFound } from 'next/navigation'
import { teamMateFor } from '@/lib/team'
import Link from 'next/link'
import { assignableDriver, ASSIGNABLE_TRUCK } from '@/lib/driver-availability'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  billingLabelKey,
  operationalLabelKey,
  operationalTone,
} from '@/lib/status'
import { formatAddress } from '@/lib/locations'
import { attributionLabel, stopAttribution } from '@/lib/stop-attribution'
import { milesSummary } from '@/lib/load-miles'
import { isAssigned } from '@/lib/load-readiness'
import { invoiceReadiness } from '@/lib/invoices'
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
  createdBy,
  loadDetailView,
} from '@/lib/load-detail-view'
import { isAmazonLoad } from '@/lib/amazon-load'
import { trackerStep, TRACKER_STEPS } from '@/lib/load-tracker'
import { tripsFromStops } from '@/lib/load-trips'
import { formatBp, profitBox } from '@/lib/load-profit'
import { formatCents } from '@/lib/money'
import { Tabs, type TabSpec } from '@/components/ui/Tabs'
import {
  AmazonStops,
  DetailCard,
  FactGrid,
  ProfitBoxCard,
  TrackerSteps,
  TripsTable,
  type AmazonStopRow,
  type TripRow,
} from './AmazonDetail'
import { renderStopTime, ZONE_CHOICES } from '@/lib/stop-time'
import { dwellLabel, dwellMinutes } from '@/lib/stop-actuals'
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
import type { StopRow } from './StopsTable'
import { MilesSummary } from './MilesSummary'
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
  createLoadInvoiceAction,
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

export default async function LoadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const query = await searchParams
  const { t, locale } = await getLocaleContext()

  // §6.8: a role without the read is REFUSED as a 404, never a 500 (sweep).
  if (!(await currentUserCan('read', 'load'))) notFound()
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
            // THE STATUS, so the panel applies `recomputeTotals`' own rule —
            // a denied line is in no figure (§7.12).
            status: true,
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

    const [
      events,
      documents,
      notes,
      clockWrites,
      auditRows,
      trucks,
      drivers,
      creator,
    ] = await Promise.all([
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
      // §7.13 — "Created by" on the Amazon shape: the person on the load's
      // CREATE row. ITS OWN READ, because the activity window above is the
      // newest fifty and a long-lived load's CREATE falls out of it. Asked
      // only for an Amazon load, so broker freight keeps its query count.
      isAmazonLoad(load)
        ? tx.auditLog.findFirst({
            where: { entityType: 'Load', entityId: id, action: 'CREATE' },
            orderBy: { createdAt: 'asc' },
            select: { user: { select: { name: true } } },
          })
        : null,
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
      creator,
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
    creator,
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

  // §7.14 — CREATE INVOICE, on broker freight, for a role that may create an
  // invoice. Its own read behind `invoice:create`; the readiness query is the
  // one the /invoices queue uses, and a refusal comes back with its reason.
  const mayInvoice =
    view.brokerShape && (await currentUserCan('create', 'invoice'))
  const invoiceState = mayInvoice
    ? await withCurrentOrg('read', 'invoice', (tx) => invoiceReadiness(tx, id))
    : null

  // §7.13 — DRIVER PAY FOR THE PROFIT BOX AND THE TRIPS TABLE, in its own read
  // behind `load.financials`, for the reason the filing read above is: a role
  // without it is never sent the figure. The pay the settlement engine wrote on
  // this load's statement lines, counted only from APPROVED or PAID statements
  // — a draft is a figure nobody has signed off — and null when there is none,
  // because unknown pay is not zero pay.
  const driverPayCents = maySeeRate
    ? await withCurrentOrg('read', 'load.financials', async (tx) => {
        const lines = await tx.settlementLoadLine.aggregate({
          where: {
            loadId: id,
            settlement: { status: { in: ['APPROVED', 'PAID'] } },
          },
          _sum: { amountCents: true },
          _count: true,
        })
        return lines._count === 0 ? null : (lines._sum.amountCents ?? 0)
      })
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
        status: row.status,
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
  //
  // §7.13 — NOTHING IS REQUIRED ON AN AMAZON LOAD. Its rate con, POD and BOL
  // live in Relay, so no slot reads "Missing — this load needs one"; the card
  // says where they are and keeps the upload.
  const required = !view.documentsOnRelay
  const slots: DocumentSlot[] = [
    slotFor('RATE_CONFIRMATION', docTypeLabels.RATE_CONFIRMATION, required),
    slotFor('POD', docTypeLabels.POD, required && podRequired),
    slotFor('BOL', docTypeLabels.BOL, false),
  ]

  // ── THE PANELS BOTH LAYOUTS SHARE ────────────────────────────────────────
  //
  // Built once and placed by whichever layout this load gets (§7.13): broker
  // freight renders each where it always did, the Amazon shape puts them in
  // its tabs and its rail. Every prop is the one the panel had before.
  const actionsFor = (layout: 'inline' | 'menu') =>
    mayUpdate ? (
      <LoadActions
        layout={layout}
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
          menu: t('loads.menu'),
        }}
      />
    ) : null

  const assignmentNode =
    view.showAssignment && mayUpdate ? (
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
    ) : null

  const milesNode = (
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
        // ITEM 4's REASONING, PRESERVED. The editor sat outside the rate panel
        // so a dispatcher could reach it; this panel is not behind
        // `load.financials` either, so it still can be.
        //
        // `load:update` ALONE, WHICH IS WHERE THE SUMMARY CARD HAD IT. It was
        // `view.editMiles && mayUpdate`, and `editMiles` was `directSettled` —
        // correct while this panel was Amazon-only, because a panel nobody
        // else saw needed no rule about who else could edit it.
        //
        // THE SCOPE FOLLOWED THE PANEL; IT WAS NOT WIDENED FOR CONVENIENCE.
        // The panel renders on every load because the total is meaningful on
        // every load — driver pay and revenue-per-mile both rest on it — and a
        // number that drives driver pay while refusing correction is a defect
        // whatever broker the freight came from. The freight-type flag is gone
        // rather than set true, because "who may edit miles" is a permission
        // question and had no business being answered by where the load came
        // from.
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
  )

  const rateNode = maySeeRate ? (
    <RatePanel
      loadId={id}
      linehaulCents={load.linehaulCents}
      fuelSurchargeCents={load.fuelSurchargeCents}
      // §7.13 — withheld on every Amazon load: the rate is fuel-included.
      showFuelSurcharge={view.showFuelSurcharge}
      accessorials={accessorialRows}
      mayEdit={maySetRate}
      accessorialTypes={accessorialChoicesFor(ACCESSORIAL_TYPES, load).map(
        (type) => ({
          value: type,
          label: t(`accessorial.${type}` as MessageKey),
        }),
      )}
      locale={locale}
      translate={rateMessages}
      labels={{
        title: t('rate.title'),
        linehaul: t('rate.linehaul'),
        fuelSurcharge: t('rate.fuelSurcharge'),
        accessorials: t('rate.accessorials'),
        otherNotBilled: t('rate.otherNotBilled'),
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
  ) : null

  const paymentTypeNode = (
    <PaymentTypePanel
      value={load.paymentType}
      options={PAYMENT_TYPES}
      disabled={load.isCancelled}
      // §7.12 — a fact on direct-settled freight, a choice on the rest.
      derived={view.paymentTypeDerived}
      save={setPaymentTypeAction.bind(null, id)}
      labels={{
        title: t('loads.column.paymentType'),
        hint: t('loads.paymentType.hint'),
        none: t('loads.paymentType.none'),
        save: t('ref.save'),
        saving: t('loads.paymentType.saving'),
        saved: t('loads.paymentType.saved'),
        derived: t('loads.paymentType.derived'),
      }}
    />
  )

  // `filing` is null on an Amazon load (`view.showFactoring`), so neither the
  // panel nor its "Still missing:" list renders there (§7.13).
  const factoringNode = filing ? (
    <FactoringPanel
      canFile={filing.canFile}
      canMarkPaid={filing.canMarkPaid}
      missing={filing.readiness.missing.map((piece) =>
        t(`packet.piece.${piece}` as MessageKey),
      )}
      notFactored={
        filing.notFactored === null ? null : t('packet.error.notFactored')
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
  ) : null

  const documentsNode = (
    <LoadDocuments
      loadId={id}
      slots={slots}
      mayUpload={mayUpload && !load.isCancelled}
      onUploaded={refreshLoadAction.bind(null, id)}
      {...(view.documentsOnRelay ? { note: t('loads.documentsOnRelay') } : {})}
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
  )

  const activityLabels = {
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
    // A translated name where one exists, a humanised column name where none
    // does — so a field added next month still reads as a sentence rather
    // than as nothing.
    field: (name: string) => {
      const key = `loads.field.${name}`
      return isMessageKey(key) ? t(key) : humaniseField(name)
    },
  }

  const activityNode = (
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
      labels={activityLabels}
    />
  )

  // ── §7.13 AND §7.14 — EVERY LOAD IN DATATRUCK'S SHAPE ──────────────────
  //
  // Amazon freight (§7.13) and broker freight (§7.14, `view.brokerShape`)
  // share this layout. What differs rides on the view's flags: Create invoice
  // and the stop time-zone editor on broker freight, the Relay sentence and
  // "On statement" on Amazon's. The older stacked layout is gone.
  const copy = (value: string) => (
    <Copyable value={value} className="font-mono" labels={copyLabels} />
  )
  const statusBadge = (
    <StatusBadge
      tone={operationalTone(load.operationalStatus)}
      label={t(operationalLabelKey(load.operationalStatus))}
    />
  )

  // THE TRACKER. One mapping, in `load-tracker.ts`. The seventh word stays
  // "On statement" on direct-settled freight, as §7.12 ruled and §7.13 flags.
  const step = trackerStep({
    operationalStatus: load.operationalStatus,
    billingStatus: load.billingStatus,
    assigned: isAssigned(load),
  })
  const trackerWords = TRACKER_STEPS.map((key) =>
    key === 'invoiced' && view.settledWord === 'onStatement'
      ? t('loads.stageOnStatement')
      : t(`tracker.${key}` as MessageKey),
  )

  // THE STOPS. The window in the stop's own zone, as every stop time on
  // this page is; the address cell is the same editor the table above uses.
  const addressById = new Map(stopRows.map((row) => [row.id, row.address]))
  const placeOf = (stop: (typeof load.stops)[number]) =>
    [stop.city ?? stop.location?.city, stop.state ?? stop.location?.state]
      .filter(Boolean)
      .join(', ') || null
  const amazonStops: AmazonStopRow[] = load.stops.map((stop) => {
    const at = (when: Date | null) =>
      when === null
        ? null
        : (renderStopTime(when, stop.state, {
            fallbackZone: zone,
            locale,
            zone: stop.location?.timezone ?? null,
          })?.text ?? null)
    const start = at(stop.windowStart)
    const end = at(stop.windowEnd)
    return {
      id: stop.id,
      position: `${stop.sequence} · ${t(`stop.${stop.type}` as never)}`,
      facility: stop.name ?? '—',
      place: placeOf(stop),
      zip: stop.postalCode ?? stop.location?.postalCode ?? null,
      window:
        start && end
          ? `${start} – ${end}`
          : (start ?? at(stop.scheduledAt) ?? '—'),
      // THE ACTUALS, BESIDE THE PLAN (owner's change on accepting §7.13):
      // the portal's taps write them, and scheduled against actual is the
      // comparison a dispatcher reads this row for.
      arrived: at(stop.arrivedAt) ?? '—',
      departed: at(stop.departedAt) ?? '—',
      address: addressById.get(stop.id) ?? null,
    }
  })

  // THE TRIPS. Legs from `tripsFromStops`; the crew is the load's. Driver
  // gross is the load's statement pay, shown once because no per-leg pay
  // exists — and absent from the row entirely without `load.financials`.
  const legs = tripsFromStops(load.stops, load.referenceNumber)
  const tripRows: TripRow[] = legs.map((leg) => ({
    key: `${leg.pickup.id}-${leg.delivery.id}`,
    tripId: leg.tripId ? copy(leg.tripId) : '—',
    status: statusBadge,
    pickup: placeOf(leg.pickup) ?? leg.pickup.name ?? '—',
    delivery: placeOf(leg.delivery) ?? leg.delivery.name ?? '—',
    driver: load.driver
      ? `${load.driver.firstName} ${load.driver.lastName}`
      : null,
    truck: load.truck?.unitNumber ?? null,
    trailer: load.trailer?.unitNumber ?? null,
    ...(maySeeRate
      ? {
          driverGross:
            legs.length === 1 && driverPayCents !== null
              ? formatCents(driverPayCents, locale)
              : '—',
        }
      : {}),
  }))
  const tripLabels = {
    title: t('loads.tab.trips'),
    tripId: t('loads.trips.tripId'),
    status: t('loads.column.status'),
    pickup: t('loads.trips.pickup'),
    delivery: t('loads.trips.delivery'),
    driver: t('loads.column.driver'),
    truck: t('loads.column.truck'),
    trailer: t('loads.column.trailer'),
    driverGross: t('loads.trips.driverGross'),
  }
  const tripsNode =
    tripRows.length > 0 ? (
      <TripsTable
        trips={tripRows}
        showDriverGross={maySeeRate}
        labels={tripLabels}
      />
    ) : null

  // THE TABS THAT HAVE SOMETHING IN THEM, and the one asked for — or Load
  // info, when the URL names a tab this load does not show.
  const tabs: TabSpec[] = [
    { key: 'info', label: t('loads.tab.info') },
    ...(legs.length > 0
      ? [{ key: 'trips', label: t('loads.tab.trips'), count: legs.length }]
      : []),
    {
      key: 'documents',
      label: t('loads.tab.documents'),
      count: visibleDocuments.length,
    },
    ...(maySeeRate
      ? [{ key: 'financials', label: t('loads.tab.financials') }]
      : []),
    ...(events.length > 0
      ? [
          {
            key: 'status',
            label: t('loads.tab.status'),
            count: events.length,
          },
        ]
      : []),
  ]
  const asked = typeof query['tab'] === 'string' ? query['tab'] : 'info'
  const active = tabs.some((tab) => tab.key === asked) ? asked : 'info'

  const author = createdBy(load, creator?.user ?? null)
  const secondRow = [
    {
      label: t('loads.card.loadId'),
      value: load.referenceNumber ? copy(load.referenceNumber) : null,
    },
    ...(maySeeRate
      ? [
          {
            label: t('loads.totalPay'),
            value: formatCents(load.totalRevenueCents, locale),
          },
        ]
      : []),
    {
      label: t('loads.createdBy'),
      value:
        author.kind === 'person'
          ? author.name
          : author.kind === 'import'
            ? t('loads.createdByImport')
            : null,
    },
  ]

  const box = maySeeRate
    ? profitBox({
        totalRevenueCents: load.totalRevenueCents,
        accessorialsCents: load.accessorialsCents,
        driverPayCents,
      })
    : null
  const cents = (value: number | null) =>
    value === null ? '—' : formatCents(value, locale)

  return (
    <>
      <div className="flex flex-col gap-z3 border-b border-border bg-surface px-gutter py-z3">
        <div className="flex items-center justify-between gap-z4">
          <div className="flex items-center gap-z3">
            <Link
              href="/loads"
              aria-label={t('loads.back')}
              className="text-lg text-ink-2 hover:text-accent"
            >
              ←
            </Link>
            <h1 className="flex items-baseline gap-z2 text-lg font-medium text-ink">
              <Link href="/loads" className="text-ink-2 hover:text-accent">
                {t('loads.breadcrumb')}
              </Link>
              <span aria-hidden className="text-ink-3">
                /
              </span>
              {copy(load.loadNumber)}
            </h1>
            {statusBadge}
            {load.isCancelled ? (
              <StatusBadge tone="muted" label={t('loads.cancelled')} />
            ) : null}
          </div>
          {/* NEUTRAL ACTIONS ONLY in the Amazon header (§7.13, owner's
           * review 2026-11-17): Cancel load is in the ⋮ menu. */}
          <div className="flex items-center gap-z3">
            {/* §7.14 — Create invoice on broker freight: enabled exactly when
             * the readiness query admits the load, else disabled with the
             * reason beside it. */}
            {invoiceState ? (
              invoiceState.ready ? (
                <form action={createLoadInvoiceAction.bind(null, id)}>
                  <Button type="submit" variant="primary">
                    {t('invoices.create')}
                  </Button>
                </form>
              ) : (
                <span className="flex items-center gap-z2">
                  <Button
                    type="button"
                    variant="primary"
                    disabled
                    aria-describedby="invoice-block"
                  >
                    {t('invoices.create')}
                  </Button>
                  <span id="invoice-block" className="text-xs text-ink-3">
                    {t(
                      `loads.invoiceBlock.${invoiceState.reason}` as MessageKey,
                    )}
                  </span>
                </span>
              )
            ) : null}
            {actionsFor('menu')}
          </div>
        </div>
        <div className="max-w-[640px]">
          <FactGrid
            facts={secondRow}
            columns={secondRow.length === 3 ? 3 : 2}
          />
        </div>
        {load.isCancelled && load.cancelReason ? (
          <p className="rounded-control border border-danger bg-danger-soft px-z2 py-z1 text-sm text-danger">
            {load.cancelReason}
          </p>
        ) : null}
      </div>

      <Tabs
        tabs={tabs}
        active={active}
        hrefFor={(key) =>
          key === 'info' ? `/loads/${id}` : `/loads/${id}?tab=${key}`
        }
        label={t('loads.tabsLabel')}
      />

      <div
        className={`min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5 ${load.isCancelled ? 'opacity-60' : ''}`}
      >
        <div className="grid gap-z4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-z4">
            {active === 'info' ? (
              <>
                <TrackerSteps
                  step={step}
                  cancelled={load.isCancelled}
                  labels={{
                    title: t('loads.pipelineTitle'),
                    cancelled: t('loads.cancelled'),
                    steps: trackerWords,
                  }}
                />
                {assignmentNode}
                <AmazonStops
                  stops={amazonStops}
                  labels={{
                    title: t('loads.stopsTitle'),
                    position: t('loads.colPosition'),
                    facility: t('loads.stopsCol.facility'),
                    place: t('loads.stopsCol.place'),
                    zip: t('loads.stopsCol.zip'),
                    window: t('loads.stopsCol.window'),
                    arrived: t('loads.stopsCol.arrived'),
                    departed: t('loads.stopsCol.departed'),
                    address: t('loads.stopsCol.address'),
                    empty: t('loads.stopsEmpty'),
                  }}
                />
                {/* §7.14 — the stop time-zone editor the older broker layout
                 * carried, kept for broker freight: a dock typed once has no
                 * export to name its zone. */}
                {view.brokerShape && view.showStopTimezone && mayUpdate ? (
                  <DetailCard title={t('loads.stopZones')}>
                    <p className="text-xs text-ink-3">
                      {t('places.timezoneHint')}
                    </p>
                    <ul className="mt-z2 flex flex-col gap-z2">
                      {load.stops
                        .filter((stop) => stop.locationId)
                        .map((stop) => (
                          <li key={stop.id}>
                            <form
                              action={setStopZoneAction.bind(
                                null,
                                id,
                                stop.locationId as string,
                              )}
                              className="flex items-center gap-z2"
                            >
                              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                                {`${stop.sequence} · ${stop.name ?? placeOf(stop) ?? '—'}`}
                              </span>
                              <Select
                                name="timezone"
                                label={t('places.timezone')}
                                labelHidden
                                defaultValue={stop.location?.timezone ?? ''}
                                options={zoneOptions}
                              />
                              <Button
                                type="submit"
                                variant="ghost"
                                size="compact"
                              >
                                {t('ref.save')}
                              </Button>
                            </form>
                          </li>
                        ))}
                    </ul>
                  </DetailCard>
                ) : null}
                {tripsNode}
                <div className="grid gap-z4 lg:grid-cols-3">
                  <DetailCard title={t('loads.card.loadInfo')}>
                    <FactGrid
                      columns={1}
                      facts={[
                        {
                          label: t('ref.authority'),
                          value: load.company.name,
                        },
                        {
                          label: t('loads.card.loadId'),
                          value: load.referenceNumber,
                        },
                        {
                          label: t('loads.card.reference'),
                          value: load.poNumber ?? load.bolNumber,
                        },
                      ]}
                    />
                  </DetailCard>
                  {milesNode}
                  <DetailCard title={t('loads.column.customer')}>
                    <Link
                      href={`/brokers/${load.customer.id}`}
                      className="text-sm font-medium text-ink hover:text-accent"
                    >
                      {load.customer.name}
                    </Link>
                  </DetailCard>
                </div>
              </>
            ) : null}
            {active === 'trips' ? tripsNode : null}
            {active === 'documents' ? documentsNode : null}
            {active === 'financials' ? (
              <>
                {rateNode}
                {paymentTypeNode}
                {factoringNode}
              </>
            ) : null}
            {active === 'status' ? (
              <ActivityTimeline
                entries={activityStream.filter(
                  (entry) => entry.kind === 'status',
                )}
                truncated={false}
                statusLabels={statusLabels}
                documentTypeLabels={docTypeLabels}
                locale={locale}
                timeZone={zone}
                labels={{ ...activityLabels, title: t('loads.tab.status') }}
              />
            ) : null}
          </div>

          <aside className="flex min-w-0 flex-col gap-z4">
            {activityNode}
            {box ? (
              <ProfitBoxCard
                title={t('profit.title')}
                rows={[
                  {
                    label: t('profit.revenue'),
                    value: cents(box.revenueCents),
                  },
                  {
                    label: t('rate.accessorials'),
                    value: cents(box.accessorialsCents),
                  },
                  {
                    label: t('profit.driverPay'),
                    value: cents(box.driverPayCents),
                  },
                  {
                    label: t('profit.grossProfit'),
                    value: cents(box.grossProfitCents),
                    strong: true,
                  },
                  {
                    label: t('profit.margin'),
                    value:
                      box.marginBp === null
                        ? '—'
                        : formatBp(box.marginBp, locale),
                  },
                ]}
              />
            ) : null}
          </aside>
        </div>
      </div>
    </>
  )
}

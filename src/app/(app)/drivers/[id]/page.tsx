import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Tabs } from '@/components/ui/Tabs'
import { Table, type Column } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { documentTypeLabels } from '@/lib/document-types'
import { humaniseField } from '@/lib/load-activity'
import { netPayByDriverWeek } from '@/lib/accounting-reports'
import { recentSundays } from '@/lib/rolling-period'
import { formatCents as formatMoney } from '@/lib/money'
import {
  assignmentHistoryFor,
  driverActivity,
  drawsForDriver,
  EMPTY_TABS,
  recordTabFor,
  thirteenWeekStats,
  visibleRecordTabs,
  type AssignmentPeriod,
  type DriverDraw,
  type RecordTab,
} from '@/lib/driver-record'
import { ActivityTimeline } from '../../loads/[id]/ActivityTimeline'
import { tagsToInput } from '@/lib/tags'
import { PayToForm } from './PayToForm'
import { SignInLink } from './SignInLink'
import { can } from '@/lib/permissions'
import {
  currentUserCan,
  readCurrentOrg,
  withCurrentOrg,
} from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { CompliancePanel } from '../../_reference/CompliancePanel'
import { compliancePanelFrom } from '../../_reference/compliance-view'
import { InspectionPanel } from '../../_reference/InspectionPanel'
import { DriverDocuments } from '../../_reference/DriverDocuments'
import { inspectionPanelFrom } from '../../_reference/inspection-view'
import { PAY_RULE_TYPES } from '@/lib/driver-pay'
import { readDriverRecordHead } from '@/lib/driver-record-head'
import { DEDUCTION_TYPES } from '@/lib/driver-deductions'
import {
  dqfChecklist,
  dqfIncompleteCount,
  dqfOnFileDocument,
  dqfOnFileRecord,
  dqfRowAction,
  DQF_RECORD_DEFAULT_DAYS,
  DQF_REQUIREMENTS,
  isQualifiable,
  type DqfRequirement,
} from '@/lib/dqf'
import {
  DqfPanel,
  type DqfPanelAction,
  type DqfPanelRow,
} from '../../_reference/DqfPanel'
import { documentTypeFor } from '@/lib/compliance'
import {
  DRIVER_DOCUMENT_KINDS,
  driverDocumentList,
} from '@/lib/driver-documents'
import type { ComplianceType } from '@/generated/prisma/client'
import { CdlReader } from './CdlReader'
import { MedicalCertUpload } from '../../safety/MedicalCertUpload'
import { medLabels } from '../../safety/med-labels'
import { bpsToInput, formatCents } from '@/lib/money'
import { DriverMainForm, type DriverMainSection } from './DriverMainForm'
import { DriverPhoto } from './DriverPhoto'
import { photoOf, tenureOf } from '@/lib/driver-main'
import { DRIVER_KINDS } from '@/lib/driver-kind'
import { AssetActions } from '../../_reference/AssetActions'
import { updateDriverAction } from '../actions'
import { PayRules, type PayRuleRowView } from './PayRules'
import { Deductions, type DeductionRowView } from './Deductions'
import { OpeningBalances, type OpeningRowView } from './OpeningBalances'

/**
 * The six categories a Datatruck year-to-date block prints.
 *
 * STATED HERE RATHER THAN IMPORTED FROM THE GENERATED CLIENT, because a page is
 * a server component and the enum's runtime object is not what this needs — the
 * order is the order the statement prints, which no generated value knows.
 */
const OPENING_CATEGORIES = [
  'EARNINGS',
  'ADVANCES',
  'REIMBURSEMENTS',
  'DEDUCTIONS',
  'OTHER_PAY',
  'NET_PAY',
] as const
import { isMessageKey, type MessageKey } from '@/lib/i18n'
import { DRIVER_TYPES, ROSTER_STATUSES, driverStatusKey } from '../fields'
import { dateInputValue } from '../../_reference/shared'
import {
  restoreAssetAction,
  retireAssetAction,
  transferAssetAction,
} from '../../_reference/asset-actions'
import { mainCdlView } from '@/lib/driver-cdl'

export default async function EditDriverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const { t, locale } = await getLocaleContext()
  // THE TAB IS IN THE URL, Main by default, a stale value opens Main (§6.4
  // part 2). Read before the transaction so the readers a tab needs can run
  // inside it, and nothing is fetched that the open tab does not show.
  const requestedTab = recordTabFor((await searchParams)['tab'])

  // §6.8: a role without the read is REFUSED as a 404, never a 500 (sweep).
  if (!(await currentUserCan('read', 'driver'))) notFound()
  // THE RECORD IN ONE CALL (§6.4 part 2 v11.07): every read the main tab
  // makes is a CTE of one statement through the tenant reader, no
  // transaction. A tab that reads more — assets, safety, statistics, the
  // log — opens a transaction for those reads alone.
  const maySeeMoneyInLog = await currentUserCan('read', 'driver.pay')
  const data = await readCurrentOrg(
    'read',
    'driver',
    async (reader, session) => {
      const now = new Date()
      const head = await readDriverRecordHead(reader, {
        driverId: id,
        organizationId: session.organizationId,
        companyScopes: session.companyScopes,
        withSignIn: can(session, 'update', 'user'),
        now,
      })
      if (!head) return null
      const { driver, companies, authority: open } = head
      // The driver's live records with their files — the Documents list and
      // the DQF rows' on-file links read the same list.
      const filedRecords = head.compliance.map((record) => ({
        id: record.id,
        type: record.type,
        expiresAt: record.expiresAt,
        isSuperseded: record.isSuperseded,
        documents: head.complianceDocuments.get(record.id) ?? [],
      }))
      const openCompany = open
        ? (companies.find((c) => c.id === open.companyId)?.name ?? null)
        : null

      const tabReads =
        requestedTab === 'assets' ||
        requestedTab === 'safety' ||
        requestedTab === 'statistics' ||
        requestedTab === 'log'
          ? await withCurrentOrg('read', 'driver', async (tx) => ({
              assignments:
                requestedTab === 'assets'
                  ? await assignmentHistoryFor(tx, id)
                  : [],
              draws:
                requestedTab === 'safety'
                  ? await drawsForDriver(tx, id, session)
                  : [],
              stats:
                requestedTab === 'statistics'
                  ? await thirteenWeekStats(tx, id, now)
                  : null,
              netByWeek:
                requestedTab === 'statistics' && maySeeMoneyInLog
                  ? ((
                      await netPayByDriverWeek(
                        tx,
                        [id],
                        recentSundays(now, 13)[0] ?? now,
                      )
                    ).get(id) ?? [])
                  : [],
              activity:
                requestedTab === 'log'
                  ? await driverActivity(
                      tx,
                      id,
                      { maySeeMoney: maySeeMoneyInLog },
                      (note: string) => (isMessageKey(note) ? t(note) : note),
                    )
                  : { items: [], truncated: false },
            }))
          : {
              assignments: [],
              draws: [],
              stats: null,
              netByWeek: [],
              activity: { items: [], truncated: false },
            }

      return {
        driver,
        // MAIN'S LICENCE FIELDS, each empty one read from the newest CDL
        // record (driver-cdl.ts) — from the rows already read, no query. Only
        // for a role that reads compliance: the record's number must not
        // reach Main for a role that could not see it on the record.
        cdlMain: mainCdlView(
          {
            cdlNumber: driver.cdlNumber,
            cdlState: driver.cdlState,
            cdlClass: driver.cdlClass,
          },
          can(session, 'read', 'compliance') ? head.compliance : [],
        ),
        companies,
        openCompany,
        trucks: head.trucks,
        trailers: head.trailers,
        payRules: head.payRules,
        deductions: head.deductions,
        openingBalances: head.openingBalances,
        onTimeRate: head.onTimeRate,
        dqf: head.dqf,
        compliance: compliancePanelFrom(
          head.compliance,
          head.complianceDocuments,
          t,
        ),
        inspections: inspectionPanelFrom(head.inspections, t),
        timezone: head.timezone ?? 'America/Chicago',
        teamMate: head.teamMate,
        ...tabReads,
        signIn: head.signIn,
        // §6.4 part 2 v11.22 — Main in Datatruck's shape.
        dispatchers: head.dispatchers,
        driverStatus: head.driverStatus,
        photoId: photoOf(head.documents)?.id ?? null,
        // §6.4 part 2 v11.30 — the driver's documents AND its records'
        // files, each with the expiry of what it evidences.
        documents: driverDocumentList({
          documents: head.documents.map((document) => ({
            id: document.id,
            filename: document.filename,
            type: document.type,
            uploadedAt: document.uploadedAt,
            needsRotation: document.ocrStatus === 'NEEDS_ROTATION',
            superseded: document.supersededByDocumentId !== null,
          })),
          records: filedRecords,
          documentTypeFor,
        }),
        filedRecords,
      }
    },
  )

  if (!data) notFound()
  const {
    documents,
    filedRecords,
    driver,
    companies,
    openCompany,
    trucks,
    trailers,
    payRules,
    deductions,
    openingBalances,
    onTimeRate,
    dqf,
    compliance,
    inspections,
    timezone,
    teamMate,
    assignments,
    draws,
    stats,
    netByWeek,
    activity,
    signIn,
    dispatchers,
    driverStatus,
    photoId,
    cdlMain,
  } = data
  const maySeeCompliance = await currentUserCan('read', 'compliance')
  // §6.9: the selections panel exists only for a role that reads the pool.
  // ABSENT, not empty: "no draws" would tell a dispatcher this driver was
  // never selected, which is itself a disclosure.
  const maySeeRandom = await currentUserCan('read', 'randomTesting')
  // The DQF checklist is the roster one driver at a time, so it follows the
  // roster's permission: accounting reads this tab's certificates and not the
  // file built from them (§6.8, owner's ruling on GAPS 19).
  const maySeeDqf = await currentUserCan('read', 'dqf')
  const maySeeInspections = await currentUserCan('read', 'inspection')
  const mayRecordInspection = await currentUserCan('create', 'inspection')
  const mayRenewCompliance = await currentUserCan('create', 'compliance')

  const mayEdit = await currentUserCan('update', 'driver')
  // The CDL reader's route is `driver:create` (it began on Add driver).
  const mayCreateDriver = await currentUserCan('create', 'driver')
  const kindLabels = documentTypeLabels(t) as Record<string, string>
  const uploadLabels = (attach: string) => ({
    attach,
    preparing: t('compliancePanel.preparing'),
    uploading: t('compliancePanel.uploading'),
    failed: t('compliancePanel.failed'),
  })
  const mayDelete = await currentUserCan('delete', 'driver')
  // A MANAGER reads what a driver is paid; setting it is `driver.pay:update`,
  // which OWNER, ADMIN and ACCOUNTING hold. A DISPATCHER sees neither.
  const maySeePay = await currentUserCan('read', 'driver.pay')
  const maySetPay = await currentUserCan('update', 'driver.pay')
  const authorities = companies.map((c) => ({ value: c.id, label: c.name }))

  // A TAB A ROLE MAY NOT SEE IS NOT RENDERED (§6.4 part 2) — and a URL
  // naming one opens Main, the way an unknown tab does.
  // The Sign-in tab is `user:update` — OWNER and ADMIN (Phase 7 §4.6).
  const maySetSignIn = await currentUserCan('update', 'user')
  const tabs = visibleRecordTabs({
    maySeePay,
    maySeeCompliance,
    maySeeInspections,
    maySetSignIn,
  })
  const tab: RecordTab = tabs.includes(requestedTab) ? requestedTab : 'main'

  const day = (value: Date | null) =>
    value ? value.toISOString().slice(0, 10) : null

  // ── NO DELIVERIES TO JUDGE IS NOT A SCORE OF ZERO ────────────────────
  //
  // A new driver, and a driver whose arrivals nobody recorded, both have
  // `percent === null` — and "0%" would read as the worst record in the
  // company. The sentence says what is missing instead, and the figure
  // always carries the count it is over so a 100% over two loads cannot be
  // mistaken for a season.
  // ── THE FILE, COMPUTED ON EVERY READ ─────────────────────────────────
  //
  // Nothing about the checklist is stored. A "DQF complete" column would
  // be true right up until the night a medical card lapses, with no event
  // to tell it otherwise — which is item 9's argument, and this is the
  // screen an auditor reads over somebody's shoulder.
  const dqfNow = new Date()
  const dqfEntries = dqfChecklist(dqf, dqfNow)
  const dqfIncomplete = dqfIncompleteCount(dqfEntries)
  const dqfQualifiable = isQualifiable(driver)

  const dqfDay = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  // §6.4 part 2 v11.30 — EVERY ROW ITS ACTION, from its own evidence
  // (`dqfRowAction`), gated by the permission of the writer it reaches.
  const mayUploadDocument = await currentUserCan('create', 'document')
  const recordDefault = new Date(
    dqfNow.getTime() + DQF_RECORD_DEFAULT_DAYS * 86_400_000,
  )
    .toISOString()
    .slice(0, 10)
  const dqfDocuments = documents.filter(
    (document) => document.recordId === null,
  )
  const actionFor = (requirement: DqfRequirement): DqfPanelAction | null => {
    const action = dqfRowAction(requirement)
    switch (action.kind) {
      case 'upload':
        return mayUploadDocument
          ? { kind: 'upload', driverId: id, documentType: action.documentType }
          : null
      case 'record':
        return mayRenewCompliance
          ? {
              kind: 'record',
              driverId: id,
              complianceType: action.complianceType,
              defaultExpires: recordDefault,
            }
          : null
    }
  }
  const dqfRows: DqfPanelRow[] = dqfEntries.map((entry, index) => {
    const requirement = DQF_REQUIREMENTS[index]!
    const onFile =
      entry.status === 'missing'
        ? null
        : dqfOnFileDocument(requirement, dqfDocuments, filedRecords)
    const record = onFile ? null : dqfOnFileRecord(requirement, filedRecords)
    return {
      action: actionFor(requirement),
      onFile,
      attach:
        record && mayUploadDocument && mayRenewCompliance
          ? {
              recordId: record.id,
              documentType: documentTypeFor(record.type as ComplianceType),
            }
          : null,
      key: entry.key,
      label: t(`dqf.key.${entry.key}` as MessageKey),
      cfr: entry.cfr,
      cadenceLabel: t(`dqf.cadence.${entry.cadence}` as MessageKey),
      status: entry.status,
      statusLabel: t(`dqf.status.${entry.status}` as MessageKey),
      // "SINCE" PRINTS A DATE OR NOTHING, and never the hire date (§6.4 part 2
      // v11.34): a due or expired record's expiry, else nothing.
      since: entry.dueSince !== null ? dqfDay.format(entry.dueSince) : null,
    }
  })

  const dqfSummary =
    dqfIncomplete === 0
      ? t('dqf.complete')
      : t('dqf.incomplete')
          .replace('{count}', String(dqfIncomplete))
          .replace('{total}', String(DQF_REQUIREMENTS.length))

  const onTimeLabel =
    onTimeRate.percent === null
      ? t('dispatch.onTimeRate.none')
      : t('dispatch.onTimeRate.value')
          .replace('{percent}', String(onTimeRate.percent))
          .replace('{counted}', String(onTimeRate.counted))

  // The figure each rule turns on, rendered from its own integer column — bps
  // for percentages, cents for the other two. Never from a float.
  const payRuleViews: PayRuleRowView[] = payRules.map((rule) => ({
    id: rule.id,
    type: rule.type,
    typeLabel: t(`payRule.${rule.type}` as MessageKey),
    figure:
      rule.percentBps !== null
        ? `${bpsToInput(rule.percentBps)}%`
        : rule.perMileCents !== null
          ? `${formatCents(rule.perMileCents, locale)} / mi`
          : rule.flatCents !== null
            ? formatCents(rule.flatCents, locale)
            : '—',
    from: day(rule.effectiveFrom) ?? '—',
    to: day(rule.effectiveTo),
    isCurrent: rule.isCurrent,
    notes: rule.notes,
  }))

  // ── THE FIGURE EACH DEDUCTION TURNS ON, FROM ITS OWN CENTS COLUMN ───────
  //
  // A monthly split prints both halves — `$450.00 / wk of $1,800.00` — because
  // the weekly figure alone is the one an accountant cannot check against the
  // statement, which prints the pair.
  const deductionViews: DeductionRowView[] = deductions.map((row) => ({
    id: row.id,
    type: row.type,
    description: row.description,
    figure:
      row.cadence === 'MONTHLY_SPLIT_WEEKLY' && row.monthlyTotalCents !== null
        ? `${formatCents(row.amountCents, locale)} / wk of ${formatCents(
            row.monthlyTotalCents,
            locale,
          )}`
        : `${formatCents(row.amountCents, locale)} / wk`,
    target:
      row.targetCents === null
        ? null
        : `${formatCents(row.targetCents, locale)} target`,
    from: day(row.effectiveFrom) ?? '—',
    to: day(row.effectiveTo),
    isRunning: row.effectiveTo === null,
  }))

  const openingViews: OpeningRowView[] = openingBalances.map((row) => ({
    id: row.id,
    category: row.category,
    categoryLabel: row.category,
    // SIGNED AS STORED. Deductions are negative and print negative; making them
    // positive here would disagree with the statement and with what was typed.
    amount: formatCents(row.amountCents, locale),
    asOf: day(row.asOf) ?? '—',
    source: row.source,
  }))

  const PAY_ERROR_KEYS: MessageKey[] = [
    'payRule.error.driverNotFound',
    'payRule.error.customUnsupported',
    'payRule.error.badPercent',
    'payRule.error.badPerMile',
    'payRule.error.badFlat',
    'payRule.error.badDates',
    'payRule.error.overlaps',
    'deduction.error.driverNotFound',
    'deduction.error.unknownType',
    'deduction.error.badAmount',
    'deduction.error.badMonthlyTotal',
    'deduction.error.badTarget',
    'deduction.error.badDates',
    'deduction.error.overlaps',
    'opening.error.driverNotFound',
    'opening.error.badYear',
    'opening.error.badAmount',
    'opening.error.badDates',
    'opening.error.noSource',
  ]
  const translate = Object.fromEntries(
    PAY_ERROR_KEYS.map((key) => [key, t(key)]),
  )
  const truckOptions = trucks.map((truck) => ({
    value: truck.id,
    label: `${truck.unitNumber} · ${truck.company.name}`,
  }))
  // No authority in the label: every one of these is under the driver's
  // own, which is the only authority this screen offers.
  const trailerOptions = trailers.map((trailer) => ({
    value: trailer.id,
    label: trailer.unitNumber,
  }))

  // ── MAIN IN DATATRUCK'S SHAPE (§6.4 part 2, v11.22) ────────────────────
  //
  // Two columns of sections, one form. Every field `updateDriver` writes
  // unconditionally is here — a field left out would be posted as absent and
  // cleared — and the four new ones are written only when sent. The derived
  // facts are text: driver status from `dispatchStatusFrom`, tenure from
  // `tenureOf`, the team from `team.ts`, the authority from the record.
  const tenure = tenureOf(driver.hireDate, driver.terminationDate, new Date())
  const authorityName =
    openCompany ??
    companies.find((c) => c.id === driver.companyId)?.name ??
    null
  const mainLeft: DriverMainSection[] = [
    {
      title: t('drivers.main.personal'),
      lead: (
        <DriverPhoto
          driverId={id}
          documentId={photoId}
          initials={`${driver.firstName.slice(0, 1)}${driver.lastName.slice(0, 1)}`}
          mayUpload={mayEdit && (await currentUserCan('create', 'document'))}
          labels={{
            photo: t('drivers.photo'),
            upload: t('drivers.photoUpload'),
            failed: t('drivers.photoFailed'),
          }}
        />
      ),
      items: [
        {
          field: {
            name: 'firstName',
            label: t('drivers.firstName'),
            kind: 'text',
            required: true,
          },
        },
        {
          field: {
            name: 'middleName',
            label: t('drivers.middleName'),
            kind: 'text',
          },
        },
        {
          field: {
            name: 'lastName',
            label: t('drivers.lastName'),
            kind: 'text',
            required: true,
          },
        },
        {
          field: {
            name: 'birthDate',
            label: t('drivers.birthDate'),
            kind: 'date',
          },
        },
        { field: { name: 'phone', label: t('drivers.phone'), kind: 'tel' } },
        {
          field: {
            name: 'telegram',
            label: t('drivers.telegram'),
            kind: 'text',
          },
        },
        { field: { name: 'email', label: t('drivers.email'), kind: 'email' } },
        // THE ADDRESS STAYS (§6.4 part 2 v11.22, kept beyond the brief): it is
        // stored only here, and pay-to and the 1099 read it.
        {
          field: {
            name: 'addressLine1',
            label: t('drivers.addressLine1'),
            kind: 'text',
            hint: t('drivers.addressHint'),
          },
        },
        {
          field: {
            name: 'addressCity',
            label: t('drivers.addressCity'),
            kind: 'text',
          },
        },
        {
          field: {
            name: 'addressState',
            label: t('drivers.addressState'),
            kind: 'text',
          },
        },
        {
          field: {
            name: 'addressPostalCode',
            label: t('drivers.addressPostalCode'),
            kind: 'text',
          },
        },
        {
          field: {
            name: 'status',
            label: t('drivers.employmentStatus'),
            kind: 'select',
            options: ROSTER_STATUSES.map((status) => ({
              value: status,
              label: t(driverStatusKey(status)),
            })),
          },
        },
        {
          fact: {
            label: t('drivers.driverStatus'),
            value: t(`dispatch.status.${driverStatus}` as MessageKey),
            hint: t('drivers.driverStatusHint'),
          },
        },
        {
          field: {
            name: 'hireDate',
            label: t('drivers.hireDate'),
            kind: 'date',
          },
        },
        {
          fact: {
            label: t('drivers.tenure'),
            value: tenure
              ? t('drivers.tenureValue')
                  .replace('{years}', String(tenure.years))
                  .replace('{months}', String(tenure.months))
              : '—',
          },
        },
      ],
    },
    {
      title: t('drivers.main.compliance'),
      items: [
        {
          field: {
            name: 'cdlNumber',
            label: t('drivers.cdlNumber'),
            kind: 'text',
            mono: true,
            hint: cdlMain.fromRecord.includes('cdlNumber')
              ? t('drivers.cdlFromRecord')
              : undefined,
          },
        },
        {
          field: {
            name: 'cdlState',
            label: t('drivers.cdlState'),
            kind: 'text',
            hint: cdlMain.fromRecord.includes('cdlState')
              ? t('drivers.cdlFromRecord')
              : undefined,
          },
        },
        {
          field: {
            name: 'cdlClass',
            label: t('drivers.cdlClass'),
            kind: 'text',
          },
        },
        {
          field: {
            name: 'driverType',
            label: t('drivers.employment'),
            kind: 'select',
            options: DRIVER_TYPES.map((type) => ({
              value: type,
              label: t(`drivers.type.${type}` as MessageKey),
            })),
          },
        },
        {
          field: {
            name: 'kind',
            label: t('drivers.kind'),
            kind: 'select',
            options: DRIVER_KINDS.map((kind) => ({
              value: kind,
              label: t(`drivers.kind.${kind}` as MessageKey),
            })),
          },
        },
        // STORED ON SAFETY, LINKED HERE — not a second copy of a date that
        // raises an alarm (§6.4 part 2 v11.22).
        {
          note: (
            <>
              {t('drivers.safetyLink')}{' '}
              {tabs.includes('safety') ? (
                <Link
                  href={`/drivers/${id}?tab=safety`}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {t('drivers.safetyLinkAction')}
                </Link>
              ) : null}
            </>
          ),
        },
      ],
    },
  ]
  const mainRight: DriverMainSection[] = [
    {
      title: t('drivers.main.assignments'),
      items: [
        {
          field: {
            name: 'assignedTruckId',
            label: t('drivers.assignedTruck'),
            kind: 'select',
            options: [
              { value: '', label: t('drivers.assignedTruckNone') },
              ...truckOptions,
            ],
          },
        },
        {
          field: {
            name: 'assignedTrailerId',
            label: t('drivers.assignedTrailer'),
            kind: 'select',
            options: [
              { value: '', label: t('drivers.assignedTrailerNone') },
              ...trailerOptions,
            ],
          },
        },
        { fact: { label: t('ref.authority'), value: authorityName ?? '—' } },
        {
          field: {
            name: 'dispatcherUserId',
            label: t('drivers.dispatcher'),
            kind: 'select',
            options: [
              { value: '', label: t('drivers.dispatcherNone') },
              ...dispatchers.map((user) => ({
                value: user.id,
                label: user.name,
              })),
            ],
          },
        },
        { field: { name: 'notes', label: t('ref.notes'), kind: 'textarea' } },
        {
          field: {
            name: 'tags',
            label: t('drivers.tags'),
            kind: 'text',
            hint: t('drivers.tagsHint'),
          },
        },
      ],
    },
    {
      // DERIVED (owner's ruling 2026-11-17, "keep derived"): two drivers on
      // one truck are a team, read from `team.ts`; there is nothing to set.
      title: t('drivers.main.team'),
      items: [
        {
          fact: {
            label: t('drivers.teamDriver'),
            value: teamMate ? t('drivers.teamYes') : t('drivers.teamNo'),
          },
        },
        ...(teamMate
          ? [
              {
                fact: {
                  label: t('drivers.teamCoDriver'),
                  value: (
                    <>
                      <Link
                        href={`/drivers/${teamMate.id}`}
                        className="text-ink underline-offset-2 hover:underline"
                      >
                        {teamMate.firstName} {teamMate.lastName}
                      </Link>{' '}
                      <span className="font-mono text-sm text-ink-3">
                        · {teamMate.truckUnit}
                      </span>
                    </>
                  ),
                },
              },
            ]
          : []),
        { note: t('drivers.teamHint') },
      ],
    },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">
          {t('drivers.edit')}{' '}
          <span className="text-ink-2">
            {driver.firstName} {driver.lastName}
          </span>{' '}
          {/* §6.2.10 part 6: what this person IS, in the office's word, beside
           * the name — not only inside the form below, where it is a select,
           * and a select is where you change a thing rather than read it. */}
          <span className="text-xs font-normal text-ink-3">
            {t(`drivers.type.${driver.driverType}` as MessageKey)}
          </span>
          {teamMate ? (
            <span className="ms-z2 text-xs font-normal text-ink-3">
              {t('team.with')}{' '}
              <Link
                href={`/drivers/${teamMate.id}`}
                className="text-ink-2 underline-offset-2 hover:underline"
              >
                {teamMate.firstName} {teamMate.lastName}
              </Link>
            </span>
          ) : null}
        </h1>
        {/* OPERATIONAL, SO IT IS UNGATED. A dispatcher deciding who to
         * offer a load to needs this; it is a record of arrivals, not a
         * figure from the pay panel below. */}
        <p className="max-w-[420px] text-end text-xs text-ink-3">
          <span className="uppercase tracking-[0.04em]">
            {t('dispatch.onTimeRate')}
          </span>{' '}
          <span className="text-ink-2">{onTimeLabel}</span>
        </p>
      </div>

      <Tabs
        tabs={tabs.map((key) => ({
          key,
          label: t(`drivers.recordTab.${key}` as MessageKey),
        }))}
        active={tab}
        hrefFor={(key) =>
          key === 'main' ? `/drivers/${id}` : `/drivers/${id}?tab=${key}`
        }
        label={t('drivers.edit')}
      />

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        {/* ── A TAB WITH NOTHING BEHIND IT SAYS SO IN WORDS (§6.4 part 2) ──
         * One sentence: the fact, and what the tab will carry. Never an empty
         * panel, never a placeholder control. */}
        {EMPTY_TABS.includes(tab) ? (
          <div className="max-w-[720px]">
            <EmptyState
              title={t(`drivers.recordTab.${tab}` as MessageKey)}
              body={t(`drivers.recordTab.${tab}.empty` as MessageKey)}
            />
          </div>
        ) : null}

        {tab === 'main' ? (
          <DriverMainForm
            left={mainLeft}
            right={mainRight}
            values={{
              firstName: driver.firstName,
              middleName: driver.middleName ?? '',
              lastName: driver.lastName,
              birthDate: dateInputValue(driver.birthDate),
              phone: driver.phone ?? '',
              telegram: driver.telegram ?? '',
              email: driver.email ?? '',
              addressLine1: driver.addressLine1 ?? '',
              addressCity: driver.addressCity ?? '',
              addressState: driver.addressState ?? '',
              addressPostalCode: driver.addressPostalCode ?? '',
              cdlNumber: cdlMain.values.cdlNumber ?? '',
              cdlState: cdlMain.values.cdlState ?? '',
              cdlClass: cdlMain.values.cdlClass ?? '',
              hireDate: dateInputValue(driver.hireDate),
              status: driver.status,
              driverType: driver.driverType,
              notes: driver.notes ?? '',
              kind: driver.kind,
              tags: tagsToInput(driver.tags),
              assignedTruckId: driver.assignedTruckId ?? '',
              assignedTrailerId: driver.assignedTrailerId ?? '',
              dispatcherUserId: driver.dispatcherUserId ?? '',
            }}
            action={updateDriverAction.bind(null, id)}
            cancelHref="/drivers"
            labels={{ save: t('ref.save'), cancel: t('ref.cancel') }}
            readOnly={!mayEdit}
          >
            {mayEdit ? (
              <AssetActions
                kind="driver"
                id={id}
                isRetired={driver.deletedAt !== null}
                authorities={authorities.filter(
                  (a) => a.value !== driver.companyId,
                )}
                currentAuthorityName={
                  openCompany ??
                  companies.find((c) => c.id === driver.companyId)?.name ??
                  null
                }
                transferAction={transferAssetAction.bind(null, 'driver', id)}
                {...(mayDelete
                  ? { retireAction: retireAssetAction.bind(null, 'driver', id) }
                  : {})}
                restoreAction={restoreAssetAction.bind(null, 'driver', id)}
                labels={{
                  transfer: t('ref.transfer'),
                  transferTitle: t('ref.transferTitle'),
                  transferBody: t('ref.transferBody'),
                  transferTo: t('ref.transferTo'),
                  transferReason: t('ref.transferReason'),
                  transferConfirm: t('ref.transferConfirm'),
                  retire: t('ref.retire'),
                  retireConfirm: t('ref.retireConfirm'),
                  retireBody: t('ref.retireBody'),
                  restore: t('ref.restore'),
                  cancel: t('ref.cancel'),
                  currentAuthority: t('ref.currentAuthority'),
                  noOpenPeriod: t('ref.noOpenPeriod'),
                }}
              />
            ) : null}
          </DriverMainForm>
        ) : null}

        {/* THE SIGN-IN TAB (Phase 7 step 1; §6.4 part 2, §9 "The link").
         * The tab is rendered for OWNER and ADMIN only, and `signIn` is null
         * for every other role — left out of the payload, the rule — so the
         * two guards agree and nobody else gets a card, hidden or not. */}
        {tab === 'mobile' && signIn ? (
          <SignInLink
            driverId={id}
            linked={
              signIn.linked
                ? {
                    ...signIn.linked,
                    lastSignIn: signIn.linked.lastLoginAt
                      ? new Intl.DateTimeFormat(locale, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: timezone,
                        }).format(signIn.linked.lastLoginAt)
                      : null,
                  }
                : null
            }
            candidates={signIn.candidates}
            terminated={driver.terminationDate !== null}
            labels={{
              title: t('drivers.signIn'),
              hint: t('drivers.signIn.hint'),
              none: t('drivers.signIn.none'),
              linked: t('drivers.signIn.linked'),
              deactivated: t('drivers.signIn.deactivated'),
              lastSignIn: t('drivers.signIn.lastSignIn'),
              never: t('drivers.signIn.never'),
              pick: t('drivers.signIn.pick'),
              noCandidates: t('drivers.signIn.noCandidates'),
              newUser: t('users.add'),
              terminated: t('drivers.signIn.terminated'),
              link: t('drivers.signIn.link'),
              linking: t('drivers.signIn.linking'),
              unlink: t('drivers.signIn.unlink'),
              saved: t('drivers.signIn.saved'),
            }}
          />
        ) : null}

        {/* NEVER SENT TO A ROLE THAT CANNOT SEE IT. A dispatcher gets no
         * payload at all here — not a hidden panel, not a disabled one. Rule:
         * leave it out, because hiding it in CSS is the same bug as not
         * checking at all. */}
        {/* PHASE 4 §5 STEP 2. A driver's CDL and medical card, on the screen
         * that already carries their licence details. Operational, so a
         * DISPATCHER sees it — unlike the pay panel below. */}
        {/* THE DOCUMENT LIST, ABOVE THE COMPLIANCE PANEL. A card parked as
         * "not read — needs rotation" has no compliance row to appear under,
         * and it is the thing somebody has to act on — so it is not filed
         * below the records that are already in order. */}
        {tab === 'documents' && maySeeCompliance ? (
          <div className="max-w-[900px]">
            <DriverDocuments
              documents={documents}
              driverId={id}
              mayRead={mayRenewCompliance}
              mayUpload={mayUploadDocument}
              kinds={DRIVER_DOCUMENT_KINDS.map((kind) => ({
                value: kind,
                label: kindLabels[kind] ?? kind,
              }))}
              kindLabels={kindLabels}
              labels={{
                heading: t('documents.heading'),
                none: t('documents.none'),
                kind: t('documents.kind'),
                uploaded: t('documents.uploaded'),
                expires: t('documents.expires'),
                open: t('compliancePanel.failed'),
                upload: uploadLabels(t('documents.upload')),
                needsRotation: t('documents.needsRotation'),
                superseded: t('documents.superseded'),
                rotateAndRead: t('documents.rotateAndRead'),
                working: t('documents.working'),
                readOk: t('documents.readOk'),
                readFailed: t('documents.readFailed'),
                upright: {
                  title: t('upright.title'),
                  hint: t('upright.hint'),
                  rotateLeft: t('upright.rotateLeft'),
                  rotateRight: t('upright.rotateRight'),
                  read: t('upright.read'),
                  cancel: t('upright.cancel'),
                },
              }}
            />
            {/* THE READERS WHERE ONE EXISTS (§6.4 part 2 v11.30): the medical
             * card with this driver stated — the Safety screen's own flow — and
             * the CDL, which proposes the licence record. Both read, then
             * confirm; nothing is filed by a read. */}
            {mayRenewCompliance ? (
              <div className="mt-z4 rounded-card border border-border bg-surface p-z4">
                <h2 className="text-md font-medium text-ink">
                  {t('documents.readMedical')}
                </h2>
                <div className="mt-z3 max-w-[520px]">
                  <MedicalCertUpload
                    driverId={id}
                    driverLabel={`${driver.firstName} ${driver.lastName}`}
                    labels={medLabels(t)}
                  />
                </div>
              </div>
            ) : null}
            {mayRenewCompliance && mayCreateDriver ? (
              <div className="mt-z4">
                <CdlReader
                  driverId={id}
                  onMain={{
                    cdlNumber: driver.cdlNumber ?? '',
                    cdlState: driver.cdlState ?? '',
                    cdlClass: driver.cdlClass ?? '',
                  }}
                  translate={compliance.translate}
                  labels={{
                    title: t('documents.readCdl'),
                    hint: t('documents.readCdlHint'),
                    drop: {
                      title: t('drivers.cdl.dropTitle'),
                      body: t('drivers.cdl.dropBody'),
                      hint: t('drivers.cdl.dropHint'),
                      busy: t('drivers.cdl.reading'),
                    },
                    number: t('drivers.cdlNumber'),
                    state: t('drivers.cdlState'),
                    class: t('drivers.cdlClass'),
                    expires: t('compliancePanel.expires'),
                    onMain: t('documents.onMain'),
                    file: t('documents.cdlFile'),
                    discard: t('drivers.med.discard'),
                    filed: t('documents.cdlFiled'),
                    keptFailed: t('documents.cdlKeptFailed'),
                    failed: t('drivers.cdl.failed'),
                    unreadable: t('drivers.cdl.unreadable'),
                    upright: {
                      title: t('upright.title'),
                      hint: t('upright.hint'),
                      rotateLeft: t('upright.rotateLeft'),
                      rotateRight: t('upright.rotateRight'),
                      read: t('upright.read'),
                      cancel: t('upright.cancel'),
                    },
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ABOVE THE COMPLIANCE PANEL, because it is the question and that
         * is half the answer: five of the eight requirements are the
         * records listed below, and the other three are documents listed
         * above. Reading the verdict first and the evidence after is the
         * order an audit goes in. */}
        {tab === 'safety' && maySeeDqf ? (
          <div className="max-w-[900px]">
            <DqfPanel
              rows={dqfRows}
              summary={dqfSummary}
              qualifiable={dqfQualifiable}
              translate={compliance.translate}
              labels={{
                title: t('dqf.title'),
                hint: t('dqf.hint'),
                since: t('dqf.since'),
                notQualifiable: t('dqf.notQualifiable'),
                renew: t('dqf.action.renew'),
                openFailed: t('compliancePanel.failed'),
                upload: uploadLabels(t('documents.upload')),
                attach: uploadLabels(t('compliancePanel.attach')),
                record: {
                  record: t('dqf.action.record'),
                  expires: t('compliancePanel.expires'),
                  done: t('dqf.action.done'),
                  save: t('compliancePanel.save'),
                  cancel: t('ref.cancel'),
                },
              }}
            />
          </div>
        ) : null}

        {tab === 'safety' && maySeeCompliance ? (
          <div className="mt-z4 max-w-[900px]">
            <CompliancePanel
              subject="driver"
              subjectId={id}
              rows={compliance.rows}
              types={compliance.types}
              documentTypeFor={compliance.documentTypeFor}
              mayRenew={mayRenewCompliance}
              today={compliance.today}
              translate={compliance.translate}
              labels={
                compliance.labels as Parameters<
                  typeof CompliancePanel
                >[0]['labels']
              }
            />
          </div>
        ) : null}

        {tab === 'accounting' && maySeePay ? (
          <div className="max-w-[860px] rounded-card border border-border bg-surface p-z4">
            <h2 className="text-md font-medium text-ink">
              {t('drivers.accounting.payTo')}
            </h2>
            {/* WHO THE STATEMENT IS MADE OUT TO — its own form under
             * `driver.pay:update` (§6.4 part 2, queue item 17). Read at
             * generation and frozen onto the statement, so a change here
             * reaches the next statement and restates nothing issued. */}
            <PayToForm
              driverId={id}
              payToName={driver.payToName}
              payToAddress={driver.payToAddress}
              disabled={!maySetPay}
              labels={{
                name: t('drivers.accounting.payToName'),
                address: t('drivers.accounting.payToAddress'),
                save: t('ref.save'),
                saving: t('ref.saving'),
                saved: t('drivers.accounting.payToSaved'),
                hint: t('drivers.accounting.payToSource'),
              }}
            />
          </div>
        ) : null}

        {tab === 'accounting' && maySeePay ? (
          <div className="mt-z4 max-w-[860px]">
            <PayRules
              driverId={id}
              rules={payRuleViews}
              types={PAY_RULE_TYPES.map((type) => ({
                value: type,
                label: t(`payRule.${type}` as MessageKey),
              }))}
              today={new Date().toISOString().slice(0, 10)}
              translate={translate}
              labels={{
                title: t('payRule.title'),
                hint: t('payRule.hint'),
                add: maySetPay ? t('payRule.add') : t('payRule.title'),
                type: t('payRule.type'),
                percent: t('payRule.percent'),
                perMile: t('payRule.perMile'),
                flat: t('payRule.flat'),
                from: t('payRule.from'),
                to: t('payRule.to'),
                toHint: t('payRule.toHint'),
                open: t('payRule.open'),
                notes: t('payRule.notes'),
                save: t('payRule.save'),
                close: t('payRule.close'),
                closeHint: t('payRule.closeHint'),
                none: t('payRule.none'),
                grossHint: t('payRule.grossHint'),
                linehaulHint: t('payRule.linehaulHint'),
              }}
              readOnly={!maySetPay}
            />
          </div>
        ) : null}

        {/* THE SAME PERMISSION AS THE PAY RULES, because a deduction changes
         * what a driver is paid. See deduction-actions.ts. */}
        {tab === 'accounting' && maySeePay ? (
          <div className="mt-z4 max-w-[860px]">
            <Deductions
              driverId={id}
              rows={deductionViews}
              types={DEDUCTION_TYPES.map((type) => ({
                value: type,
                label: type,
              }))}
              cadences={[
                {
                  value: 'WEEKLY',
                  label: t('deduction.cadence.weekly'),
                },
                {
                  value: 'MONTHLY_SPLIT_WEEKLY',
                  label: t('deduction.cadence.monthly'),
                },
              ]}
              today={new Date().toISOString().slice(0, 10)}
              translate={translate}
              readOnly={!maySetPay}
              labels={{
                title: t('deduction.title'),
                hint: t('deduction.hint'),
                add: t('deduction.add'),
                type: t('deduction.type'),
                description: t('deduction.description'),
                descriptionHint: t('deduction.descriptionHint'),
                amount: t('deduction.amount'),
                cadence: t('deduction.cadence'),
                monthlyTotal: t('deduction.monthlyTotal'),
                monthlyTotalHint: t('deduction.monthlyTotalHint'),
                target: t('deduction.target'),
                targetHint: t('deduction.targetHint'),
                from: t('deduction.from'),
                to: t('deduction.to'),
                toHint: t('deduction.toHint'),
                open: t('deduction.open'),
                notes: t('deduction.notes'),
                save: t('deduction.save'),
                close: t('deduction.close'),
                closeHint: t('deduction.closeHint'),
                none: t('deduction.none'),
              }}
            />
          </div>
        ) : null}

        {tab === 'accounting' && maySeePay ? (
          <div className="mt-z4 max-w-[860px]">
            <OpeningBalances
              driverId={id}
              rows={openingViews}
              categories={OPENING_CATEGORIES.map((category) => ({
                value: category,
                label: category,
              }))}
              year={new Date().getUTCFullYear()}
              today={new Date().toISOString().slice(0, 10)}
              translate={translate}
              readOnly={!maySetPay}
              labels={{
                title: t('opening.title'),
                hint: t('opening.hint'),
                year: t('opening.year'),
                category: t('opening.category'),
                amount: t('opening.amount'),
                amountHint: t('opening.amountHint'),
                asOf: t('opening.asOf'),
                source: t('opening.source'),
                sourceHint: t('opening.sourceHint'),
                notes: t('opening.notes'),
                save: t('opening.save'),
                none: t('opening.none'),
                replaces: t('opening.replaces'),
              }}
            />
          </div>
        ) : null}

        {/* PHASE 4 §5 STEP 4. Read-only: an inspection is recorded from
         * /safety/inspections/new, where the truck, the trailer and the driver
         * can all be named at once. A panel that could file one from here
         * would have to guess the other two. */}
        {tab === 'safety' && maySeeRandom ? (
          <div className="mt-z4 max-w-[900px]">
            <DrawsPanel
              rows={draws}
              locale={locale}
              labels={{
                title: t('drivers.safety.draws'),
                none: t('drivers.safety.drawsNone'),
                quarter: t('drivers.safety.quarter'),
                drawn: t('drivers.safety.drawn'),
                outcome: t('drivers.safety.outcome'),
                tested: t('drivers.safety.tested'),
              }}
            />
          </div>
        ) : null}

        {tab === 'safety' && maySeeInspections ? (
          <div className="mt-z4 max-w-[900px]">
            <InspectionPanel
              rows={inspections.rows}
              {...(mayRecordInspection
                ? {
                    record: {
                      href: '/safety/inspections/new',
                      label: t('ins.record'),
                    },
                  }
                : {})}
              labels={
                inspections.labels as Parameters<
                  typeof InspectionPanel
                >[0]['labels']
              }
            />
          </div>
        ) : null}

        {tab === 'assets' ? (
          <AssetsTab
            current={{
              truck:
                trucks.find((truck) => truck.id === driver.assignedTruckId)
                  ?.unitNumber ?? null,
              trailer:
                trailers.find(
                  (trailer) => trailer.id === driver.assignedTrailerId,
                )?.unitNumber ?? null,
            }}
            history={assignments}
            locale={locale}
            labels={{
              current: t('drivers.assets.current'),
              truck: t('loads.column.truck'),
              trailer: t('drivers.assets.trailer'),
              history: t('drivers.assets.history'),
              none: t('drivers.assets.none'),
              from: t('drivers.assets.from'),
              to: t('drivers.assets.to'),
              authority: t('ref.authority'),
              reason: t('ref.transferReason'),
              by: t('loads.by'),
              open: t('drivers.assets.open'),
            }}
          />
        ) : null}

        {tab === 'statistics' && stats ? (
          <div className="max-w-[720px] rounded-card border border-border bg-surface p-z4">
            <h2 className="text-md font-medium text-ink">
              {t('drivers.recordTab.statistics')}
            </h2>
            {/* FIGURES, EACH WITH THE WINDOW IT COUNTS (§6.4 part 2); no chart
             * §6.1.1 would then have to govern. */}
            <dl className="mt-z3 grid grid-cols-[auto_1fr] gap-x-z5 gap-y-z2 text-sm">
              <dt className="text-ink-3">{t('dispatch.onTimeRate')}</dt>
              <dd className="text-ink">{onTimeLabel}</dd>
              <dt className="text-ink-3">{t('drivers.stats.loads13')}</dt>
              <dd className="font-mono tabular-nums text-ink">{stats.loads}</dd>
              <dt className="text-ink-3">{t('drivers.stats.miles13')}</dt>
              <dd className="font-mono tabular-nums text-ink">
                {stats.miles.toLocaleString(locale)}
              </dd>
              {maySeePay ? (
                <>
                  <dt className="text-ink-3">{t('drivers.stats.net13')}</dt>
                  <dd className="font-mono tabular-nums text-ink">
                    {formatMoney(
                      netByWeek.reduce((sum, point) => sum + point.netCents, 0),
                      locale,
                    )}
                    <span className="ms-z2 text-xs text-ink-3">
                      {netByWeek.length} {t('drivers.stats.weeksPaid')}
                    </span>
                  </dd>
                </>
              ) : null}
            </dl>
            <p className="mt-z3 text-xs text-ink-3">
              {t('drivers.stats.window').replace(
                '{from}',
                new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                  stats.from,
                ),
              )}
            </p>
          </div>
        ) : null}

        {tab === 'log' ? (
          <div className="max-w-[900px]">
            <ActivityTimeline
              entries={activity.items}
              truncated={activity.truncated}
              statusLabels={{}}
              documentTypeLabels={documentTypeLabels(t)}
              locale={locale}
              timeZone={timezone}
              labels={{
                title: t('drivers.recordTab.log'),
                empty: t('drivers.log.empty'),
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
                // A translated field name where the form has one, a humanised
                // column name where it does not.
                field: (name: string) => {
                  const key = `drivers.${name}`
                  return isMessageKey(key) ? t(key) : humaniseField(name)
                },
              }}
            />
          </div>
        ) : null}

        {tab === 'others' ? (
          <div className="max-w-[720px] rounded-card border border-border bg-surface p-z4">
            <h2 className="text-md font-medium text-ink">
              {t('drivers.recordTab.others')}
            </h2>
            <dl className="mt-z3 grid grid-cols-[auto_1fr] gap-x-z5 gap-y-z2 text-sm">
              <dt className="text-ink-3">{t('drivers.others.kind')}</dt>
              <dd className="text-ink">
                {t(`drivers.kind.${driver.kind}` as MessageKey)}
              </dd>
              <dt className="text-ink-3">{t('drivers.others.tags')}</dt>
              <dd className="flex flex-wrap gap-z1">
                {driver.tags.length === 0
                  ? '—'
                  : driver.tags.map((tag) => (
                      <Link
                        key={tag}
                        href={`/drivers?tag=${encodeURIComponent(tag)}`}
                        className="rounded-control border border-border-strong bg-surface-2 px-z2 text-xs text-ink-2 hover:text-accent"
                      >
                        {tag}
                      </Link>
                    ))}
              </dd>
              <dt className="text-ink-3">{t('ref.notes')}</dt>
              <dd className="whitespace-pre-wrap text-ink">
                {driver.notes ?? '—'}
              </dd>
            </dl>
            {/* READ-ONLY. Notes change on Main; kind and tags came from the import
             * and have no editor yet (§6.4 part 2, GAPS). */}
            <p className="mt-z3 text-xs text-ink-3">
              {t('drivers.others.source')}
            </p>
          </div>
        ) : null}
      </div>
    </>
  )
}

// ── THE TWO SMALL TABLES THE NEW TABS DRAW ───────────────────────────────

function DrawsPanel({
  rows,
  locale,
  labels,
}: {
  rows: readonly DriverDraw[]
  locale: string
  labels: {
    title: string
    none: string
    quarter: string
    drawn: string
    outcome: string
    tested: string
  }
}) {
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const columns: Column<DriverDraw>[] = [
    {
      key: 'quarter',
      header: labels.quarter,
      render: (row) => `${row.year} Q${row.quarter}`,
    },
    {
      key: 'drawn',
      header: labels.drawn,
      render: (row) => day.format(row.drawnAt),
    },
    { key: 'outcome', header: labels.outcome, render: (row) => row.outcome },
    {
      key: 'tested',
      header: labels.tested,
      render: (row) => (row.testedAt ? day.format(row.testedAt) : '—'),
    },
  ]
  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>
      <div className="mt-z3">
        <Table
          caption={labels.title}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          empty={<p className="text-sm text-ink-3">{labels.none}</p>}
        />
      </div>
    </section>
  )
}

function AssetsTab({
  current,
  history,
  locale,
  labels,
}: {
  current: { truck: string | null; trailer: string | null }
  history: readonly AssignmentPeriod[]
  locale: string
  labels: {
    current: string
    truck: string
    trailer: string
    history: string
    none: string
    from: string
    to: string
    authority: string
    reason: string
    by: string
    open: string
  }
}) {
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const columns: Column<AssignmentPeriod>[] = [
    { key: 'from', header: labels.from, render: (row) => day.format(row.from) },
    {
      key: 'to',
      header: labels.to,
      render: (row) => (row.to ? day.format(row.to) : labels.open),
    },
    {
      key: 'truck',
      header: labels.truck,
      render: (row) => (
        <span className="font-mono">{row.truckUnit ?? '—'}</span>
      ),
    },
    {
      key: 'trailer',
      header: labels.trailer,
      render: (row) => (
        <span className="font-mono">{row.trailerUnit ?? '—'}</span>
      ),
    },
    {
      key: 'authority',
      header: labels.authority,
      truncate: true,
      render: (row) => row.companyName,
    },
    {
      key: 'reason',
      header: labels.reason,
      truncate: true,
      render: (row) => row.reason ?? '—',
    },
    { key: 'by', header: labels.by, render: (row) => row.byName ?? '—' },
  ]
  return (
    <div className="max-w-[900px]">
      <section className="rounded-card border border-border bg-surface p-z4">
        <h2 className="text-md font-medium text-ink">{labels.current}</h2>
        <dl className="mt-z2 grid grid-cols-[auto_1fr] gap-x-z4 gap-y-z1 text-sm">
          <dt className="text-ink-3">{labels.truck}</dt>
          <dd className="font-mono text-ink">{current.truck ?? '—'}</dd>
          <dt className="text-ink-3">{labels.trailer}</dt>
          <dd className="font-mono text-ink">{current.trailer ?? '—'}</dd>
        </dl>
      </section>
      <section className="mt-z4 rounded-card border border-border bg-surface p-z4">
        <h2 className="text-md font-medium text-ink">{labels.history}</h2>
        <div className="mt-z3">
          <Table
            caption={labels.history}
            columns={columns}
            rows={history}
            rowKey={(row) => row.id}
            empty={<p className="text-sm text-ink-3">{labels.none}</p>}
          />
        </div>
      </section>
    </div>
  )
}

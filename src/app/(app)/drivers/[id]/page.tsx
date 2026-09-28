import { notFound } from 'next/navigation'
import { SELECTABLE_AUTHORITY } from '@/lib/companies'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { currentAuthority } from '@/lib/fleet'
import { CompliancePanel } from '../../_reference/CompliancePanel'
import { compliancePanelData } from '../../_reference/compliance-view'
import { InspectionPanel } from '../../_reference/InspectionPanel'
import { DriverDocuments } from '../../_reference/DriverDocuments'
import { inspectionPanelData } from '../../_reference/inspection-view'
import { PAY_RULE_TYPES, payRulesFor } from '@/lib/driver-pay'
import { DEDUCTION_TYPES } from '@/lib/driver-deductions'
import { onTimeRateForDriver } from '@/lib/dispatch-fields'
import {
  dqfChecklist,
  dqfFactsForDrivers,
  dqfIncompleteCount,
  DQF_REQUIREMENTS,
  isQualifiable,
} from '@/lib/dqf'
import { DqfPanel, type DqfPanelRow } from '../../_reference/DqfPanel'
import { bpsToInput, formatCents } from '@/lib/money'
import { RecordForm } from '@/components/forms/RecordForm'
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
import type { MessageKey } from '@/lib/i18n'
import { driverFields } from '../fields'
import { dateInputValue } from '../../_reference/shared'
import {
  restoreAssetAction,
  retireAssetAction,
  transferAssetAction,
} from '../../_reference/asset-actions'

export default async function EditDriverPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { t, locale } = await getLocaleContext()

  const data = await withCurrentOrg('read', 'driver', async (tx, session) => {
    const driver = await tx.driver.findUnique({ where: { id } })
    if (!driver) return null

    const companies = await tx.company.findMany({
      // `id`, not `companyId` — Company IS the authority. See tenancy.ts.
      where: {
        ...SELECTABLE_AUTHORITY,
        ...companyIdScopeFilter(session.companyScopes),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })

    // Only this driver's OWN authority. On edit the authority is fixed — the
    // way to move a driver is `transferAsset`, below — so there is no reason
    // to offer a truck this pairing would have to refuse.
    const trucks = await tx.truck.findMany({
      where: {
        companyId: driver.companyId,
        deletedAt: null,
        status: { not: 'SOLD' },
      },
      orderBy: { unitNumber: 'asc' },
      select: {
        id: true,
        unitNumber: true,
        company: { select: { name: true } },
      },
    })

    // Item 12. Only this driver's own authority, for the reason the trucks
    // query above says: on edit the authority is fixed.
    const trailers = await tx.trailer.findMany({
      where: {
        companyId: driver.companyId,
        deletedAt: null,
        status: { not: 'SOLD' },
      },
      orderBy: { unitNumber: 'asc' },
      select: { id: true, unitNumber: true },
    })

    // Pay rules ride along on the same transaction rather than a second
    // round trip — this screen is one read.
    const payRules = await payRulesFor(tx, id)
    // WHAT COMES OFF THE CHEQUE AND WHAT CAME INTO THE YEAR. Read here with
    // everything else rather than in their own round trips: the page is one
    // transaction by design, and two more would be two more chances to render
    // half a driver.
    const deductions = await tx.recurringDeduction.findMany({
      where: { driverId: id },
      orderBy: [{ effectiveFrom: 'desc' }, { type: 'asc' }],
    })
    const openingBalances = await tx.driverOpeningBalance.findMany({
      where: { driverId: id },
      orderBy: [{ year: 'desc' }, { category: 'asc' }],
    })

    // ONE STATEMENT, BOTH SEATS, FINISHED FREIGHT ONLY. Derived on every
    // read: nothing on `Driver` stores a score, so there is no stale
    // number to go wrong when a check-in is corrected.
    const onTimeRate = await onTimeRateForDriver(tx, id)

    // The DQF evidence, from the same loader the roster view and the
    // warnings use. One definition of required, one loader for what is on
    // file — see dqf.ts.
    const dqf = (await dqfFactsForDrivers(tx, [id])).get(id) ?? {
      hireDate: null,
      compliance: [],
      documents: [],
    }

    const open = await currentAuthority(tx, 'driver', id)
    const openCompany = open
      ? (companies.find((c) => c.id === open.companyId)?.name ?? null)
      : null

    const compliance = await compliancePanelData(tx, 'driver', id, t)
    const inspections = await inspectionPanelData(tx, 'driver', id, t)

    // EVERY FILE ON THIS DRIVER, not only the ones under a compliance row.
    // A cancelled rotation parks a document with no record to hang it under
    // (owner's ruling, 2026-09-12), and a file on no screen is storage nobody
    // will act on. Tenant-scoped by the transaction, like everything here.
    const documents = await tx.document.findMany({
      where: { driverId: id, deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        filename: true,
        type: true,
        uploadedAt: true,
        ocrStatus: true,
        supersededByDocumentId: true,
      },
    })

    return {
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
      documents: documents.map((document) => ({
        id: document.id,
        filename: document.filename,
        type: document.type,
        uploadedAt: document.uploadedAt,
        needsRotation: document.ocrStatus === 'NEEDS_ROTATION',
        superseded: document.supersededByDocumentId !== null,
      })),
    }
  })

  if (!data) notFound()
  const {
    documents,
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
  } = data
  const maySeeCompliance = await currentUserCan('read', 'compliance')
  const maySeeInspections = await currentUserCan('read', 'inspection')
  const mayRenewCompliance = await currentUserCan('create', 'compliance')

  const mayEdit = await currentUserCan('update', 'driver')
  const mayDelete = await currentUserCan('delete', 'driver')
  // A MANAGER reads what a driver is paid; setting it is `driver.pay:update`,
  // which OWNER, ADMIN and ACCOUNTING hold. A DISPATCHER sees neither.
  const maySeePay = await currentUserCan('read', 'driver.pay')
  const maySetPay = await currentUserCan('update', 'driver.pay')
  const authorities = companies.map((c) => ({ value: c.id, label: c.name }))

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
  const dqfRows: DqfPanelRow[] = dqfEntries.map((entry) => ({
    key: entry.key,
    label: t(`dqf.key.${entry.key}` as MessageKey),
    cfr: entry.cfr,
    cadenceLabel: t(`dqf.cadence.${entry.cadence}` as MessageKey),
    status: entry.status,
    statusLabel: t(`dqf.status.${entry.status}` as MessageKey),
    // NO DATE IS ITS OWN ANSWER. A missing item on a driver with no
    // recorded hire date has been required since a day nobody wrote down,
    // and "—" would read as "not required yet".
    since:
      entry.dueSince !== null
        ? dqfDay.format(entry.dueSince)
        : entry.status === 'missing'
          ? t('dqf.since.unknown')
          : null,
  }))

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

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">
          {t('drivers.edit')}{' '}
          <span className="text-ink-2">
            {driver.firstName} {driver.lastName}
          </span>
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

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <RecordForm
          fields={driverFields(
            t,
            authorities,
            'edit',
            truckOptions,
            trailerOptions,
          )}
          values={{
            firstName: driver.firstName,
            lastName: driver.lastName,
            phone: driver.phone ?? '',
            email: driver.email ?? '',
            addressLine1: driver.addressLine1 ?? '',
            addressCity: driver.addressCity ?? '',
            addressState: driver.addressState ?? '',
            addressPostalCode: driver.addressPostalCode ?? '',
            cdlNumber: driver.cdlNumber ?? '',
            cdlState: driver.cdlState ?? '',
            cdlClass: driver.cdlClass ?? '',
            hireDate: dateInputValue(driver.hireDate),
            status: driver.status,
            employmentType: driver.employmentType,
            notes: driver.notes ?? '',
            assignedTruckId: driver.assignedTruckId ?? '',
            assignedTrailerId: driver.assignedTrailerId ?? '',
          }}
          action={updateDriverAction.bind(null, id)}
          cancelHref="/drivers"
          labels={{ save: t('ref.save'), cancel: t('ref.cancel') }}
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
              retireAction={
                mayDelete
                  ? retireAssetAction.bind(null, 'driver', id)
                  : async () => {
                      'use server'
                    }
              }
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
        </RecordForm>

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
        {maySeeCompliance ? (
          <div className="mt-z4 max-w-[900px]">
            <DriverDocuments
              documents={documents}
              driverId={id}
              mayRead={mayRenewCompliance}
              labels={{
                heading: t('documents.heading'),
                none: t('documents.none'),
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
          </div>
        ) : null}

        {/* ABOVE THE COMPLIANCE PANEL, because it is the question and that
         * is half the answer: five of the eight requirements are the
         * records listed below, and the other three are documents listed
         * above. Reading the verdict first and the evidence after is the
         * order an audit goes in. */}
        {maySeeCompliance ? (
          <div className="mt-z4 max-w-[900px]">
            <DqfPanel
              rows={dqfRows}
              summary={dqfSummary}
              qualifiable={dqfQualifiable}
              labels={{
                title: t('dqf.title'),
                hint: t('dqf.hint'),
                since: t('dqf.since'),
                notQualifiable: t('dqf.notQualifiable'),
              }}
            />
          </div>
        ) : null}

        {maySeeCompliance ? (
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

        {maySeePay ? (
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
        {maySeePay ? (
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

        {maySeePay ? (
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
        {maySeeInspections ? (
          <div className="mt-z4 max-w-[900px]">
            <InspectionPanel
              rows={inspections.rows}
              labels={
                inspections.labels as Parameters<
                  typeof InspectionPanel
                >[0]['labels']
              }
            />
          </div>
        ) : null}
      </div>
    </>
  )
}

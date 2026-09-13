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
import { bpsToInput, formatCents } from '@/lib/money'
import { RecordForm } from '@/components/forms/RecordForm'
import { AssetActions } from '../../_reference/AssetActions'
import { updateDriverAction } from '../actions'
import { PayRules, type PayRuleRowView } from './PayRules'
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

    // Pay rules ride along on the same transaction rather than a second
    // round trip — this screen is one read.
    const payRules = await payRulesFor(tx, id)

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
      payRules,
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
    payRules,
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

  const PAY_ERROR_KEYS: MessageKey[] = [
    'payRule.error.driverNotFound',
    'payRule.error.customUnsupported',
    'payRule.error.badPercent',
    'payRule.error.badPerMile',
    'payRule.error.badFlat',
    'payRule.error.badDates',
    'payRule.error.overlaps',
  ]
  const translate = Object.fromEntries(
    PAY_ERROR_KEYS.map((key) => [key, t(key)]),
  )
  const truckOptions = trucks.map((truck) => ({
    value: truck.id,
    label: `${truck.unitNumber} · ${truck.company.name}`,
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <RecordForm
          fields={driverFields(t, authorities, 'edit', truckOptions)}
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

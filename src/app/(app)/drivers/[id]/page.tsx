import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { currentAuthority } from '@/lib/fleet'
import { CompliancePanel } from '../../_reference/CompliancePanel'
import { compliancePanelData } from '../../_reference/compliance-view'
import { InspectionPanel } from '../../_reference/InspectionPanel'
import { inspectionPanelData } from '../../_reference/inspection-view'
import { PAY_RULE_TYPES, payRulesFor } from '@/lib/driver-pay'
import { bpsToInput, formatCents } from '@/lib/money'
import { RecordForm } from '@/components/forms/RecordForm'
import { AssetActions } from '../../_reference/AssetActions'
import { MedicalCertUpload } from './MedicalCertUpload'
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
        isActive: true,
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

    return {
      driver,
      companies,
      openCompany,
      trucks,
      payRules,
      compliance,
      inspections,
    }
  })

  if (!data) notFound()
  const {
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
        {/* THE MEDICAL CERTIFICATE DROP ZONE, ABOVE THE PANEL IT FILES INTO.
         * Gated on `compliance:create`, which is what filing needs — reading a
         * certificate to propose a row somebody may not create is work done
         * for a refusal, and the route checks the same permission.
         *
         * IT WRITES NOTHING BY ITSELF. The read returns a proposal and the row
         * appears only after somebody clicks; see MedicalCertUpload. */}
        {mayRenewCompliance ? (
          <div className="mt-z4 max-w-[520px]">
            <MedicalCertUpload
              driverId={id}
              labels={{
                dropTitle: t('drivers.med.dropTitle'),
                dropBody: t('drivers.med.dropBody'),
                dropHint: t('drivers.med.dropHint'),
                reading: t('drivers.med.reading'),
                heading: t('drivers.med.heading'),
                expires: t('drivers.med.expires'),
                issued: t('drivers.med.issued'),
                examiner: t('drivers.med.examiner'),
                registry: t('drivers.med.registry'),
                asPrinted: t('drivers.med.asPrinted'),
                nameWarning: t('drivers.med.nameWarning'),
                file: t('drivers.med.file'),
                discard: t('drivers.med.discard'),
                filed: t('drivers.med.filed'),
                none: t('drivers.med.none'),
                // PRE-TRANSLATED AND KEYED BY WHAT THE ROUTE RETURNS. A
                // translator closure cannot cross to a client component, and
                // the route deals in i18n keys so it stays language-free.
                notices: {
                  'drivers.med.unreadable': t('drivers.med.unreadable'),
                  'drivers.med.contradictory': t('drivers.med.contradictory'),
                  'drivers.med.wrongType': t('drivers.med.wrongType'),
                  'drivers.med.tooLarge': t('drivers.med.tooLarge'),
                  'drivers.med.notAllowed': t('drivers.med.notAllowed'),
                  'drivers.med.failed': t('drivers.med.failed'),
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

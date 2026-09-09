import { notFound } from 'next/navigation'
import { SELECTABLE_AUTHORITY } from '@/lib/companies'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter, companyScopeFilter } from '@/lib/tenancy'
import { CreateLoadForm } from './CreateLoadForm'
import { lastUsedAuthority } from '../../_reference/shared'
import { queuedExtraction } from '@/lib/inbound-email'

// §7.6 / brief §9 — the most-used form in the product.
//
// Everything the form needs arrives in one round trip, prefetched here. A
// typeahead that queries per keystroke is a typeahead that is slower than the
// dispatcher, and the lists are small: brokers and places are per-organization,
// trucks and drivers per authority.

export default async function NewLoadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await currentUserCan('create', 'load'))) notFound()

  // `?from=<inbound email id>` — the Incoming queue's row link (§4 step 4).
  // §1.1: "the inbox is a queue of unfinished forms", and this is the form.
  const params = await searchParams
  const fromEmail = typeof params['from'] === 'string' ? params['from'] : null

  const { t } = await getLocaleContext()
  const mayeeFinancials = await currentUserCan('read', 'load.financials')
  // Reading a rate and SETTING one are different permissions — §1 of Phase 3:
  // "a MANAGER reads the number and does not set it".
  const mayEnterRate = await currentUserCan('update', 'load.financials')

  const data = await withCurrentOrg('read', 'load', async (tx, session) => {
    const scope = companyScopeFilter(session.companyScopes)
    const companyIdScope = companyIdScopeFilter(session.companyScopes)

    const [companies, brokers, trucks, drivers, places, recent] =
      await Promise.all([
        tx.company.findMany({
          // `id`, not `companyId` — Company IS the authority. See tenancy.ts.
          where: { ...SELECTABLE_AUTHORITY, ...companyIdScope },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
        tx.customer.findMany({
          where: { deletedAt: null, status: { not: 'BLOCKED' } },
          orderBy: { name: 'asc' },
          take: 500,
          select: { name: true },
        }),
        tx.truck.findMany({
          where: { deletedAt: null, ...scope },
          orderBy: { unitNumber: 'asc' },
          take: 500,
          select: { id: true, unitNumber: true },
        }),
        tx.driver.findMany({
          where: { deletedAt: null, ...scope },
          orderBy: { lastName: 'asc' },
          take: 500,
          select: { id: true, firstName: true, lastName: true },
        }),
        tx.location.findMany({
          where: { deletedAt: null },
          orderBy: { name: 'asc' },
          take: 500,
          select: { name: true },
        }),
        // RECENT CUSTOMERS, BY WHAT WAS BOOKED — not the alphabet.
        //
        // The broker datalist is 500 names in name order, which is a lookup;
        // this is a memory. A dispatcher books the same handful of brokers all
        // week, so the quick-pick is the last few loads' customers, most recent
        // first. Six of them: enough to hold the week, short enough to read
        // without scanning.
        tx.load.findMany({
          where: { deletedAt: null, ...scope },
          orderBy: { createdAt: 'desc' },
          take: 40,
          select: { customer: { select: { name: true } } },
        }),
      ])

    // THE QUEUED EMAIL, IF THE LINK CAME FROM ONE. Read inside the same
    // transaction as everything else the form needs — one round trip, and the
    // §1.3 money strip happens on the server where the rule lives.
    const queued = fromEmail
      ? await queuedExtraction(tx, fromEmail, { maySeeMoney: mayEnterRate })
      : null

    // §7 — a field a role cannot see is ABSENT from the payload, never hidden
    // in CSS. A dispatcher's page never carries the fuel cost or the pay
    // percentage, so the computed line has nothing to render even if somebody
    // reaches for it in the browser.
    const economics = mayeeFinancials
      ? await tx.companySettings
          .findFirst({
            where: scope.companyId ? { companyId: scope.companyId } : {},
            select: { defaultFuelCostPerMileCents: true },
          })
          .then((settings) => ({
            fuelCostPerMileCents: settings?.defaultFuelCostPerMileCents ?? 55,
            // Until DriverPayRule rows exist (Phase 3 owns settlements), the
            // line uses the group's usual split. It is an ESTIMATE under the
            // rate field, not a number anybody is paid from.
            driverPayPercentBps: 2800,
          }))
      : null

    return {
      companies,
      brokers,
      trucks,
      drivers,
      places,
      recent,
      economics,
      queued,
    }
  })

  // Distinct, in the order they were last booked. Deduped here rather than in
  // SQL: a DISTINCT ON would need raw SQL for the ordering, and forty rows is
  // nothing to walk.
  const recentCustomers = [
    ...new Set(data.recent.map((load) => load.customer.name)),
  ].slice(0, 6)

  const authorities = data.companies.map((company) => ({
    value: company.id,
    label: company.name,
  }))
  const remembered = await lastUsedAuthority()
  const defaultAuthority =
    remembered && authorities.some((option) => option.value === remembered)
      ? remembered
      : (authorities[0]?.value ?? '')

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('loads.new')}</h1>
        <p className="text-xs text-ink-3">{t('loads.newHint')}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <CreateLoadForm
          // The draft this form was opened from, when it was opened from one.
          // Shaped exactly like an upload's prefill so the form cannot tell
          // the two apart — §1.1's "no second editing surface", enforced by
          // there being nothing else for it to render.
          {...(data.queued
            ? {
                fromEmail: {
                  id: data.queued.id,
                  extracted: data.queued.extracted,
                  subject: data.queued.subject,
                  from: data.queued.from,
                },
              }
            : {})}
          authorities={authorities}
          defaultAuthority={defaultAuthority}
          brokers={data.brokers.map((broker) => broker.name)}
          recentCustomers={recentCustomers}
          trucks={data.trucks.map((truck) => ({
            value: truck.id,
            label: truck.unitNumber,
          }))}
          drivers={data.drivers.map((driver) => ({
            value: driver.id,
            label: `${driver.lastName}, ${driver.firstName}`,
          }))}
          places={data.places.map((place) => place.name)}
          economics={data.economics}
          mayEnterRate={mayEnterRate}
          labels={{
            authority: t('ref.authority'),
            broker: t('loads.column.customer'),
            truck: t('loads.column.truck'),
            driver: t('loads.column.driver'),
            unassigned: t('loads.unassigned'),
            pickup: t('loads.column.pickup'),
            delivery: t('loads.column.delivery'),
            pickupDate: t('loads.pickupDate'),
            datePlaceholder: t('loads.datePlaceholder'),
            dateHint: t('loads.dateHint'),
            deliveryDate: t('loads.deliveryDate'),
            miles: t('loads.miles'),
            rate: t('loads.column.rate'),
            rpm: t('loads.rpm'),
            driverPay: t('loads.driverPay'),
            fuel: t('loads.estFuel'),
            profit: t('loads.estProfit'),
            rateCon: t('loads.rateCon'),
            rateConHint: t('loads.rateConHint'),
            offerTitle: t('loads.offerTitle'),
            offerHint: t('loads.offerHint'),
            offerChoose: t('loads.offerChoose'),
            offerHashing: t('loads.offerHashing'),
            offerUploading: t('loads.offerUploading'),
            offerReading: t('loads.offerReading'),
            offerDone: t('loads.offerDone'),
            offerFailed: t('loads.offerFailed'),
            offerTypeInstead: t('loads.offerTypeInstead'),
            offerFailedUnreadable: t('loads.offerFailedUnreadable'),
            offerFailedTryAgain: t('loads.offerFailedTryAgain'),
            offerFailedMissing: t('loads.offerFailedMissing'),
            methodManual: t('loads.methodManual'),
            methodUpload: t('loads.methodUpload'),
            methodPaste: t('loads.methodPaste'),
            methodAmazon: t('loads.methodAmazon'),
            methodAmazonImport: t('loads.methodAmazonImport'),
            methodManualHint: t('loads.methodManualHint'),
            methodDropHint: t('loads.methodDropHint'),
            methodPastePlaceholder: t('loads.methodPastePlaceholder'),
            methodPasteRead: t('loads.methodPasteRead'),
            methodAmazonSoon: t('loads.methodAmazonSoon'),
            extracted: t('loads.extracted'),
            extractedUnsure: t('loads.extractedUnsure'),
            extractedRemembered: t('loads.extractedRemembered'),
            extractedChanged: t('loads.extractedChanged'),
            preparing: t('upload.preparing'),
            uploading: t('upload.uploading'),
            uploaded: t('upload.done'),
            uploadFailed: t('upload.failed'),
            createOnMiss: t('loads.createOnMiss'),
            placeHint: t('loads.placeHint'),
            facilityKnown: t('loads.facilityKnown'),
            facilityNothingYet: t('loads.facilityNothingYet'),
            facilitySave: t('loads.facilitySave'),
            facilityGateCode: t('loads.facilityGateCode'),
            facilityHours: t('loads.facilityHours'),
            facilityDock: t('loads.facilityDock'),
            facilityCheckIn: t('loads.facilityCheckIn'),
            facilityContact: t('loads.facilityContact'),
            facilityNotes: t('loads.facilityNotes'),
            stopPlace: t('loads.stopPlace'),
            stopType: t('loads.stopType'),
            stopDate: t('loads.stopDate'),
            stopPickup: t('loads.stopPickup'),
            stopDelivery: t('loads.stopDelivery'),
            stopIntermediate: t('loads.stopIntermediate'),
            stopAdd: t('loads.stopAdd'),
            stopRemove: t('loads.stopRemove'),
            stopMoveUp: t('loads.stopMoveUp'),
            stopMoveDown: t('loads.stopMoveDown'),
            stopFrom: t('loads.stopFrom'),
            stopTo: t('loads.stopTo'),
            timePlaceholder: t('loads.timePlaceholder'),
            bol: t('loads.bol'),
            po: t('loads.po'),
            reference: t('loads.reference'),
            warnTitle: t('loads.warn.title'),
            warnSaveAnyway: t('loads.warn.saveAnyway'),
            save: t('loads.save'),
            cancel: t('ref.cancel'),
          }}
        />
      </div>
    </>
  )
}

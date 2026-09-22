import Link from 'next/link'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { SELECTABLE_AUTHORITY } from '@/lib/companies'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { RecordForm } from '@/components/forms/RecordForm'
import { registerFor } from '@/lib/accidents'
import { recordAccidentAction, voidAccidentAction } from './actions'
import { VoidEntry } from './VoidEntry'
import type { FieldSpec } from '@/components/forms/RecordForm'

// ITEM 14 — THE ACCIDENT REGISTER, 49 CFR 390.15(b).
//
// ── ONE REGISTER PER AUTHORITY, AND THE URL SAYS WHICH ───────────────────
//
// §390.15 binds the motor carrier. A group running four MC numbers keeps four
// registers, and the one an auditor asks for is the one belonging to the
// number they are auditing. So the company is a REQUIRED part of the view, not
// a filter that defaults to everything: a page that showed all four at once
// would be a document nobody can hand over.
//
// `companyIdScopeFilter` decides which authorities this person may pick from.
// RLS separates tenants and has nothing to say about authorities inside one —
// keeping RAM's accidents off Dolphins' register is the `companyId` in
// `registerFor`, and `tests/integration/accidents.test.ts` is what proves it.
//
// ── IT PRINTS ────────────────────────────────────────────────────────────
//
// The table is plain rows with print styles rather than a `Table` component,
// because what goes to the auditor is a piece of paper: the filters, the
// form and the void controls are `print:hidden`, the heading carries the
// authority and the date range, and nothing is behind a disclosure that would
// print as a closed triangle.

export default async function AccidentRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, locale } = await getLocaleContext()
  const asked =
    typeof params['company'] === 'string' ? params['company'] : undefined

  const data = await withCurrentOrg('read', 'accident', async (tx, session) => {
    const companies = await tx.company.findMany({
      where: {
        ...SELECTABLE_AUTHORITY,
        ...companyIdScopeFilter(session.companyScopes),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })

    // THE FIRST AUTHORITY IS A DEFAULT, NOT A MERGE. Every view of this page
    // is one company's register; landing without a choice shows the first
    // one by name rather than all of them at once.
    const chosen =
      (asked && companies.some((c) => c.id === asked) ? asked : null) ??
      companies[0]?.id ??
      null

    const entries = chosen ? await registerFor(tx, chosen) : []

    const drivers = chosen
      ? await tx.driver.findMany({
          where: { companyId: chosen, deletedAt: null },
          orderBy: { lastName: 'asc' },
          select: { id: true, firstName: true, lastName: true },
        })
      : []
    const trucks = chosen
      ? await tx.truck.findMany({
          where: { companyId: chosen, deletedAt: null },
          orderBy: { unitNumber: 'asc' },
          select: { id: true, unitNumber: true },
        })
      : []

    return { companies, chosen, entries, drivers, trucks }
  })

  const mayRecord = await currentUserCan('create', 'accident')
  const { companies, chosen, entries, drivers, trucks } = data

  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const chosenName = companies.find((c) => c.id === chosen)?.name ?? ''
  const recordableCount = entries.filter((entry) => entry.recordable).length

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'companyId', value: chosen ?? '' },
    {
      kind: 'date',
      name: 'occurredAt',
      label: t('acc.date'),
      required: true,
      autoFocus: true,
    },
    { kind: 'text', name: 'city', label: t('acc.city') },
    { kind: 'text', name: 'state', label: t('acc.state') },
    {
      kind: 'select',
      name: 'driverId',
      label: t('acc.driver'),
      options: [
        { value: '', label: '—' },
        ...drivers.map((driver) => ({
          value: driver.id,
          label: `${driver.lastName}, ${driver.firstName}`,
        })),
      ],
    },
    {
      kind: 'select',
      name: 'truckId',
      label: t('acc.truck'),
      options: [
        { value: '', label: '—' },
        ...trucks.map((truck) => ({
          value: truck.id,
          label: truck.unitNumber,
        })),
      ],
    },
    // THE HINT IS THE REGULATION, NOT DECORATION. "Number of injuries" invites
    // a count of everybody who was shaken up; §390.5 counts people who
    // immediately received treatment AWAY FROM THE SCENE, and that difference
    // is what decides whether the row is recordable.
    {
      kind: 'number',
      name: 'injuries',
      label: t('acc.injuries'),
      hint: t('acc.injuriesHint'),
    },
    { kind: 'number', name: 'fatalities', label: t('acc.fatalities') },
    {
      kind: 'confirm',
      name: 'towedAway',
      label: t('acc.towed'),
      hint: t('acc.towedHint'),
    },
    // AND THE HINT HERE SAYS WHAT IT DOES *NOT* DO. A release is recorded by
    // §390.15(b)(2)(vi) and does not by itself make the occurrence an accident
    // under §390.5 — the single most natural mistake on this form.
    {
      kind: 'confirm',
      name: 'hazmatReleased',
      label: t('acc.hazmat'),
      hint: t('acc.hazmatHint'),
    },
    { kind: 'textarea', name: 'notes', label: t('acc.notes') },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3 print:border-0">
        <h1 className="text-lg font-medium text-ink">
          {t('acc.title')}
          {chosenName ? (
            <span className="ms-z2 text-ink-2">{chosenName}</span>
          ) : null}
        </h1>
        <p className="max-w-[60ch] text-xs text-ink-3 print:hidden">
          {t('acc.hint')}
        </p>
      </div>

      {/* WHICH REGISTER. Not a filter — the document is per authority. */}
      {companies.length > 1 ? (
        <div className="flex items-center gap-z4 border-b border-border bg-surface-2 px-gutter py-z2 print:hidden">
          {companies.map((company) => (
            <Link
              key={company.id}
              href={`/safety/accidents?company=${company.id}`}
              className={
                company.id === chosen
                  ? 'text-sm font-medium text-accent'
                  : 'text-sm text-ink-2 hover:text-accent'
              }
            >
              {company.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5 print:overflow-visible print:bg-transparent print:p-0">
        {entries.length === 0 ? (
          <EmptyState title={t('acc.empty.title')} body={t('acc.empty.body')} />
        ) : (
          <section className="rounded-card border border-border bg-surface p-z4 print:border-0 print:p-0">
            <p className="text-sm text-ink-2">
              {t('acc.count')
                .replace('{n}', String(entries.length))
                .replace('{r}', String(recordableCount))}
            </p>

            <table className="mt-z3 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-start text-xs uppercase tracking-[0.04em] text-ink-3">
                  <th scope="col" className="py-z2 text-start">
                    {t('acc.date')}
                  </th>
                  <th scope="col" className="py-z2 text-start">
                    {t('acc.place')}
                  </th>
                  <th scope="col" className="py-z2 text-start">
                    {t('acc.driver')}
                  </th>
                  <th scope="col" className="py-z2 text-start">
                    {t('acc.truck')}
                  </th>
                  <th scope="col" className="py-z2 text-end">
                    {t('acc.injuries')}
                  </th>
                  <th scope="col" className="py-z2 text-end">
                    {t('acc.fatalities')}
                  </th>
                  <th scope="col" className="py-z2 text-start">
                    {t('acc.hazmat')}
                  </th>
                  <th scope="col" className="py-z2 text-start">
                    {t('acc.recordable')}
                  </th>
                  <th scope="col" className="py-z2 text-start print:hidden">
                    {t('acc.retainedUntil')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className={
                      entry.voidedAt !== null
                        ? 'border-b border-border text-ink-3 line-through'
                        : 'border-b border-border text-ink'
                    }
                  >
                    <td className="py-z2 font-mono">
                      {day.format(entry.occurredAt)}
                    </td>
                    <td className="py-z2">{entry.place || '—'}</td>
                    <td className="py-z2">{entry.driverName || '—'}</td>
                    <td className="py-z2 font-mono">
                      {entry.truckLabel ?? '—'}
                    </td>
                    <td className="py-z2 text-end font-mono">
                      {entry.injuries}
                    </td>
                    <td className="py-z2 text-end font-mono">
                      {entry.fatalities}
                    </td>
                    <td className="py-z2">
                      {/* A TICK AND A BLANK, not “Yes” and “No”. The
                       * register is scanned down a column; a column of
                       * “No” is ink that carries no information, and the
                       * one row that says otherwise has to be findable at
                       * arm’s length. */}
                      <span
                        aria-label={entry.hazmatReleased ? t('acc.hazmat') : ''}
                      >
                        {entry.hazmatReleased ? '✓' : '—'}
                      </span>
                    </td>
                    <td className="py-z2">
                      {/* DERIVED, EVERY TIME THIS RENDERS. There is no column
                       * behind this cell — see accidents.ts. */}
                      <StatusBadge
                        tone={entry.recordable ? 'danger' : 'muted'}
                        variant="outlined"
                        label={
                          entry.recordable
                            ? t('acc.recordable.yes')
                            : t('acc.recordable.no')
                        }
                      />
                    </td>
                    <td className="py-z2 text-xs text-ink-3 print:hidden">
                      <span
                        className={entry.withinRetention ? '' : 'text-ink-3'}
                      >
                        {day.format(entry.retainedUntil)}
                      </span>
                      {entry.voidedAt === null ? (
                        <span className="ms-z2">
                          <VoidEntry
                            action={voidAccidentAction.bind(null, entry.id)}
                            labels={{
                              void: t('acc.void'),
                              title: t('acc.voidTitle'),
                              body: t('acc.voidBody'),
                              reason: t('acc.voidReason'),
                              confirm: t('acc.voidConfirm'),
                            }}
                          />
                        </span>
                      ) : (
                        <span className="ms-z2">
                          {t('acc.voided')}: {entry.voidReason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {mayRecord && chosen ? (
          <div className="mt-z4 max-w-[720px] print:hidden">
            <h2 className="mb-z2 text-md font-medium text-ink">
              {t('acc.add')}
            </h2>
            <RecordForm
              fields={fields}
              values={{}}
              action={recordAccidentAction}
              cancelHref="/safety"
              labels={{ save: t('ref.save'), cancel: t('ref.cancel') }}
            />
          </div>
        ) : null}
      </div>
    </>
  )
}

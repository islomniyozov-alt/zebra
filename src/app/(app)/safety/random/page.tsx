import Link from 'next/link'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { SELECTABLE_AUTHORITY } from '@/lib/companies'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { RecordForm, type FieldSpec } from '@/components/forms/RecordForm'
import {
  poolFor,
  yearSummary,
  type AnnualRate,
  type SelectionOutcome,
  type TestKind,
} from '@/lib/random-testing'
import {
  drawQuarterAction,
  recordRateAction,
  resolveSelectionAction,
} from './actions'
import { ResolveSelection } from './ResolveSelection'
import type { MessageKey } from '@/lib/i18n'

// ITEM 15 — THE RANDOM TESTING PROGRAMME, 49 CFR 382.305.
//
// ── THE RATE COMES FIRST, AND NOTHING WORKS WITHOUT IT ───────────────────
//
// If no rate is recorded for the year the screen says so and offers the form
// to enter it, and the draw is not offered at all. That ordering IS the rule:
// a programme that drew names against a guessed rate would look complete and
// be wrong, and the guess would never be questioned.
//
// ── THE DRAW SHOWS ITS WORKING ───────────────────────────────────────────
//
// Seed, method and the pool as it stood are all on the screen, because the
// auditor's question is "show me you did not choose these people" and the
// answer is three recorded values anybody can recompute from.

const TONE: Record<SelectionOutcome, 'neutral' | 'success' | 'warning'> = {
  PENDING: 'neutral',
  TESTED: 'success',
  // NOT a danger tone. An excused selection with a reason is a compliant
  // outcome under §382.305(j)(3), not a failure — it is worth seeing, which
  // is what warning means here.
  NOT_TESTED: 'warning',
}

export default async function RandomTestingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, locale } = await getLocaleContext()

  const asked =
    typeof params['company'] === 'string' ? params['company'] : undefined
  const year = Number(
    typeof params['year'] === 'string'
      ? params['year']
      : new Date().getFullYear(),
  )

  const data = await withCurrentOrg(
    'read',
    'randomTesting',
    async (tx, session) => {
      const companies = await tx.company.findMany({
        where: {
          ...SELECTABLE_AUTHORITY,
          ...companyIdScopeFilter(session.companyScopes),
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
      const chosen =
        (asked && companies.some((c) => c.id === asked) ? asked : null) ??
        companies[0]?.id ??
        null

      const rate = await tx.randomTestingRate.findFirst({
        where: { year },
        select: {
          year: true,
          drugRateBps: true,
          alcoholRateBps: true,
          citation: true,
        },
      })

      const draws = chosen
        ? await tx.randomDraw.findMany({
            where: { companyId: chosen, year },
            orderBy: { quarter: 'asc' },
            include: {
              selections: { orderBy: [{ kind: 'asc' }, { name: 'asc' }] },
            },
          })
        : []

      // THE POOL AS IT STANDS TODAY, which is NOT what an old draw ran over.
      // Shown beside the summary so the next draw's size is visible; each
      // draw prints its own snapshot size instead.
      const pool = chosen ? await poolFor(tx, chosen, year, 'DERIVED') : []

      return { companies, chosen, rate, draws, poolSize: pool.length }
    },
  )

  const mayDraw = await currentUserCan('create', 'randomTesting')
  const { companies, chosen, rate, draws, poolSize } = data

  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const pct = (bps: number) =>
    `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`

  const selections = draws.flatMap((draw) =>
    draw.selections.map((selection) => ({
      kind: selection.kind as TestKind,
      outcome: selection.outcome as SelectionOutcome,
    })),
  )
  const summary = rate
    ? yearSummary(rate as AnnualRate, poolSize, selections)
    : null

  const rateFields: FieldSpec[] = [
    { kind: 'number', name: 'year', label: t('rt.year'), required: true },
    {
      kind: 'text',
      name: 'drugRatePercent',
      label: t('rt.rate.drug'),
      required: true,
    },
    {
      kind: 'text',
      name: 'alcoholRatePercent',
      label: t('rt.rate.alcohol'),
      required: true,
    },
    {
      kind: 'text',
      name: 'citation',
      label: t('rt.rate.citation'),
      hint: t('rt.rate.citationHint'),
      required: true,
    },
  ]

  const drawnQuarters = new Set(draws.map((draw) => draw.quarter))
  const nextQuarter = [1, 2, 3, 4].find((q) => !drawnQuarters.has(q)) ?? null

  const drawFields: FieldSpec[] = [
    { kind: 'hidden', name: 'companyId', value: chosen ?? '' },
    { kind: 'hidden', name: 'year', value: String(year) },
    { kind: 'hidden', name: 'quarter', value: String(nextQuarter ?? 1) },
    {
      kind: 'select',
      name: 'source',
      label: t('rt.pool.source'),
      options: [
        { value: 'DERIVED', label: t('rt.pool.DERIVED') },
        { value: 'CONSORTIUM', label: t('rt.pool.CONSORTIUM') },
      ],
    },
    {
      kind: 'text',
      name: 'seed',
      label: t('rt.draw.seed'),
      hint: t('rt.draw.recompute'),
      required: true,
      mono: true,
    },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">
          {t('rt.title')} <span className="ms-z2 text-ink-2">{year}</span>
        </h1>
        <p className="max-w-[60ch] text-xs text-ink-3 print:hidden">
          {t('rt.hint')}
        </p>
      </div>

      {companies.length > 1 ? (
        <div className="flex items-center gap-z4 border-b border-border bg-surface-2 px-gutter py-z2 print:hidden">
          {companies.map((company) => (
            <Link
              key={company.id}
              href={`/safety/random?company=${company.id}&year=${year}`}
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

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        {/* NO RATE, NO DRAW. The form to enter one is the only thing offered,
         * because a draw against a guessed rate looks complete and is wrong. */}
        {rate === null ? (
          <section className="max-w-[720px] rounded-card border border-border bg-surface p-z4">
            <h2 className="text-md font-medium text-ink">
              {t('rt.empty.title')}
            </h2>
            <p className="mt-z1 max-w-[68ch] text-sm text-ink-2">
              {t('rt.rate.missing').replace('{year}', String(year))}
            </p>
            {mayDraw ? (
              <div className="mt-z3">
                <RecordForm
                  fields={rateFields}
                  values={{ year: String(year) }}
                  action={recordRateAction}
                  cancelHref="/safety"
                  labels={{ save: t('rt.rate.add'), cancel: t('ref.cancel') }}
                />
              </div>
            ) : null}
          </section>
        ) : (
          <>
            <section className="rounded-card border border-border bg-surface p-z4">
              <h2 className="text-md font-medium text-ink">
                {t('rt.summary')}
              </h2>
              <p className="mt-z1 text-xs text-ink-3">
                {t('rt.rate.citation')}: {rate.citation} ·{' '}
                {t('rt.pool.size').replace('{n}', String(poolSize))}
              </p>
              <p className="mt-z1 max-w-[68ch] text-xs text-ink-3">
                {t('rt.summary.metNote')}
              </p>

              <table className="mt-z3 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-[0.04em] text-ink-3">
                    <th scope="col" className="py-z2 text-start">
                      {t('rt.rate')}
                    </th>
                    <th scope="col" className="py-z2 text-end">
                      {t('rt.summary.required')}
                    </th>
                    <th scope="col" className="py-z2 text-end">
                      {t('rt.summary.selected')}
                    </th>
                    <th scope="col" className="py-z2 text-end">
                      {t('rt.summary.tested')}
                    </th>
                    <th scope="col" className="py-z2 text-start">
                      {t('rt.summary.met')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary
                    ? (['DRUG', 'ALCOHOL'] as const).map((kind) => {
                        const row = summary.kinds[kind]
                        return (
                          <tr key={kind} className="border-b border-border">
                            <td className="py-z2">
                              {t(`rt.kind.${kind}` as MessageKey)}{' '}
                              <span className="font-mono text-xs text-ink-3">
                                {pct(row.rateBps)}
                              </span>
                            </td>
                            <td className="py-z2 text-end font-mono">
                              {row.required}
                            </td>
                            <td className="py-z2 text-end font-mono">
                              {row.selected}
                            </td>
                            <td className="py-z2 text-end font-mono">
                              {row.tested}
                            </td>
                            <td className="py-z2">
                              <StatusBadge
                                tone={row.met ? 'success' : 'warning'}
                                variant="outlined"
                                label={
                                  row.met
                                    ? t('rt.summary.met')
                                    : t('rt.summary.short').replace(
                                        '{n}',
                                        String(row.required - row.tested),
                                      )
                                }
                              />
                            </td>
                          </tr>
                        )
                      })
                    : null}
                </tbody>
              </table>
            </section>

            {draws.map((draw) => (
              <section
                key={draw.id}
                className="mt-z4 rounded-card border border-border bg-surface p-z4"
              >
                <h2 className="text-md font-medium text-ink">
                  {t('rt.quarter')} {draw.quarter}
                </h2>
                {/* THE THREE RECORDED VALUES, on the screen. Anybody can
                 * recompute the names below from them. */}
                <p className="mt-z1 flex flex-wrap gap-x-z4 gap-y-z1 text-xs text-ink-3">
                  <span>
                    {t('rt.draw.seed')}:{' '}
                    <span className="font-mono text-ink-2">{draw.seed}</span>
                  </span>
                  <span>
                    {t('rt.draw.algorithm')}:{' '}
                    <span className="font-mono text-ink-2">
                      {draw.algorithm}
                    </span>
                  </span>
                  <span>
                    {t('rt.pool')}:{' '}
                    <span className="font-mono text-ink-2">
                      {draw.poolSize}
                    </span>
                  </span>
                  <span>
                    {t('rt.draw.drawnAt')}: {day.format(draw.drawnAt)}
                  </span>
                </p>

                <ul className="mt-z3 flex flex-col">
                  {draw.selections.map((selection) => (
                    <li
                      key={selection.id}
                      className="flex flex-wrap items-baseline gap-x-z3 gap-y-z1 border-b border-border py-z2 text-sm last:border-b-0"
                    >
                      <span className="min-w-[22ch] text-ink">
                        {selection.name}
                      </span>
                      <span className="text-xs text-ink-3">
                        {t(`rt.kind.${selection.kind}` as MessageKey)}
                      </span>
                      <span className="ms-auto flex items-baseline gap-z3">
                        {selection.reason ? (
                          <span className="text-xs text-ink-3">
                            {selection.reason}
                          </span>
                        ) : null}
                        <StatusBadge
                          tone={TONE[selection.outcome as SelectionOutcome]}
                          variant="outlined"
                          label={t(
                            `rt.outcome.${selection.outcome}` as MessageKey,
                          )}
                        />
                        {mayDraw && selection.outcome === 'PENDING' ? (
                          <ResolveSelection
                            action={resolveSelectionAction.bind(
                              null,
                              selection.id,
                            )}
                            labels={{
                              resolve: t('rt.resolve'),
                              tested: t('rt.outcome.TESTED'),
                              notTested: t('rt.outcome.NOT_TESTED'),
                              outcome: t('rt.outcome'),
                              reason: t('rt.outcome.reason'),
                              reasonHint: t('rt.outcome.reasonHint'),
                              testedAt: t('rt.outcome.TESTED'),
                              save: t('ref.save'),
                            }}
                          />
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {mayDraw && chosen && nextQuarter !== null ? (
              <div className="mt-z4 max-w-[720px] print:hidden">
                <h2 className="mb-z2 text-md font-medium text-ink">
                  {t('rt.draw.run')} — {t('rt.quarter')} {nextQuarter}
                </h2>
                <RecordForm
                  fields={drawFields}
                  values={{}}
                  action={drawQuarterAction}
                  cancelHref="/safety"
                  labels={{ save: t('rt.draw.run'), cancel: t('ref.cancel') }}
                />
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}

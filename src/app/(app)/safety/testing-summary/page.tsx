import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { testingSummary } from '@/lib/testing-summary'

// §6.9 — the random-testing programme as numbers (owner's ruling on GAPS 18,
// 2026-10-11). Per authority, per quarter: pool size, then selections and
// tests completed for drug and for alcohol. NO NAMES AND NO RESULTS: the pool
// itself is owner/safety only under 49 CFR Part 40, and this page exists so
// that accounting's insurance-renewal figure does not need it.
//
// It prints, like the accident register beside it: the year picker is
// `print:hidden`, and the heading carries the year.

export default async function TestingSummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t } = await getLocaleContext()
  const current = new Date().getUTCFullYear()
  const asked = Number(typeof params['year'] === 'string' ? params['year'] : '')
  const year =
    Number.isInteger(asked) && asked >= 2000 && asked <= current + 1
      ? asked
      : current

  // §6.8: a role without the read is REFUSED as a 404, never a 500.
  if (!(await currentUserCan('read', 'randomTesting.summary'))) notFound()
  const authorities = await withCurrentOrg(
    'read',
    'randomTesting.summary',
    (tx, session) =>
      testingSummary(tx, { year, companyScopes: session.companyScopes }),
  )

  const cell = 'px-z3 py-z1 text-end font-mono tabular-nums'
  const head =
    'px-z3 py-z1 text-xs font-semibold uppercase tracking-[0.04em] text-ink-2'

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">
          {t('rts.title')} — {year}
        </h1>
        <nav className="flex items-center gap-z3 text-sm print:hidden">
          <Link
            href={`/safety/testing-summary?year=${year - 1}`}
            className="text-accent hover:underline"
          >
            {year - 1}
          </Link>
          {year < current ? (
            <Link
              href={`/safety/testing-summary?year=${year + 1}`}
              className="text-accent hover:underline"
            >
              {year + 1}
            </Link>
          ) : null}
        </nav>
      </div>

      <div className="flex flex-col gap-z6 overflow-auto px-gutter py-z4">
        <p className="text-sm text-ink-2">{t('rts.note')}</p>
        {authorities.map((authority) => (
          <section key={authority.companyId}>
            <h2 className="mb-z2 text-sm font-semibold text-ink">
              {authority.name}
            </h2>
            <table className="border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className={`${head} text-start`}>{t('rts.quarter')}</th>
                  <th className={`${head} text-end`}>{t('rts.poolSize')}</th>
                  <th className={`${head} text-end`}>
                    {t('rts.drugSelected')}
                  </th>
                  <th className={`${head} text-end`}>{t('rts.drugTested')}</th>
                  <th className={`${head} text-end`}>
                    {t('rts.alcoholSelected')}
                  </th>
                  <th className={`${head} text-end`}>
                    {t('rts.alcoholTested')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {authority.quarters.map((row) => (
                  <tr key={row.quarter} className="border-b border-border">
                    <td className="px-z3 py-z1 text-ink">Q{row.quarter}</td>
                    {row.drawn ? (
                      <>
                        <td className={cell}>{row.poolSize}</td>
                        <td className={cell}>{row.kinds.DRUG.selected}</td>
                        <td className={cell}>{row.kinds.DRUG.tested}</td>
                        <td className={cell}>{row.kinds.ALCOHOL.selected}</td>
                        <td className={cell}>{row.kinds.ALCOHOL.tested}</td>
                      </>
                    ) : (
                      // NO DRAW IS NOT A DRAW OF NOBODY: said in words, so a
                      // row of zeros cannot be read as a quarter that ran.
                      <td colSpan={5} className="px-z3 py-z1 text-ink-3">
                        {t('rts.noDraw')}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </>
  )
}

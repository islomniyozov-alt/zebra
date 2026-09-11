'use client'

import Link from 'next/link'
import type { CompanyRef } from '@/lib/this-week'

interface Props {
  companies: readonly CompanyRef[]
  /** Null is All, which is the default. */
  selected: string | null
  labels: { all: string; label: string }
}

/**
 * A READING AID, NOT A SCOPE.
 *
 * Settlement is org-wide (Islom, 2026-09-11), so the Ready total and the Open
 * batch button cover the whole operation whatever is picked here. This narrows
 * the LISTS — held lines, blocked drivers, remittances, factoring — for
 * somebody who wants to look at one authority's share of the week.
 *
 * LINKS, NOT A SELECT, so the choice is in the URL: "look at the Dolphins
 * rows" is a thing one person sends another, and a dropdown whose state lives
 * in a browser is not.
 *
 * ALL IS FIRST AND IS THE DEFAULT, because the org-wide view is the one the
 * ruling is about — a filter that remembered its last setting would quietly
 * make the exception into the normal case.
 */
export function CompanyFilter({ companies, selected, labels }: Props) {
  if (companies.length < 2) return null

  const item = (id: string | null, name: string) => {
    const active = selected === id
    return (
      <Link
        key={id ?? 'all'}
        href={
          id === null ? '/money/this-week' : `/money/this-week?company=${id}`
        }
        aria-current={active ? 'true' : undefined}
        className={`rounded-card border px-z2 py-z1 text-xs ${
          active
            ? 'border-accent text-accent'
            : 'border-border text-ink-2 hover:text-ink'
        }`}
      >
        {name}
      </Link>
    )
  }

  return (
    <nav
      className="flex flex-wrap items-center gap-z2"
      aria-label={labels.label}
    >
      {item(null, labels.all)}
      {companies.map((company) => item(company.id, company.name))}
    </nav>
  )
}

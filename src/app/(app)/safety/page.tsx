import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { MedicalCertUpload } from './MedicalCertUpload'
import { medLabels } from './med-labels'
import { companyScopeFilter } from '@/lib/tenancy'
import {
  COMPLIANCE_SUBJECTS,
  TRACKED_TYPES,
  complianceQueue,
  type ComplianceRow,
  type ComplianceSubject,
} from '@/lib/compliance'
import { FilterBar } from '@/components/ui/FilterBar'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import type { ComplianceType } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'
import type { StatusTone } from '@/lib/status'

// PHASE 4 §5 STEP 1 — the compliance queue.
//
// Everything expiring inside the authority's own lead time, and everything
// already past. Current records are NOT here: this is a queue, and a queue
// listing what needs nothing is a list nobody works from. The asset panels
// (step 2) carry the full history.
//
// Every figure comes from `complianceQueue`, which is the same derivation the
// dashboard row counts and the panels will render — §4's first acceptance box
// asks that the three agree, and they agree by being one function.

const TONE: Record<ComplianceRow['status'], StatusTone> = {
  current: 'success',
  expiring: 'warning',
  expired: 'danger',
}

export default async function SafetyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // `compliance`, not a money resource: a dispatcher reads this because it
  // gates a dispatch decision they make (§2.5).
  if (!(await currentUserCan('read', 'compliance'))) notFound()
  const maySeeInspections = await currentUserCan('read', 'inspection')
  const maySeeClaims = await currentUserCan('read', 'claim')

  const params = await searchParams
  const { t } = await getLocaleContext()

  const subjectParam =
    typeof params['subject'] === 'string'
      ? (params['subject'] as ComplianceSubject)
      : undefined
  const typeParam =
    typeof params['type'] === 'string'
      ? (params['type'] as ComplianceType)
      : undefined

  // ── WHOSE MEDICAL CERTIFICATE IS BEING FILED ────────────────────────────
  //
  // A driver id, or the literal `new` when nobody has been chosen yet. It
  // travels in the URL and is RE-RESOLVED below against the tenant scope, so
  // the subject is a claim the server checks rather than one a browser makes —
  // the same posture `/api/med/read` takes with the id it receives.
  const medFor = typeof params['medFor'] === 'string' ? params['medFor'] : null
  const mayFileCompliance = await currentUserCan('create', 'compliance')

  const { rows, leadDays, counts } = await withCurrentOrg(
    'read',
    'compliance',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)

      // The filtered list, plus the UNFILTERED set the chip counts come from.
      // Counting from the filtered list would make every chip read the number
      // of rows already on screen, which is the one number a chip must not say.
      const [filtered, all] = await Promise.all([
        complianceQueue(tx, scope, {
          ...(subjectParam ? { subject: subjectParam } : {}),
          ...(typeParam ? { type: typeParam } : {}),
        }),
        complianceQueue(tx, scope),
      ])

      // Each chip's count honours the OTHER filter and ignores its own group,
      // so clicking one lands on exactly the number it promised — the same
      // rule the Loads chips follow.
      const bySubject = (subject: ComplianceSubject) =>
        all.rows.filter(
          (row) =>
            row.subject === subject && (!typeParam || row.type === typeParam),
        ).length
      const byType = (type: ComplianceType) =>
        all.rows.filter(
          (row) =>
            row.type === type &&
            (!subjectParam || row.subject === subjectParam),
        ).length

      return {
        rows: filtered.rows,
        leadDays: filtered.leadDays,
        counts: {
          subject: Object.fromEntries(
            COMPLIANCE_SUBJECTS.map((s) => [s, bySubject(s)]),
          ) as Record<string, number>,
          type: Object.fromEntries(
            TRACKED_TYPES.map((type) => [type, byType(type)]),
          ) as Record<string, number>,
        },
      }
    },
  )

  // ── THE SUBJECT, RESOLVED RATHER THAN TRUSTED ───────────────────────────
  //
  // Read inside `withCurrentOrg`, so row-level security decides whether this
  // caller may see the driver at all: one from another organization comes back
  // as not found, which is the same answer as one that does not exist — and
  // that is the correct answer to give, because telling them apart would
  // confirm the row is there.
  //
  // ONLY WHEN THE PERMISSION IS HELD. Resolving a driver to offer an upload
  // somebody may not file is work done for a refusal, and the route checks the
  // same permission again on the way in.
  const filingFor =
    mayFileCompliance && medFor && medFor !== 'new'
      ? await withCurrentOrg('read', 'driver', async (tx) =>
          tx.driver.findFirst({
            where: { id: medFor, deletedAt: null },
            select: { id: true, firstName: true, lastName: true },
          }),
        )
      : null

  // The picker's options, loaded only when somebody has asked for one. A
  // driver with no compliance row cannot be reached from the queue, so this is
  // the way in for them — and it ASKS rather than inferring, because there is
  // no row stating who it is for.
  const pickable =
    mayFileCompliance && medFor === 'new'
      ? await withCurrentOrg('read', 'driver', async (tx, session) =>
          tx.driver.findMany({
            where: {
              ...companyScopeFilter(session.companyScopes),
              deletedAt: null,
            },
            orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
            take: 300,
            select: { id: true, firstName: true, lastName: true },
          }),
        )
      : []

  const isFiltered = Boolean(subjectParam || typeParam)
  const day = (value: Date) => value.toISOString().slice(0, 10)

  /** "12 days", "today", "40 days ago" — the number a person acts on. */
  const when = (row: ComplianceRow) => {
    if (row.daysLeft === 0) return t('safety.dueToday')
    if (row.daysLeft < 0)
      return t('safety.overdue').replace('{days}', String(-row.daysLeft))
    return t('safety.daysLeft').replace('{days}', String(row.daysLeft))
  }

  const href = (row: ComplianceRow) =>
    row.subject === 'driver'
      ? `/drivers/${row.subjectId}`
      : row.subject === 'trailer'
        ? `/trailers/${row.subjectId}`
        : `/trucks/${row.subjectId}`

  const columns: Column<ComplianceRow>[] = [
    {
      key: 'subject',
      header: t('safety.column.subject'),
      render: (row) => (
        // Straight to the asset, because the next thing anybody does with an
        // expiring inspection is open the truck it belongs to.
        <Link
          href={href(row)}
          className="z-identifier font-mono font-medium text-ink hover:text-accent"
        >
          {row.subjectLabel}
        </Link>
      ),
    },
    {
      key: 'type',
      header: t('safety.column.type'),
      truncate: true,
      render: (row) => t(`complianceType.${row.type}` as MessageKey),
    },
    {
      key: 'authority',
      header: t('safety.column.authority'),
      truncate: true,
      render: (row) => row.companyName,
    },
    {
      key: 'identifier',
      header: t('safety.column.identifier'),
      render: (row) => (
        // Never truncated: a policy number is a field people copy.
        <span className="font-mono text-xs">{row.identifier ?? '—'}</span>
      ),
    },
    {
      key: 'expires',
      header: t('safety.column.expires'),
      render: (row) => (
        <span className="font-mono">
          {day(row.expiresAt)} <span className="text-ink-3">· {when(row)}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: t('safety.column.status'),
      render: (row) => (
        <StatusBadge
          tone={TONE[row.status]}
          label={t(`safety.status.${row.status}` as MessageKey)}
        />
      ),
    },
    // ── THE UPLOAD, ON THE ROW THAT NAMES ITS SUBJECT ─────────────────────
    //
    // Only on a DRIVER's MEDICAL_CARD row, because that is the only row whose
    // subject and document type together state what a medical certificate
    // upload needs. A truck's registration row names a truck; offering the
    // same control there would be offering to file a certificate against a
    // vehicle.
    //
    // A LINK, NOT A BUTTON. The subject rides in the URL and is re-resolved
    // server-side, so the panel that opens is one the server agreed to — and
    // the whole thing survives a page refresh, which a client-side disclosure
    // would not.
    ...(mayFileCompliance
      ? ([
          {
            key: 'file',
            header: t('safety.column.file'),
            render: (row) =>
              row.subject === 'driver' && row.type === 'MEDICAL_CARD' ? (
                <Link
                  href={`/safety?medFor=${row.subjectId}`}
                  className="whitespace-nowrap text-sm text-accent hover:underline"
                >
                  {t('safety.med.fileNew')}
                </Link>
              ) : null,
          },
        ] as Column<ComplianceRow>[])
      : []),
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('safety.title')}</h1>
        <div className="flex items-baseline gap-z4">
          <p className="max-w-[60ch] text-sm text-ink-3">
            {t('safety.hint').replace('{days}', String(leadDays))}
          </p>
          {/* The queue's sibling. Inspections are not a queue — a clean one
           * needs nothing done and still belongs on file — so they get their
           * own screen rather than rows here, and this is the way in. */}
          {/* THE WAY IN FOR A DRIVER WITH NO ROW. Everyone else is reachable
           * from the queue; somebody who has never had a medical card on
           * file is not, and this is how they get one. */}
          {mayFileCompliance && !filingFor && medFor !== 'new' ? (
            <Link
              href="/safety?medFor=new"
              className="whitespace-nowrap text-sm text-accent hover:underline"
            >
              {t('safety.med.open')}
            </Link>
          ) : null}
          {maySeeInspections ? (
            <Link
              href="/safety/inspections"
              className="whitespace-nowrap text-sm text-accent hover:underline"
            >
              {t('ins.open')}
            </Link>
          ) : null}
          {/* A DISPATCHER holds `inspection:read` and not `claim:read`, so
           * these two links are separate questions and not one heading. */}
          {maySeeClaims ? (
            <Link
              href="/safety/claims"
              className="whitespace-nowrap text-sm text-accent hover:underline"
            >
              {t('claims.open')}
            </Link>
          ) : null}
        </div>
      </div>

      <FilterBar
        clearLabel={t('loads.filter.clear')}
        moreLabel={t('loads.filter.more')}
        groups={[
          {
            param: 'subject',
            label: t('safety.subject'),
            choices: COMPLIANCE_SUBJECTS.map((subject) => ({
              value: subject,
              label: t(`safety.subject.${subject}` as MessageKey),
              count: counts.subject[subject] ?? 0,
            })),
          },
          {
            param: 'type',
            label: t('safety.type'),
            choices: TRACKED_TYPES.map((type) => ({
              value: type,
              label: t(`complianceType.${type}` as MessageKey),
              count: counts.type[type] ?? 0,
            })),
          },
        ]}
      />

      {/* ── FILING A CERTIFICATE, ABOVE THE QUEUE IT CAME FROM ────────────
       *
       * Two shapes, and the difference is whether anything states the
       * subject. From a row: the driver is named and resolved, so it goes
       * straight to the drop zone. From the header link: nothing states it,
       * so the screen ASKS — it does not read the name off the certificate
       * and match, which is the failure `checkDriverName` exists to warn
       * about rather than to perform. */}
      {filingFor ? (
        <div className="border-b border-border bg-surface-2 px-gutter py-z4">
          <div className="flex max-w-[520px] flex-col gap-z3">
            <MedicalCertUpload
              driverId={filingFor.id}
              driverLabel={`${filingFor.firstName} ${filingFor.lastName}`}
              labels={medLabels(t)}
            />
            <Link
              href="/safety"
              className="self-start text-sm text-ink-2 underline decoration-border-strong underline-offset-2 hover:text-accent"
            >
              {t('safety.med.cancel')}
            </Link>
          </div>
        </div>
      ) : null}

      {medFor === 'new' && mayFileCompliance ? (
        <div className="border-b border-border bg-surface-2 px-gutter py-z4">
          <div className="flex max-w-[640px] flex-col gap-z2">
            <h2 className="text-base font-medium text-ink">
              {t('safety.med.pickTitle')}
            </h2>
            <p className="max-w-[60ch] text-sm text-ink-2">
              {t('safety.med.pickBody')}
            </p>
            {pickable.length === 0 ? (
              <p className="text-sm text-ink-3">{t('safety.med.noDrivers')}</p>
            ) : (
              <ul className="flex flex-wrap gap-x-z4 gap-y-z2">
                {pickable.map((driver) => (
                  <li key={driver.id}>
                    <Link
                      href={`/safety?medFor=${driver.id}`}
                      className="text-sm text-accent hover:underline"
                    >
                      {driver.lastName}, {driver.firstName}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/safety"
              className="self-start text-sm text-ink-2 underline decoration-border-strong underline-offset-2 hover:text-accent"
            >
              {t('safety.med.cancel')}
            </Link>
          </div>
        </div>
      ) : null}

      <Table
        caption={t('safety.title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        stripeTone={(row) => TONE[row.status]}
        empty={
          // Two different sentences, because "nothing is expiring" and "nothing
          // matches this filter" send a person to different places (§10).
          isFiltered ? (
            <EmptyState
              title={t('safety.filtered.title')}
              body={t('safety.filtered.body')}
            />
          ) : (
            <EmptyState
              title={t('safety.empty.title')}
              body={t('safety.empty.body').replace('{days}', String(leadDays))}
            />
          )
        }
      />
    </>
  )
}

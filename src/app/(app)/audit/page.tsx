import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { renderStopTime } from '@/lib/stop-time'
import { AUDIT_TRAIL_LIMIT, recentAuditRows } from '@/lib/audit-trail'
import { Table, type Column } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '../_grid/PageHeader'
import type { MessageKey } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// ADMIN → AUDIT. "Who did what", without a production connection string.
//
// UAT's finding: the audit trail has been durable since Phase 1 and there was
// no way to LOOK at it. An owner asking "who voided that invoice" had to be
// handed a psql prompt, which is both a bad answer and a worse habit.
//
// ── THE SMALLEST THING THAT ANSWERS THE QUESTION ─────────────────────────
//
// The most recent fifty rows, newest first. No filters, no date range, no
// export, no search — those are a later task and each of them is a decision
// about what an audit view is FOR. This one is for the question above.
//
// ── IT ONLY READS ────────────────────────────────────────────────────────
//
// `AuditLog` is still written exactly as it was: by the Prisma client extension,
// inside the caller's transaction, behind a SAVEPOINT (`src/lib/audit.ts`).
// Nothing on this screen writes, and the sink in `audit-sink.ts` is still the
// fleet-wide health signal for failures and gaps.
//
// ── THE TENANT FENCE ─────────────────────────────────────────────────────
//
// `withCurrentOrg` sets `app.current_org_id` and `AuditLog` carries
// `FORCE ROW LEVEL SECURITY` with the `org_isolation` policy, so the rows this
// page can see are the organization's own and there is no way to ask for
// another's. `tests/integration/audit-trail.test.ts` seeds two organizations and
// reads as one.
//
// PERMISSION IS `auditLog:read`, decided in `permissions.ts` and nowhere else
// (AGENTS.md). OWNER and ADMIN hold it; MANAGER's grant was removed in the same
// commit, because an audit trail is where you look to find out what an operator
// did and "watches the numbers" is not the same authority.
// ---------------------------------------------------------------------------

interface Row {
  id: string
  at: string
  actor: string
  action: string
  entity: string
  entityId: string
  fields: string
}

export default async function AuditPage() {
  // §4: a route a role may not use should not exist for that role either.
  if (!(await currentUserCan('read', 'auditLog'))) notFound()

  const { t, locale } = await getLocaleContext()

  const { rows, zone } = await withCurrentOrg(
    'read',
    'auditLog',
    async (tx) => {
      const entries = await recentAuditRows(tx)
      // THE AUTHORITY'S OWN CLOCK, as every other timestamp on a Zebra screen:
      // an audit line read at 7am in Dushanbe is about something that happened
      // on a Chicago afternoon.
      const company = await tx.company.findFirst({ select: { timezone: true } })
      return { rows: entries, zone: company?.timezone ?? 'America/Chicago' }
    },
  )

  const table: Row[] = rows.map((row) => ({
    id: row.id,
    at:
      renderStopTime(row.at, null, { fallbackZone: zone, locale })?.text ?? '—',
    // §8's em dash for "not recorded": a migration, a backfill or a system job
    // writes with no acting user, and that is a fact about the row rather than a
    // missing value.
    actor: row.actor ?? '—',
    action: t(`auditAction.${row.action}` as MessageKey),
    entity: row.entityType,
    entityId: row.entityId,
    // FIELD NAMES, NEVER VALUES. See the note on `AuditTrailRow.fields`.
    fields: row.fields.length === 0 ? '—' : row.fields.join(', '),
  }))

  const columns: Column<Row>[] = [
    {
      key: 'at',
      header: t('audit.when'),
      render: (row) => (
        <span className="whitespace-nowrap text-ink">{row.at}</span>
      ),
    },
    {
      key: 'actor',
      header: t('audit.who'),
      render: (row) => <span className="text-ink">{row.actor}</span>,
    },
    {
      key: 'action',
      header: t('audit.action'),
      render: (row) => (
        <span className="font-medium text-ink">{row.action}</span>
      ),
    },
    {
      key: 'entity',
      header: t('audit.entity'),
      render: (row) => <span className="text-ink">{row.entity}</span>,
    },
    {
      key: 'entityId',
      header: t('audit.entityId'),
      // THE ID IS A DATABASE FACT and §8 forbids one in a HEADING, not in a
      // cell: this is the audit trail, and the id is how a row is traced back
      // to the record it is about.
      render: (row) => (
        <span className="z-identifier font-mono text-xs text-ink-2" dir="ltr">
          {row.entityId}
        </span>
      ),
    },
    {
      key: 'fields',
      header: t('audit.changed'),
      render: (row) => <span className="text-ink-2">{row.fields}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title={t('audit.title')}
        breadcrumb={[t('nav.group.admin'), t('audit.title')]}
      />
      <p className="border-b border-border bg-surface-2 px-gutter py-z2 text-xs text-ink-2">
        {t('audit.scopeNote')}
      </p>
      <Table
        columns={columns}
        rows={table}
        rowKey={(row) => row.id}
        caption={t('audit.title')}
        empty={
          <EmptyState title={t('audit.empty')} body={t('audit.emptyHint')} />
        }
      />
    </>
  )
}

/** Exported for the test that asserts the page shows a bounded number of rows. */
export const SHOWN = AUDIT_TRAIL_LIMIT

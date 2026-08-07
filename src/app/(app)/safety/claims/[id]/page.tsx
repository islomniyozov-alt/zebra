import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import {
  CLAIM_LADDER,
  CLAIM_PARTY_ROLES,
  claimById,
  documentsForClaims,
} from '@/lib/claims'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  ClaimDocuments,
  ClaimMove,
  ClaimParties,
  ClaimTimeline,
} from '../../../_reference/ClaimPanels'
import type { ClaimStatus } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'
import type { StatusTone } from '@/lib/status'

// PHASE 4 §5 STEP 5 — one claim.
//
// The facts, the parties, the timeline and the ladder. The money is three
// numbers and the third is derived: claimed, paid, and the difference — which
// is the figure an owner actually wants when the file is finally closed, and
// which is computed here rather than stored so it cannot disagree with the two
// it comes from (rule 9-money).

const TONE: Record<ClaimStatus, StatusTone> = {
  OPEN: 'warning',
  UNDER_REVIEW: 'progress',
  DISPUTED: 'danger',
  RESOLVED: 'success',
  DENIED: 'muted',
  CLOSED: 'muted',
}

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await currentUserCan('read', 'claim'))) notFound()

  const { id } = await params
  const { t, locale } = await getLocaleContext()

  const data = await withCurrentOrg('read', 'claim', async (tx) => {
    // Row-level security has already removed another tenant's claims, so a
    // miss here is a genuine 404 rather than a permission answer in disguise.
    const claim = await claimById(tx, id)
    if (!claim) return null

    const documents = await documentsForClaims(tx, [id])
    return { claim, documents: documents.get(id) ?? [] }
  })

  if (!data) notFound()
  const { claim, documents } = data

  const mayWrite = await currentUserCan('update', 'claim')
  const mayAttach = await currentUserCan('create', 'document')

  const day = (value: Date) => value.toISOString().slice(0, 10)
  const status = (value: ClaimStatus) => t(`claimStatus.${value}` as MessageKey)

  const facts: { label: string; value: string }[] = [
    {
      label: t('claims.type'),
      value: t(`claimType.${claim.type}` as MessageKey),
    },
    {
      label: t('claims.detail.incident'),
      value: claim.incidentAt ? day(claim.incidentAt) : '—',
    },
    { label: t('claims.detail.opened'), value: day(claim.createdAt) },
    { label: t('safety.column.authority'), value: claim.companyName },
    ...(claim.claimantName
      ? [{ label: t('claims.column.claimant'), value: claim.claimantName }]
      : []),
    ...(claim.claimNumber
      ? [{ label: t('claims.detail.number'), value: claim.claimNumber }]
      : []),
  ]

  const claimed = claim.amountClaimedCents
  const paid = claim.amountPaidCents

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="flex items-baseline gap-z3 text-lg font-medium text-ink">
          {t('claims.detail.title')}
          <span className="font-mono text-ink-2">
            {claim.incidentAt ? day(claim.incidentAt) : day(claim.createdAt)}
          </span>
          <StatusBadge tone={TONE[claim.status]} label={status(claim.status)} />
        </h1>
        <Link
          href="/safety/claims"
          className="text-sm text-accent hover:underline"
        >
          {t('claims.back')}
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <div className="flex max-w-[900px] flex-col gap-z4">
          <section className="rounded-card border border-border bg-surface p-z4">
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-z3">
              {facts.map((fact) => (
                <div key={fact.label} className="flex flex-col gap-z1">
                  <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
                    {fact.label}
                  </dt>
                  <dd className="z-identifier text-ink">{fact.value}</dd>
                </div>
              ))}
              {claim.truck ? (
                <div className="flex flex-col gap-z1">
                  <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
                    {t('claims.detail.truck')}
                  </dt>
                  <dd>
                    <Link
                      href={`/trucks/${claim.truck.id}`}
                      className="z-identifier text-accent hover:underline"
                    >
                      {claim.truck.unitNumber}
                    </Link>
                  </dd>
                </div>
              ) : null}
              {claim.driver ? (
                <div className="flex flex-col gap-z1">
                  <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
                    {t('claims.detail.driver')}
                  </dt>
                  <dd>
                    <Link
                      href={`/drivers/${claim.driver.id}`}
                      className="z-identifier text-accent hover:underline"
                    >
                      {claim.driver.name}
                    </Link>
                  </dd>
                </div>
              ) : null}
              {claim.load ? (
                <div className="flex flex-col gap-z1">
                  <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
                    {t('claims.detail.load')}
                  </dt>
                  <dd>
                    <Link
                      href={`/loads/${claim.load.id}`}
                      className="z-identifier text-accent hover:underline"
                    >
                      {claim.load.loadNumber}
                    </Link>
                  </dd>
                </div>
              ) : null}
            </dl>

            {/* Claimed, paid, and the difference — which a reader can check by
             * subtracting the two above it. */}
            <dl className="mt-z3 flex flex-wrap gap-x-z5 gap-y-z2 border-t border-border pt-z3">
              <div className="flex flex-col gap-z1">
                <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
                  {t('claims.detail.claimed')}
                </dt>
                <dd className="font-mono tabular-nums text-ink">
                  {claimed === null ? '—' : formatCents(claimed, locale)}
                </dd>
              </div>
              <div className="flex flex-col gap-z1">
                <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
                  {t('claims.detail.paid')}
                </dt>
                <dd className="font-mono tabular-nums text-ink">
                  {paid === null ? '—' : formatCents(paid, locale)}
                </dd>
              </div>
              {claimed !== null && paid !== null ? (
                <div className="flex flex-col gap-z1">
                  <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
                    {t('claims.detail.difference')}
                  </dt>
                  <dd className="font-mono tabular-nums font-medium text-ink">
                    {formatCents(claimed - paid, locale)}
                  </dd>
                </div>
              ) : null}
            </dl>

            {claim.description ? (
              <p className="mt-z3 max-w-[68ch] border-t border-border pt-z3 text-sm text-ink-2">
                {claim.description}
              </p>
            ) : null}
            {claim.resolution ? (
              <p className="mt-z2 max-w-[68ch] text-sm text-ink">
                <span className="text-ink-3">
                  {t('claims.detail.resolution')}{' '}
                </span>
                {claim.resolution}
              </p>
            ) : null}
          </section>

          <ClaimParties
            claimId={claim.id}
            rows={claim.parties.map((party) => ({
              id: party.id,
              roleLabel: t(`partyRole.${party.role}` as MessageKey),
              name: party.name,
              phone: party.phone,
              email: party.email,
              reference: party.reference,
              notes: party.notes,
            }))}
            roles={CLAIM_PARTY_ROLES.map((role) => ({
              value: role,
              label: t(`partyRole.${role}` as MessageKey),
            }))}
            mayWrite={mayWrite}
            translate={{ 'claims.parties.error': t('claims.parties.error') }}
            labels={{
              title: t('claims.parties.title'),
              hint: t('claims.parties.hint'),
              none: t('claims.parties.none'),
              add: t('claims.parties.add'),
              role: t('claims.parties.role'),
              name: t('claims.parties.name'),
              phone: t('claims.parties.phone'),
              email: t('claims.parties.email'),
              reference: t('claims.parties.reference'),
              notes: t('claims.parties.notes'),
              save: t('claims.parties.save'),
              remove: t('claims.parties.remove'),
            }}
          />

          <ClaimMove
            claimId={claim.id}
            // Read from the service's own table, so the select offers exactly
            // the moves it would accept.
            nextStatuses={CLAIM_LADDER[claim.status].map((next) => ({
              value: next,
              label: status(next),
            }))}
            translate={{
              'claims.error.refused': t('claims.error.refused'),
              'claims.error.notFound': t('claims.error.notFound'),
              'claims.error.badAmount': t('claims.error.badAmount'),
            }}
            labels={{
              title: t('claims.move.title'),
              hint: t('claims.move.hint'),
              to: t('claims.move.to'),
              note: t('claims.move.note'),
              paid: t('claims.move.paid'),
              resolution: t('claims.move.resolution'),
              save: t('claims.move.save'),
              closed: t('claims.move.closed'),
            }}
          />

          <ClaimTimeline
            claimId={claim.id}
            rows={claim.timeline.map((entry) => ({
              id: entry.id,
              when: day(entry.createdAt),
              body: entry.body,
              movement:
                entry.fromStatus && entry.toStatus
                  ? t('claims.timeline.moved')
                      .replace('{from}', status(entry.fromStatus))
                      .replace('{to}', status(entry.toStatus))
                  : entry.toStatus
                    ? t('claims.timeline.opened')
                    : null,
              authorName: entry.authorName,
            }))}
            mayWrite={mayWrite}
            translate={{ 'claims.error.notFound': t('claims.error.notFound') }}
            labels={{
              title: t('claims.timeline.title'),
              hint: t('claims.timeline.hint'),
              none: t('claims.timeline.none'),
              add: t('claims.timeline.add'),
              body: t('claims.timeline.body'),
              save: t('claims.timeline.save'),
              by: t('claims.timeline.by'),
            }}
          />

          <ClaimDocuments
            claimId={claim.id}
            documents={documents}
            mayAttach={mayAttach && mayWrite}
            labels={{
              title: t('claims.detail.documents'),
              attach: t('claims.detail.attach'),
              preparing: t('compliancePanel.preparing'),
              uploading: t('compliancePanel.uploading'),
              failed: t('compliancePanel.failed'),
            }}
          />
        </div>
      </div>
    </>
  )
}

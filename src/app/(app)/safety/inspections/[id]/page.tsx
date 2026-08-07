import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  VIOLATION_UNITS,
  documentsForInspections,
  inspectionById,
} from '@/lib/inspections'
import {
  DATAQS_LADDER,
  DATAQS_OUTCOMES,
  challengesForInspection,
} from '@/lib/dataqs'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ViolationPanel } from '../../../_reference/ViolationPanel'
import { DataQsPanel } from '../../../_reference/DataQsPanel'
import type { MessageKey } from '@/lib/i18n'

// PHASE 4 §5 STEP 4 — one inspection.
//
// The event at the top, the violations under it, the report attached to the
// whole thing. This is the row a DataQs challenge will be written against in
// step 5, so everything a challenge needs — report number, date, state, code —
// is here in full and none of it is truncated.

export default async function InspectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await currentUserCan('read', 'inspection'))) notFound()

  const { id } = await params
  const { t } = await getLocaleContext()

  const data = await withCurrentOrg('read', 'inspection', async (tx) => {
    // Row-level security has already removed another tenant's inspections, so
    // a miss here is a genuine 404 rather than a permission answer in disguise.
    const inspection = await inspectionById(tx, id)
    if (!inspection) return null

    const documents = await documentsForInspections(tx, [id])
    return { inspection, documents: documents.get(id) ?? [] }
  })

  if (!data) notFound()
  const { inspection, documents } = data

  const mayEdit = await currentUserCan('update', 'inspection')
  const mayAttach = await currentUserCan('create', 'document')

  // §2.5 puts DataQs with claims — OWNER/ADMIN/MANAGER write, ACCOUNTING
  // reads — so it is a separate question from reading the inspection, and a
  // DISPATCHER who can open this page sees no challenges panel at all.
  const maySeeChallenges = await currentUserCan('read', 'dataQs')
  const mayWriteChallenges = await currentUserCan('create', 'dataQs')

  const challenges = maySeeChallenges
    ? await withCurrentOrg('read', 'dataQs', (tx) =>
        challengesForInspection(tx, id),
      )
    : []

  const day = (value: Date) => value.toISOString().slice(0, 10)

  const subjects: { label: string; href: string; value: string }[] = [
    ...(inspection.truck
      ? [
          {
            label: t('ins.new.truck'),
            href: `/trucks/${inspection.truck.id}`,
            value: inspection.truck.unitNumber,
          },
        ]
      : []),
    ...(inspection.trailer
      ? [
          {
            label: t('ins.new.trailer'),
            href: `/trailers/${inspection.trailer.id}`,
            value: inspection.trailer.unitNumber,
          },
        ]
      : []),
    ...(inspection.driver
      ? [
          {
            label: t('ins.new.driver'),
            href: `/drivers/${inspection.driver.id}`,
            value: inspection.driver.name,
          },
        ]
      : []),
  ]

  const facts: { label: string; value: string }[] = [
    { label: t('ins.column.date'), value: day(inspection.inspectedAt) },
    {
      label: t('ins.level'),
      value: t(`insLevel.${inspection.level}` as MessageKey),
    },
    { label: t('ins.column.state'), value: inspection.state },
    ...(inspection.reportNumber
      ? [{ label: t('ins.column.report'), value: inspection.reportNumber }]
      : []),
    ...(inspection.location
      ? [{ label: t('ins.detail.where'), value: inspection.location }]
      : []),
    ...(inspection.inspectorName
      ? [{ label: t('ins.detail.inspector'), value: inspection.inspectorName }]
      : []),
    { label: t('safety.column.authority'), value: inspection.companyName },
  ]

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="flex items-baseline gap-z3 text-lg font-medium text-ink">
          {t('ins.detail.title')}
          <span className="font-mono text-ink-2">
            {day(inspection.inspectedAt)}
          </span>
          {inspection.outOfService ? (
            <StatusBadge tone="danger" label={t('ins.oos')} />
          ) : inspection.isClean ? (
            <StatusBadge tone="success" label={t('ins.clean')} />
          ) : null}
        </h1>
        <Link
          href="/safety/inspections"
          className="text-sm text-accent hover:underline"
        >
          {t('ins.back')}
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
              {subjects.map((subject) => (
                <div key={subject.label} className="flex flex-col gap-z1">
                  <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
                    {subject.label}
                  </dt>
                  <dd>
                    {/* Straight to the unit, because the next question anybody
                     * asks is what else that truck has been through. */}
                    <Link
                      href={subject.href}
                      className="z-identifier text-accent hover:underline"
                    >
                      {subject.value}
                    </Link>
                  </dd>
                </div>
              ))}
            </dl>
            {inspection.notes ? (
              <p className="mt-z3 max-w-[68ch] border-t border-border pt-z3 text-sm text-ink-2">
                {inspection.notes}
              </p>
            ) : null}
          </section>

          <ViolationPanel
            inspectionId={inspection.id}
            rows={inspection.violations.map((violation) => ({
              id: violation.id,
              code: violation.code,
              description: violation.description,
              unitLabel: t(`insUnit.${violation.unit}` as MessageKey),
              outOfService: violation.outOfService,
              severityWeight: violation.severityWeight,
            }))}
            units={VIOLATION_UNITS.map((unit) => ({
              value: unit,
              label: t(`insUnit.${unit}` as MessageKey),
            }))}
            documents={documents}
            mayEdit={mayEdit}
            mayAttach={mayAttach}
            translate={{
              'ins.error.inspectionNotFound': t('ins.error.inspectionNotFound'),
              'ins.error.noCode': t('ins.error.noCode'),
              'ins.error.badWeight': t('ins.error.badWeight'),
            }}
            labels={{
              title: t('ins.detail.violations'),
              none: t('ins.detail.noViolations'),
              add: t('ins.detail.addViolation'),
              code: t('ins.detail.code'),
              codeHint: t('ins.detail.codeHint'),
              description: t('ins.detail.description'),
              unit: t('ins.detail.unit'),
              oos: t('ins.detail.oos'),
              weight: t('ins.detail.weight'),
              weightHint: t('ins.detail.weightHint'),
              save: t('ins.detail.add'),
              withdraw: t('ins.detail.withdraw'),
              withdrawnHint: t('ins.detail.withdrawnHint'),
              report: t('ins.detail.report'),
              attach: t('ins.detail.attach'),
              preparing: t('compliancePanel.preparing'),
              uploading: t('compliancePanel.uploading'),
              failed: t('compliancePanel.failed'),
            }}
          />

          {/* PHASE 4 §5 STEP 5. The last two links of §4's trace, on the same
           * screen as the first two: inspection → violation → challenge →
           * outcome, readable without navigating anywhere. */}
          {maySeeChallenges ? (
            <DataQsPanel
              inspectionId={inspection.id}
              rows={challenges.map((challenge) => ({
                id: challenge.id,
                violationCode: challenge.violation?.code ?? null,
                status: challenge.status,
                statusLabel: t(
                  `dataqsStatus.${challenge.status}` as MessageKey,
                ),
                outcome: challenge.outcome,
                outcomeLabel: challenge.outcome
                  ? t(`dataqsOutcome.${challenge.outcome}` as MessageKey)
                  : null,
                basis: challenge.basis,
                outcomeNote: challenge.outcomeNote,
                referenceNumber: challenge.referenceNumber,
                submitted: challenge.submittedAt
                  ? day(challenge.submittedAt)
                  : null,
                decided: challenge.decidedAt ? day(challenge.decidedAt) : null,
                // THE LADDER IS READ FROM THE SERVICE, so the select offers
                // exactly the moves the service would accept. A control that
                // offers a refusal teaches people to distrust the screen.
                nextStatuses: DATAQS_LADDER[challenge.status].map((next) => ({
                  value: next,
                  label: t(`dataqsStatus.${next}` as MessageKey),
                })),
              }))}
              violations={[
                // The whole-inspection option first: a carrier disputing "this
                // was not our truck" is not disputing any single code.
                { value: '', label: t('dataqs.wholeInspection') },
                ...inspection.violations.map((violation) => ({
                  value: violation.id,
                  label: violation.code,
                })),
              ]}
              outcomes={DATAQS_OUTCOMES.map((outcome) => ({
                value: outcome,
                label: t(`dataqsOutcome.${outcome}` as MessageKey),
              }))}
              mayWrite={mayWriteChallenges}
              translate={{
                'dataqs.error.inspectionNotFound': t(
                  'dataqs.error.inspectionNotFound',
                ),
                'dataqs.error.violationNotOnInspection': t(
                  'dataqs.error.violationNotOnInspection',
                ),
                'dataqs.error.noBasis': t('dataqs.error.noBasis'),
                'dataqs.error.needsOutcome': t('dataqs.error.needsOutcome'),
                'dataqs.error.refused': t('dataqs.error.refused'),
                'dataqs.error.notFound': t('dataqs.error.notFound'),
              }}
              labels={{
                title: t('dataqs.title'),
                hint: t('dataqs.hint'),
                none: t('dataqs.none'),
                add: t('dataqs.add'),
                violation: t('dataqs.violation'),
                basis: t('dataqs.basis'),
                reference: t('dataqs.reference'),
                save: t('dataqs.save'),
                status: t('dataqs.status'),
                outcome: t('dataqs.outcome'),
                outcomeNote: t('dataqs.outcomeNote'),
                submitted: t('dataqs.submitted'),
                decided: t('dataqs.decided'),
                move: t('dataqs.move'),
                moveTo: t('dataqs.moveTo'),
                pickOutcome: t('dataqs.pickOutcome'),
                noOutcome: t('dataqs.noOutcome'),
              }}
            />
          ) : null}
        </div>
      </div>
    </>
  )
}

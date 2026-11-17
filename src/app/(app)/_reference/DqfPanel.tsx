import Link from 'next/link'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { StatusTone } from '@/lib/status'
import type { DqfStatus } from '@/lib/dqf'
import {
  AttachDocument,
  DocumentLink,
  UploadTo,
  type UploadLabels,
} from './DocumentControls'
import { DqfRecordForm } from './DqfRecordForm'

// ITEM 13 — THE DRIVER QUALIFICATION FILE, ON THE DRIVER'S OWN SCREEN.
//
// IT TAKES ROWS, not a transaction, like `InspectionPanel` beside it — the
// query runs inside the page's `withCurrentOrg` and the connection is gone by
// the time this renders.
//
// EVERY ROW CARRIES ITS CFR SECTION. This screen is read when an auditor is
// in the building, and "Missing" next to "391.23(a)(2)" is a sentence somebody
// can act on; "Missing" on its own is a puzzle.
//
// ── AND SINCE v11.30, EVERY ROW ITS ACTION ───────────────────────────────
//
// It used to record nothing, on the argument that the evidence is filed in
// the panels around it. The safety team read nine rows of "Missing — Since No
// hire date recorded" and found nothing to press (2026-11-17). So each row now
// offers the act that satisfies it, derived from its evidence by
// `dqfRowAction` — a link to Main, an Upload, a Record — through the SAME
// writers the panels use (the upload pipeline, `recordRenewal`), so there is
// still one way evidence is filed, reachable from the row that needs it. A row
// on file links its document; a dated row on file with nothing attached
// offers Attach.

const TONE: Record<DqfStatus, StatusTone> = {
  present: 'success',
  // DUE IS NOT A FAILURE. The driver is qualified today and somebody has a
  // month to keep them that way — warning tone, not danger.
  due: 'warning',
  expired: 'danger',
  // MISSING IS ALSO DANGER, and deliberately the same weight as expired. A
  // regulator does not grade "we never obtained it" more kindly than "it
  // lapsed"; muting it here would be this screen having an opinion the
  // audit does not share.
  missing: 'danger',
}

/** The act a row offers, already gated by the viewer's permissions. */
export type DqfPanelAction =
  | { kind: 'main'; href: string }
  | { kind: 'upload'; driverId: string; documentType: string }
  | {
      kind: 'record'
      driverId: string
      complianceType: string
      defaultExpires: string
    }

export interface DqfPanelRow {
  key: string
  label: string
  cfr: string
  cadenceLabel: string
  status: DqfStatus
  statusLabel: string
  /** Already formatted, or null when there is no date to show. */
  since: string | null
  /** Null when the viewer may not take it. */
  action: DqfPanelAction | null
  /** The document that satisfies the row, when one is on file. */
  onFile: { id: string; filename: string } | null
  /** A record on file with nothing attached, when the viewer may attach. */
  attach: { recordId: string; documentType: string } | null
}

interface Props {
  rows: readonly DqfPanelRow[]
  /** Null when this driver's file does not have to be current. */
  summary: string
  qualifiable: boolean
  translate: Record<string, string>
  labels: {
    title: string
    hint: string
    since: string
    notQualifiable: string
    setOnMain: string
    renew: string
    openFailed: string
    upload: UploadLabels
    attach: UploadLabels
    record: {
      record: string
      expires: string
      done: string
      save: string
      cancel: string
    }
  }
}

export function DqfPanel({
  rows,
  summary,
  qualifiable,
  translate,
  labels,
}: Props) {
  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>
      <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>

      {/* THE VERDICT FIRST. Eight rows is a table somebody has to read; one
       * sentence is what they came for, and the rows say why it says that. */}
      <p className="mt-z3 text-sm text-ink-2">
        {qualifiable ? summary : labels.notQualifiable}
      </p>

      <ul className="mt-z3 flex flex-col">
        {rows.map((row) => {
          // THE ACT IS OFFERED WHERE THE ROW IS NOT SATISFIED, and on a due
          // row, which is satisfied today and wants renewing.
          const wantsAction = row.status !== 'present'
          return (
            <li
              key={row.key}
              className="flex flex-wrap items-baseline gap-x-z3 gap-y-z1 border-b border-border py-z2 text-sm last:border-b-0"
            >
              <span className="min-w-[22ch] font-medium text-ink">
                {row.label}
              </span>
              <span className="font-mono text-xs text-ink-3">{row.cfr}</span>
              <span className="text-xs text-ink-3">{row.cadenceLabel}</span>
              <span className="ms-auto flex flex-wrap items-baseline justify-end gap-z3">
                {row.onFile ? (
                  <DocumentLink
                    id={row.onFile.id}
                    filename={row.onFile.filename}
                    failedLabel={labels.openFailed}
                  />
                ) : row.attach ? (
                  <AttachDocument
                    recordId={row.attach.recordId}
                    documentType={row.attach.documentType}
                    labels={labels.attach}
                  />
                ) : null}
                {wantsAction && row.action ? (
                  <RowAction
                    action={row.action}
                    due={row.status === 'due'}
                    translate={translate}
                    labels={labels}
                  />
                ) : null}
                {row.since === null ? null : (
                  <span className="text-xs text-ink-3">
                    {labels.since} {row.since}
                  </span>
                )}
                <StatusBadge tone={TONE[row.status]} label={row.statusLabel} />
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function RowAction({
  action,
  due,
  translate,
  labels,
}: {
  action: DqfPanelAction
  due: boolean
  translate: Record<string, string>
  labels: Props['labels']
}) {
  switch (action.kind) {
    case 'main':
      return (
        <Link
          href={action.href}
          className="text-xs text-accent underline-offset-2 hover:underline"
        >
          {labels.setOnMain}
        </Link>
      )
    case 'upload':
      return (
        <UploadTo
          target={{
            entity: 'driver',
            entityId: action.driverId,
            documentType: action.documentType,
          }}
          labels={labels.upload}
        />
      )
    case 'record':
      return (
        <DqfRecordForm
          driverId={action.driverId}
          complianceType={action.complianceType}
          defaultExpires={action.defaultExpires}
          translate={translate}
          labels={{
            ...labels.record,
            record: due ? labels.renew : labels.record.record,
          }}
        />
      )
  }
}

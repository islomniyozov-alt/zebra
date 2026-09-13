// ---------------------------------------------------------------------------
// EVERY FILE ON THIS DRIVER, INCLUDING THE ONES NOBODY READ.
//
// ── WHY THIS EXISTS, WHICH IS NOT "A DRIVER SHOULD HAVE A DOCUMENTS TAB" ──
//
// `CompliancePanel` lists documents PER COMPLIANCE RECORD — a medical card
// under the medical row, a licence under the licence row. That is the right
// shape for a document that was read, because reading it is what produced the
// record to hang it under.
//
// A CANCELLED ROTATION PRODUCES NO RECORD. Nothing was read, so there is no
// compliance row, so a panel keyed on compliance rows cannot show it — and a
// file that exists but appears on no screen is worse than one that was never
// kept: it is storage nobody is going to act on.
//
// So this lists documents by DRIVER, and its first job is the parked ones.
// Owner's ruling, 2026-09-12: "a cancelled rotation leaves the upload on the
// driver as 'not read — needs rotation', visible on the document list."
//
// READ-ONLY, AND DELIBERATELY PLAIN. It is not an uploader and not a viewer;
// `CompliancePanel` owns attaching, and a second control for the same act is a
// second place for the accept list to drift.
// ---------------------------------------------------------------------------

export interface DriverDocumentRow {
  id: string
  filename: string
  /** The one state this panel exists to make visible. */
  needsRotation: boolean
  uploadedAt: Date
}

interface Props {
  documents: readonly DriverDocumentRow[]
  labels: { heading: string; none: string; needsRotation: string }
}

const day = (value: Date) => value.toISOString().slice(0, 10)

export function DriverDocuments({ documents, labels }: Props) {
  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.heading}</h2>

      {documents.length === 0 ? (
        <p className="mt-z2 text-sm text-ink-3">{labels.none}</p>
      ) : (
        <ul className="mt-z3 flex flex-col gap-z2 text-sm">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-baseline gap-z2"
            >
              <span className="text-ink">{document.filename}</span>
              <span className="font-mono text-xs text-ink-3">
                {day(document.uploadedAt)}
              </span>
              {/* SAID IN WORDS, NOT SHOWN AS AN ABSENCE. A row that simply
               * lacked a green tick would read as "fine" at a glance, and the
               * whole point of keeping this file is that somebody has to do
               * something about it. */}
              {document.needsRotation ? (
                <span className="rounded-card border border-warning bg-warning-soft px-z2 py-px text-xs text-warning">
                  {labels.needsRotation}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

'use client'

import { MedicalCertUpload } from './MedicalCertUpload'
import { READABLE_COMPLIANCE_DOCUMENTS } from './compliance-documents'
import type { medLabels } from './med-labels'

// ---------------------------------------------------------------------------
// THE FRONT DOOR FOR A COMPLIANCE DOCUMENT.
//
// ── ONE ZONE, NOT ONE LINK PER TYPE ───────────────────────────────────────
//
// Registration and annual inspections are next. The shape they must not
// arrive in is a second "Add a registration" control beside this one, each
// with its own zone and its own copy — three of everything by the time
// inspections land. So this component owns "a compliance document arrived"
// and mounts whichever reader the type calls for.
//
// TODAY THERE IS EXACTLY ONE READER, so it mounts that one and the copy names
// it: "Drop a medical card here." That is honest rather than a placeholder —
// offering a choice of one is noise, and offering a choice that includes a
// type with no reader behind it puts a control on screen that cannot work.
//
// WHAT ADDING REGISTRATION LOOKS LIKE, so the next person is not guessing: a
// row in `compliance-documents.ts`, a reader behind its route, and a branch
// here that ASKS which type when the list has more than one. The asking is
// owed at that point and not before — the type is stated, never classified
// from the image, for the reason written out in that file.
//
// IT RENDERS IN TWO PLACES AND IS THE SAME CONTROL IN BOTH: inside the empty
// state, where there is nothing else to do, and above the table when rows
// exist. Not two components with the same copy.
// ---------------------------------------------------------------------------

interface Candidate {
  id: string
  firstName: string
  lastName: string
}

interface Props {
  roster: readonly Candidate[]
  labels: ReturnType<typeof medLabels>
  /** Bigger inside an empty state, where it is the only thing to do. */
  prominent?: boolean
  /**
   * Set when a compliance ROW opened this and stated its own subject.
   *
   * The row path goes through here too rather than mounting the reader
   * directly, so the page has one intake and not two ways in that will drift.
   * What differs is only whether the driver is already known.
   */
  driverId?: string
  driverLabel?: string
}

export function ComplianceIntake({
  roster,
  labels,
  prominent,
  driverId,
  driverLabel,
}: Props) {
  // ── WHICH READER, DECIDED FROM THE REGISTRY RATHER THAN HARD-CODED ────
  //
  // With one readable type there is nothing to ask and this mounts it. The
  // check is written as a check, not as an assumption, so the day a second
  // row lands in `READABLE_COMPLIANCE_DOCUMENTS` this stops silently reading
  // every dropped file as a medical card — it renders nothing and says why,
  // which is a visible gap rather than a wrong contract applied quietly.
  if (READABLE_COMPLIANCE_DOCUMENTS.length !== 1) {
    return (
      <p className="rounded-card border border-warning bg-warning-soft px-z3 py-z2 text-sm text-warning">
        {labels.chooseType}
      </p>
    )
  }

  return (
    <MedicalCertUpload
      roster={roster}
      labels={labels}
      prominent={prominent ?? false}
      {...(driverId ? { driverId, driverLabel } : {})}
    />
  )
}

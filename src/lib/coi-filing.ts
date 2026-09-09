import { recordRenewal, FLEET_COMPLIANCE_TYPES } from './compliance'
import { sameVin } from './extraction/vin'
import type { ComplianceType, Prisma } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// A CONFIRMED CERTIFICATE BECOMES ROWS.
//
// ── IN `src/lib/`, NOT IN THE ACTION ─────────────────────────────────────
//
// The standing rule, and this is exactly the case it exists for: an action
// body runs behind `withCurrentOrg`, so a rule written inside one can only be
// tested by standing up the whole auth context, which nobody does — and the
// rule ships on a reading instead. Three times that placement was the reason
// something went unverified. This file is callable from a test with a
// transaction and nothing else.
//
// ── ONE CERTIFICATE, ONE ROW PER COVERAGE PER SUBJECT ────────────────────
//
// The company branch writes one row per coverage against the carrier. The
// truck branch writes one per coverage PER TRUCK — an owner-operator's
// certificate covering two tractors with two coverages is four rows, because
// each truck's coverage lapses on its own and each has to alarm on its own.
//
// ── PARTIAL SUCCESS IS REPORTED, NEVER ROLLED BACK ───────────────────────
//
// If three rows landed and the fourth collided with an existing record, the
// three are real and deleting them would be this function inventing a failure.
// The result says what landed and what stopped it.
//
// ── AND THE VINs, WHICH ARE NOT COMPLIANCE ROWS AT ALL ───────────────────
//
// The owner's ruling: the certificate's VINs fill our nulls, add-missing,
// shown on the confirm step. So filing also writes a VIN onto a matched truck
// that has none — and NEVER over one that disagrees. A truck already carrying
// a different VIN is a discrepancy between two records, and a document reader
// resolving it silently is the failure this codebase keeps writing down.
// ---------------------------------------------------------------------------

/** Enough of a Prisma transaction to file with. */
type TxClient = Prisma.TransactionClient

export interface CoiCoverageToFile {
  type: ComplianceType
  /** UTC day. */
  expiresAt: Date
  effectiveAt: Date | null
  identifier: string | null
  issuer: string | null
  /** The TYPE OF INSURANCE cell as printed. Goes in the note — see below. */
  printedType: string | null
  /** The LIMITS cell as printed. Goes in the note. */
  limit: string | null
}

export interface CoiFilingInput {
  subject:
    | { kind: 'company'; companyId: string }
    | { kind: 'trucks'; truckIds: string[] }
  coverages: CoiCoverageToFile[]
  /** Matched trucks and the VIN the certificate printed for each. */
  vins: { truckId: string; vin: string }[]
}

export interface CoiFilingResult {
  recordIds: string[]
  /** Truck ids whose VIN this filing wrote. */
  vinsFilled: string[]
  /** Why it stopped, if it stopped. The rows in `recordIds` still landed. */
  failure: {
    reason:
      | 'duplicate'
      | 'bad_dates'
      | 'no_expiry'
      | 'subject_not_found'
      /** A non-fleet coverage aimed at a carrier. See the note at the check. */
      | 'not_a_fleet_type'
  } | null
}

/**
 * THE NOTE CARRIES WHAT THE COLUMN CANNOT.
 *
 * `ComplianceItem` has a type from a fixed enum and no money field. A
 * certificate printing "Non-Trucking Liability" files as `OTHER` — which on
 * its own is a row nobody can interpret — and one printing "Deductibles -
 * Comp: $2,500, Coll: $2,500" has a limit cell that is not a limit and not a
 * number. Both go in the note, as printed, because the row has to stay
 * readable back to the document it came from.
 */
function noteFor(coverage: CoiCoverageToFile): string | null {
  const parts: string[] = []
  if (coverage.printedType) parts.push(`As printed: ${coverage.printedType}`)
  if (coverage.limit) parts.push(`Limit as printed: ${coverage.limit}`)
  return parts.length > 0 ? parts.join('. ') : null
}

export async function fileCoi(
  tx: TxClient,
  input: CoiFilingInput,
): Promise<CoiFilingResult> {
  const recordIds: string[] = []
  const vinsFilled: string[] = []

  const subjects: { subject: 'company' | 'truck'; subjectId: string }[] =
    input.subject.kind === 'company'
      ? [{ subject: 'company', subjectId: input.subject.companyId }]
      : input.subject.truckIds.map((id) => ({
          subject: 'truck' as const,
          subjectId: id,
        }))

  for (const target of subjects) {
    for (const coverage of input.coverages) {
      // A COMPANY-LEVEL ROW MUST BE A TYPE THE COMPANY VIEW CAN SHOW.
      //
      // `shapeRecords` maps an unattached row to subject `company` only for
      // `FLEET_COMPLIANCE_TYPES`; any other type with no asset link is DROPPED
      // from every screen. Writing one would be a silent loss — a record that
      // exists, alarms nobody and appears nowhere — so it is refused here
      // instead, and the confirm step does not offer the choice.
      if (
        target.subject === 'company' &&
        !FLEET_COMPLIANCE_TYPES.includes(coverage.type)
      ) {
        return {
          recordIds,
          vinsFilled,
          failure: { reason: 'not_a_fleet_type' },
        }
      }

      const result = await recordRenewal(tx, {
        subject: target.subject,
        subjectId: target.subjectId,
        type: coverage.type,
        issuedAt: coverage.effectiveAt,
        expiresAt: coverage.expiresAt,
        // THE POLICY NUMBER IDENTIFIES THE POLICY and the insurer is who
        // carries the risk. Both on the row, because a certificate nobody can
        // trace back to a policy is worth a second look.
        identifier: coverage.identifier,
        issuer: coverage.issuer,
        notes: noteFor(coverage),
      })

      if (!result.ok) return { recordIds, vinsFilled, failure: result }
      recordIds.push(result.recordId)
    }
  }

  // ── THE VINs, ADD-MISSING ──────────────────────────────────────────────
  //
  // Read then written, one truck at a time, and the read is what makes it
  // add-missing: `vin: null` in the WHERE means a row that gained a VIN
  // between the confirm step and this write is not overwritten by it.
  for (const fill of input.vins) {
    const truck = await tx.truck.findFirst({
      where: { id: fill.truckId, deletedAt: null },
      select: { id: true, vin: true },
    })
    if (!truck) continue
    if (truck.vin !== null && truck.vin.trim() !== '') {
      // Already carries one. Same VIN is nothing to do; a DIFFERENT one is a
      // discrepancy shown on screen and never resolved here.
      if (!sameVin(truck.vin, fill.vin)) continue
      continue
    }
    const written = await tx.truck.updateMany({
      where: { id: fill.truckId, vin: null, deletedAt: null },
      data: { vin: fill.vin },
    })
    if (written.count > 0) vinsFilled.push(fill.truckId)
  }

  return { recordIds, vinsFilled, failure: null }
}

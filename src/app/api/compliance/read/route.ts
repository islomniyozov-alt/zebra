import { NextResponse } from 'next/server'
import { requireSession, withCurrentOrg } from '@/lib/auth-context'
import { can } from '@/lib/permissions'
import { DOCUMENT_TYPES, IMAGE_TYPES, formatCostMilliCents } from '@/lib/claude'
import { classifyDocument } from '@/lib/classify'
import { coiProposal, readCoi } from '@/lib/coi'
import {
  inspectionPrefill,
  matchTruck,
  readAnnualInspection,
} from '@/lib/annual-inspection'
import {
  matchDriverByName,
  medicalCertProposal,
  readMedicalCert,
} from '@/lib/med-cert'
import { readRegistration } from '@/lib/vehicle-registration'
import {
  addFormFor,
  matchRegistrationUnit,
  type RegistrationUnitCandidate,
} from '@/lib/registration-match'
import { READABLE_COMPLIANCE_DOCUMENTS } from '@/app/(app)/safety/compliance-documents'
import { companyScopeFilter } from '@/lib/tenancy'
import { apiError, authFailureResponse } from '../../_lib/respond'
import { loadCoiContext } from '../../_lib/coi-context'
import { coiNoticeFor } from '../../_lib/coi-notice'
import { recordUsageQuietly } from '../../_lib/record-usage'
import type { DocumentType } from '@/generated/prisma/client'

// POST /api/compliance/read — the front door for any readable Safety document.
//
// ── ONE UPLOAD, NOT TWO ───────────────────────────────────────────────────
//
// The flow the owner ruled on is classify-then-extract, and the obvious
// implementation is two routes and two round trips — which means sending the
// file twice, over a phone connection, for a document that may be eight
// megabytes. So the classification and the extraction happen in one request
// and the file crosses the wire once.
//
// ── CLASSIFICATION PROPOSES, NEVER CHOOSES ────────────────────────────────
//
//   * No `type` in the form: this classifies, and extracts with the proposed
//     contract when the proposal is actionable.
//   * A LOW-CONFIDENCE OR UNRECOGNISED proposal stops here and asks. No read
//     is spent on a guess — the owner's ruling, and the clause that keeps the
//     re-read rare enough to be an acceptable cost.
//   * A `type` IN the form is the person having overridden the verdict on the
//     confirm step. It is obeyed without classifying: they have looked at the
//     document and this system has not.
//
// THE VERDICT TRAVELS WITH THE ANSWER, always, so the confirm step can name
// the type it decided and offer to change it. That display is what makes the
// inference safe; without it this route would be guessing silently.
// ---------------------------------------------------------------------------

/** Stated here rather than inherited. Same judgement as the other read paths. */
export const MAX_COMPLIANCE_BYTES = 8 * 1024 * 1024

const KNOWN = new Set<string>(
  READABLE_COMPLIANCE_DOCUMENTS.map((row) => row.documentType),
)

export async function POST(request: Request) {
  let session
  try {
    session = await requireSession()
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    console.error('[zebra.compliance] read failed before the session', error)
    return apiError(500, 'unavailable', 'The document could not be read.')
  }

  if (!can(session, 'create', 'compliance')) {
    return apiError(403, 'forbidden', 'You may not file compliance records.')
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return apiError(400, 'invalid_body', 'Expected a file upload.')
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return apiError(400, 'no_file', 'No file arrived.')
  }
  if (!DOCUMENT_TYPES.has(file.type) && !IMAGE_TYPES.has(file.type)) {
    return apiError(415, 'wrong_type', 'That file is not a photo or a PDF.')
  }
  if (file.size > MAX_COMPLIANCE_BYTES) {
    return apiError(413, 'too_large', 'That file is too large to read.')
  }

  const stated = String(form.get('type') ?? '')
  // A STATED TYPE MUST STILL BE ONE WE CAN READ. It arrives from a browser,
  // and a type with no reader behind it would be a route this then tries to
  // call — the same reason `readClassification` re-checks the enum.
  if (stated !== '' && !KNOWN.has(stated)) {
    return apiError(400, 'unknown_type', 'That is not a document we can read.')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  const base64 = btoa(binary)

  // ── WHAT IS THIS? ───────────────────────────────────────────────────────
  let documentType: DocumentType
  let verdict: {
    type: DocumentType | null
    confidence: string
    because: string | null
    stated: boolean
  }

  if (stated !== '') {
    documentType = stated as DocumentType
    verdict = {
      type: documentType,
      confidence: 'high',
      because: null,
      stated: true,
    }
  } else {
    const classified = await classifyDocument({
      base64,
      mimeType: file.type,
      candidates: READABLE_COMPLIANCE_DOCUMENTS.map((row) => ({
        type: row.documentType,
        whatItLooksLike: row.looksLike,
      })),
    })
    if (!classified.ok) {
      await recordUsageQuietly(classified.cost, {
        documentType: 'OTHER',
        refused: classified.reason,
      })
      return NextResponse.json({
        verdict: null,
        proposal: null,
        notice:
          classified.reason === 'call_failed'
            ? 'safety.intake.failed'
            : 'safety.intake.unreadable',
      })
    }

    await recordUsageQuietly(classified.cost, { documentType: 'OTHER' })

    verdict = {
      type: classified.proposal.type,
      confidence: classified.proposal.confidence,
      because: classified.proposal.because,
      stated: false,
    }

    // NO READ IS SPENT ON A GUESS. The person is asked which document this is
    // and the answer comes back as a stated `type`.
    if (!classified.actionable) {
      return NextResponse.json({
        verdict,
        proposal: null,
        needsType: true,
        notice: null,
      })
    }
    documentType = classified.proposal.type!
  }

  // ── READ IT WITH THAT TYPE'S CONTRACT ───────────────────────────────────
  if (documentType === 'INSURANCE_CERT') {
    // NO `companyId` IS ASKED FOR, AND THAT IS THE CHANGE OF 2026-09-09. This
    // branch used to return `needsCompany` before spending a read, on the
    // belief that a certificate belongs to a carrier somebody names. The first
    // real certificate insures an owner-operator's entity against two of our
    // tractors — so the DOCUMENT places it, and `decideCoiSubject` is the rule.
    const outcome = await readCoi({ base64, mimeType: file.type })
    if (!outcome.ok) {
      await recordUsageQuietly(outcome.cost, {
        documentType: 'INSURANCE_CERT',
        refused: outcome.reason,
      })
      return NextResponse.json({
        verdict,
        proposal: null,
        notice: coiNoticeFor(outcome.reason),
      })
    }
    await recordUsageQuietly(outcome.cost, { documentType: 'INSURANCE_CERT' })

    const proposal = coiProposal(
      outcome.fields,
      await loadCoiContext(outcome.fields),
    )
    return NextResponse.json({
      verdict,
      proposal,
      carrier: proposal.carrier,
      fields: outcome.fields,
      cost: costBlock(outcome.cost),
      notice: null,
    })
  }

  // INSPECTION_REPORT — the annual DOT inspection (TMS §7.8, v11.47). Each
  // field read or unreadable; only a reading with nothing usable is refused.
  if (documentType === 'INSPECTION_REPORT') {
    const outcome = await readAnnualInspection({ base64, mimeType: file.type })
    if (!outcome.ok) {
      await recordUsageQuietly(outcome.cost, {
        documentType: 'INSPECTION_REPORT',
        refused: outcome.reason,
      })
      return NextResponse.json({
        verdict,
        proposal: null,
        notice:
          outcome.reason === 'call_failed'
            ? 'safety.intake.failed'
            : 'safety.inspection.unreadable',
      })
    }
    await recordUsageQuietly(outcome.cost, {
      documentType: 'INSPECTION_REPORT',
    })

    const trucks = await withCurrentOrg('read', 'truck', async (tx, ctx) =>
      tx.truck.findMany({
        where: { ...companyScopeFilter(ctx.companyScopes), deletedAt: null },
        orderBy: { unitNumber: 'asc' },
        take: 500,
        select: { id: true, unitNumber: true, vin: true },
      }),
    )
    return NextResponse.json({
      verdict,
      inspection: {
        verdicts: outcome.verdicts,
        prefill: inspectionPrefill(outcome.verdicts),
        match: matchTruck(outcome.verdicts, trucks),
        trucks,
      },
      proposal: null,
      cost: costBlock(outcome.cost),
      notice: null,
    })
  }

  // REGISTRATION — the cab card (TMS §7.8, v11.57). The §6.5 reader, each
  // field read or unreadable; the truck proposed by VIN, then unit number,
  // then plate, and confirmed on the screen. It never writes.
  if (documentType === 'REGISTRATION') {
    const outcome = await readRegistration({ base64, mimeType: file.type })
    if (!outcome.ok) {
      await recordUsageQuietly(outcome.cost, {
        documentType: 'REGISTRATION',
        refused: outcome.reason,
      })
      return NextResponse.json({
        verdict,
        proposal: null,
        notice:
          outcome.reason === 'call_failed'
            ? 'safety.intake.failed'
            : 'safety.registration.unreadable',
      })
    }
    await recordUsageQuietly(outcome.cost, { documentType: 'REGISTRATION' })

    // TRUCKS AND TRAILERS, ONE TRANSACTION (v11.58): the match runs over
    // both. Trailers only where this role may read them.
    const readsTrailers = can(session, 'read', 'trailer')
    const units = await withCurrentOrg('read', 'truck', async (tx, ctx) => {
      const where = {
        ...companyScopeFilter(ctx.companyScopes),
        deletedAt: null,
      }
      const select = {
        id: true,
        unitNumber: true,
        vin: true,
        plate: true,
        plateState: true,
      } as const
      const trucks = await tx.truck.findMany({
        where,
        orderBy: { unitNumber: 'asc' },
        take: 500,
        select,
      })
      const trailers = readsTrailers
        ? await tx.trailer.findMany({
            where,
            orderBy: { unitNumber: 'asc' },
            take: 500,
            select,
          })
        : []
      return [
        ...trucks.map((row) => ({ kind: 'truck' as const, ...row })),
        ...trailers.map((row) => ({ kind: 'trailer' as const, ...row })),
      ] satisfies RegistrationUnitCandidate[]
    })
    return NextResponse.json({
      verdict,
      registration: {
        verdicts: outcome.verdicts,
        prefill: outcome.prefill,
        match: matchRegistrationUnit(outcome.verdicts, units),
        units,
        addForm: addFormFor(outcome.verdicts),
      },
      proposal: null,
      cost: costBlock(outcome.cost),
      notice: null,
    })
  }

  // MEDICAL_CARD — the path that identifies its own subject.
  const outcome = await readMedicalCert({ base64, mimeType: file.type })
  if (!outcome.ok) {
    await recordUsageQuietly(outcome.cost, {
      documentType: 'MEDICAL_CARD',
      refused: outcome.reason,
    })
    return NextResponse.json({
      verdict,
      proposal: null,
      notice:
        outcome.reason === 'call_failed'
          ? 'drivers.med.failed'
          : outcome.reason === 'expiry_before_issue' ||
              outcome.reason === 'implausible_validity'
            ? 'drivers.med.contradictory'
            : 'drivers.med.unreadable',
    })
  }
  await recordUsageQuietly(outcome.cost, { documentType: 'MEDICAL_CARD' })

  const match = matchDriverByName(
    outcome.fields.driverName?.value ?? null,
    await withCurrentOrg('read', 'driver', async (tx, ctx) =>
      tx.driver.findMany({
        where: { ...companyScopeFilter(ctx.companyScopes), deletedAt: null },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: 500,
        select: { id: true, firstName: true, lastName: true },
      }),
    ),
  )
  const against =
    match.kind === 'one'
      ? `${match.driver.firstName} ${match.driver.lastName}`
      : ''
  const proposal = medicalCertProposal(outcome.fields, against)

  return NextResponse.json({
    verdict,
    proposal,
    match,
    fields: outcome.fields,
    cost: costBlock(outcome.cost),
    notice: proposal ? null : 'drivers.med.unreadable',
  })
}

/** The same block every read path puts on the wire. */
function costBlock(cost: {
  milliCents: number
  model: string
  usage: {
    inputTokens: number
    outputTokens: number
    cacheWriteTokens?: number
    cacheReadTokens?: number
  }
  fellBackFrom?: { model: string; reason: string; status?: number }
}) {
  return {
    milliCents: cost.milliCents,
    display: formatCostMilliCents(cost.milliCents),
    inputTokens: cost.usage.inputTokens,
    outputTokens: cost.usage.outputTokens,
    cacheWriteTokens: cost.usage.cacheWriteTokens ?? 0,
    cacheReadTokens: cost.usage.cacheReadTokens ?? 0,
    model: cost.model,
    ...(cost.fellBackFrom ? { fellBackFrom: cost.fellBackFrom } : {}),
  }
}

import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-context'
import { can } from '@/lib/permissions'
import { DOCUMENT_TYPES, IMAGE_TYPES, formatCostMilliCents } from '@/lib/claude'
import { coiProposal, readCoi } from '@/lib/coi'
import { apiError, authFailureResponse } from '../../_lib/respond'
import { loadCoiContext } from '../../_lib/coi-context'
import { coiNoticeFor } from '../../_lib/coi-notice'
import { recordUsageQuietly } from '../../_lib/record-usage'

// POST /api/coi/read — read a certificate of insurance.
//
// ── THE SAME SHAPE AS /api/med/read, AND ONE REAL DIFFERENCE ──────────────
//
// A route handler rather than a server action, multipart rather than base64,
// and the size limit stated on this path: all three for the reasons written
// out in `/api/cdl/read/route.ts`.
//
// ── IT NO LONGER ASKS WHOSE CERTIFICATE THIS IS ──────────────────────────
//
// This route used to require a `companyId` before it would read anything, on
// the reasoning that a certificate belongs to a carrier and the carrier is
// stated by whoever is filing it. The first real certificate retired that: its
// insured is CHAPAN INC, an owner-operator's entity, and no answer to "which
// of your six carriers is this for" would have been true.
//
// So the DOCUMENT decides, and `decideCoiSubject` is the rule — an authority
// match files at the company, a VIN match files per truck, and neither asks.
// The subject and the reason travel to the confirm step in words, and a person
// can override both.
//
// NOTHING IS PERSISTED. The certificate is read, matched and dropped. Filing
// it is a separate, confirmed action — a compliance row created straight from
// a read is a compliance record nobody looked at.
// ---------------------------------------------------------------------------

/** Stated here rather than inherited. Same judgement as the other read paths. */
export const MAX_COI_BYTES = 8 * 1024 * 1024

export async function POST(request: Request) {
  let session
  try {
    session = await requireSession()
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    console.error('[zebra.coi] read failed before the session resolved', error)
    return apiError(500, 'unavailable', 'The certificate could not be read.')
  }

  // THE PERMISSION THAT MATCHES WHAT THIS LEADS TO. Reading a certificate to
  // propose a compliance row somebody may not create is work done for a
  // refusal, and `compliance:create` is what filing it needs.
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
  // Checked before the bytes are read, for the reason the CDL path records: a
  // limit is only a limit where nothing rejects first.
  if (file.size > MAX_COI_BYTES) {
    return apiError(413, 'too_large', 'That file is too large to read.')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }

  const outcome = await readCoi({
    base64: btoa(binary),
    mimeType: file.type,
  })

  if (!outcome.ok) {
    // A REFUSED READ IS A BILLED READ — the engine answered and the rules
    // threw the answer away.
    await recordUsageQuietly(outcome.cost, {
      documentType: 'INSURANCE_CERT',
      refused: outcome.reason,
    })
    return NextResponse.json({
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
    proposal,
    // THE CARRIER CHECK TRAVELS WITH THE PROPOSAL and is displayed, never
    // acted on. An insurer writes RAM HAULAGE LLC where this system holds RAM
    // Haulage; a person reads the sentence and decides. It is null on the
    // per-truck branch, where a different insured is the expected case.
    carrier: proposal.carrier,
    fields: outcome.fields,
    cost: {
      milliCents: outcome.cost.milliCents,
      display: formatCostMilliCents(outcome.cost.milliCents),
      inputTokens: outcome.cost.usage.inputTokens,
      outputTokens: outcome.cost.usage.outputTokens,
      cacheWriteTokens: outcome.cost.usage.cacheWriteTokens ?? 0,
      cacheReadTokens: outcome.cost.usage.cacheReadTokens ?? 0,
      model: outcome.cost.model,
      ...(outcome.cost.fellBackFrom
        ? { fellBackFrom: outcome.cost.fellBackFrom }
        : {}),
    },
    notice: null,
  })
}

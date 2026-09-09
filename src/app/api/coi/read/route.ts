import { NextResponse } from 'next/server'
import { requireSession, withCurrentOrg } from '@/lib/auth-context'
import { can } from '@/lib/permissions'
import { DOCUMENT_TYPES, IMAGE_TYPES, formatCostMilliCents } from '@/lib/claude'
import { coiProposal, readCoi } from '@/lib/coi'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { apiError, authFailureResponse } from '../../_lib/respond'
import { recordUsageQuietly } from '../../_lib/record-usage'

// POST /api/coi/read — read a certificate of insurance for one carrier.
//
// ── THE SAME SHAPE AS /api/med/read, AND ONE REAL DIFFERENCE ──────────────
//
// A route handler rather than a server action, multipart rather than base64,
// and the size limit stated on this path: all three for the reasons written
// out in `/api/cdl/read/route.ts`.
//
// WHAT DIFFERS IS THE SUBJECT. A medical certificate belongs to a person the
// reader has to identify; a certificate of insurance belongs to the CARRIER,
// and the carrier is stated by whoever is filing it. So this route takes a
// `companyId` and there is no matching to do — only CHECKING, which never
// decides anything: `checkCarrier` returns sentences for the confirm step.
//
// THE COMPANY IS RESOLVED THROUGH THE TENANT SCOPE, NOT TRUSTED. The id
// arrives from the browser. Reading it inside `withCurrentOrg` means
// row-level security decides whether this caller may see that carrier at all,
// and one from another organization comes back as not found — the same answer
// as one that does not exist, which is the correct answer to give.
//
// NOTHING IS PERSISTED. The certificate is read, checked and dropped. Filing
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

  const companyId =
    typeof form.get('companyId') === 'string'
      ? String(form.get('companyId'))
      : ''
  if (companyId === '') {
    // WHOSE POLICY IS NOT A GUESS. A certificate names an insured and this
    // system holds several carriers; which one it is filed against is stated
    // by the person filing it, and `checkCarrier` tells them when the document
    // disagrees.
    return apiError(400, 'no_company', 'Say which carrier this is for.')
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

  const company = await withCurrentOrg('read', 'company', async (tx, ctx) =>
    tx.company.findFirst({
      where: {
        id: companyId,
        ...companyIdScopeFilter(ctx.companyScopes),
      },
      select: { id: true, name: true, mcNumber: true, dotNumber: true },
    }),
  )
  if (!company) {
    return apiError(404, 'no_company', 'That carrier was not found.')
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

    // THE REFUSALS SORT INTO THE SAME THREE GROUPS the other readers use, and
    // for the same reason: a dispatcher told the wrong one wastes a trip.
    //
    //   TAKE A BETTER PHOTOGRAPH — the certificate was reached and could not
    //   be read from.
    //   THE DOCUMENT CONTRADICTS ITSELF — an expiry before the effective date,
    //   or a term no policy runs for. A second photograph will not fix either.
    //   TRY AGAIN — the call failed. Ours or the network's.
    const notice =
      outcome.reason === 'call_failed'
        ? 'safety.coi.failed'
        : outcome.reason === 'expiry_before_effective' ||
            outcome.reason === 'implausible_term'
          ? 'safety.coi.contradictory'
          : 'safety.coi.unreadable'
    return NextResponse.json({ proposal: null, notice })
  }

  await recordUsageQuietly(outcome.cost, { documentType: 'INSURANCE_CERT' })

  const proposal = coiProposal(outcome.fields, {
    name: company.name,
    mcNumber: company.mcNumber,
    dotNumber: company.dotNumber,
  })
  if (!proposal) {
    // Unreachable after `refuseCoi` passes — it checks the same conversion —
    // and handled rather than asserted, because "cannot happen" is a claim
    // with a history in this codebase.
    return NextResponse.json({
      proposal: null,
      notice: 'safety.coi.unreadable',
    })
  }

  return NextResponse.json({
    proposal,
    // THE CARRIER CHECK TRAVELS WITH THE PROPOSAL and is displayed, never
    // acted on. An insurer writes RAM HAULAGE LLC where this system holds RAM
    // Haulage; a person reads the sentence and decides.
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

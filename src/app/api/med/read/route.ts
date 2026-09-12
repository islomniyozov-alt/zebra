import { NextResponse } from 'next/server'
import { requireSession, withCurrentOrg } from '@/lib/auth-context'
import { can } from '@/lib/permissions'
import {
  ALLOWED_MODELS,
  DOCUMENT_TYPES,
  IMAGE_TYPES,
  formatCostMilliCents,
  isAllowedModel,
} from '@/lib/claude'
import {
  matchDriverByName,
  medicalCertProposal,
  readMedicalCert,
} from '@/lib/med-cert'
import { companyScopeFilter } from '@/lib/tenancy'
import { apiError, authFailureResponse } from '../../_lib/respond'
import { recordUsageQuietly } from '../../_lib/record-usage'

// POST /api/med/read — read a medical certificate, and say whose it is.
//
// ── THE SAME SHAPE AS /api/cdl/read, AND ONE REAL DIFFERENCE ──────────────
//
// A route handler rather than a server action, multipart rather than base64,
// and the size limit stated on this path: all three for the reasons written
// out in `/api/cdl/read/route.ts` — Next's 1MB default rejected phone photos,
// base64's 4/3 inflation was pure cost, and raising `bodySizeLimit` would have
// been a global change to solve one upload's problem.
//
// WHAT DIFFERS IS THE SUBJECT. The CDL is read before a driver exists and
// identifies nobody. A medical certificate becomes a row against a PERSON, so
// this route has to end up with one — and it gets there two ways.
//
// STATED, when a compliance row sent its own subject: resolved through the
// tenant-scoped client, because an id from a browser is a claim rather than a
// permission, and a driver in another organization must come back as not found.
//
// PROPOSED, when the certificate came through the front door and nothing
// stated it: matched against the tenant-scoped roster on an EXACT set of name
// words, with none and several both answering "ask". Never nearest-match — the
// roster holds near-duplicates and rows that are not people, and a nearest
// match over it eventually files a certificate against a company.
//
// NOTHING IS PERSISTED. The certificate is read, compared and dropped. Filing
// it is a separate, confirmed action — see `fileMedicalCert`. A ComplianceItem
// created straight from a read is a compliance record nobody looked at.
// ---------------------------------------------------------------------------

/** Stated here rather than inherited. Same judgement as the CDL path. */
export const MAX_MEDICAL_CERT_BYTES = 8 * 1024 * 1024

export async function POST(request: Request) {
  let session
  try {
    session = await requireSession()
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    console.error('[zebra.med] read failed before the session resolved', error)
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

  // ── THE DRIVER MAY OR MAY NOT BE KNOWN YET ─────────────────────────────
  //
  // From a compliance row it is: the row states its subject and sends it. From
  // the front door it is not — a certificate is dropped before anybody has
  // been named — and the printed name proposes one below.
  //
  // OPTIONAL RATHER THAN TWO ROUTES, because everything after this point is
  // identical and a second handler would be a second place to change the size
  // limit, the permission and the refusal mapping.
  const driverId =
    typeof form.get('driverId') === 'string' ? String(form.get('driverId')) : ''

  const file = form.get('file')
  if (!(file instanceof File)) {
    return apiError(400, 'no_file', 'No file arrived.')
  }
  if (!DOCUMENT_TYPES.has(file.type) && !IMAGE_TYPES.has(file.type)) {
    return apiError(415, 'wrong_type', 'That file is not a photo or a PDF.')
  }
  // Checked before the bytes are read, for the reason the CDL path records: a
  // limit is only a limit where nothing rejects first.
  if (file.size > MAX_MEDICAL_CERT_BYTES) {
    return apiError(413, 'too_large', 'That file is too large to read.')
  }

  // ── THE DRIVER IS RESOLVED THROUGH THE TENANT SCOPE, NOT TRUSTED ────────
  //
  // The id arrives from the browser. Reading the driver inside
  // `withCurrentOrg` means row-level security decides whether this caller can
  // see them: a driver in another organization comes back as not found, which
  // is the same answer as one that does not exist — and that is the correct
  // answer to give, because distinguishing them would confirm the row is
  // there.
  const stated = driverId
    ? await withCurrentOrg('read', 'driver', async (tx) =>
        tx.driver.findFirst({
          where: { id: driverId, deletedAt: null },
          select: { id: true, firstName: true, lastName: true },
        }),
      )
    : null
  if (driverId && !stated) {
    return apiError(404, 'no_driver', 'That driver was not found.')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }

  // THE ACCURACY RUN'S ONE KNOB, defaulting to what ships.
  //
  // Allowlisted against `ALLOWED_MODELS` rather than passed through: a typo
  // must be a 400 here, not a 404 from somebody's API an hour later inside a
  // column of a comparison table. Gated by the permission this route already
  // asks for — choosing a model is choosing what to spend, and the reader is
  // already spending it.
  //
  // ABSENT EVERYWHERE ELSE. The drop zone never sends one, so the configured
  // provider decides for every real read.
  const requestedModel = form.get('model')
  if (typeof requestedModel === 'string' && !isAllowedModel(requestedModel)) {
    return apiError(
      400,
      'unknown_model',
      `${requestedModel} is not an allowed model. Allowed: ${ALLOWED_MODELS.join(', ')}.`,
    )
  }
  const named =
    typeof requestedModel === 'string' ? { model: requestedModel } : {}

  const outcome = await readMedicalCert({
    base64: btoa(binary),
    mimeType: file.type,
    ...named,
  })

  if (!outcome.ok) {
    // THE REFUSALS SORT INTO THE SAME THREE GROUPS AS THE CDL'S, and for the
    // same reason: a dispatcher told the wrong one makes a wasted trip.
    //
    //   TAKE A BETTER PHOTOGRAPH — the certificate was reached and could not
    //   be read from: a low-confidence expiry, a date that will not convert.
    //   THE CARD CONTRADICTS ITSELF — an expiry before the examination, or a
    //   validity period no certificate can have. A second photograph of the
    //   same card will not fix either.
    //   TRY AGAIN — the call failed. Ours or the network's.
    // BILLED EVEN THOUGH IT WAS REFUSED — and the medical card refuses more
    // often than the CDL by design, since an unreadable expiry is a refusal
    // rather than a guess. Dropping these rows would understate this document
    // type's cost by more than any other in the system.
    await recordUsageQuietly(outcome.cost, {
      documentType: 'MEDICAL_CARD',
      refused: outcome.reason,
    })

    const notice =
      outcome.reason === 'call_failed'
        ? 'drivers.med.failed'
        : outcome.reason === 'expiry_before_issue' ||
            outcome.reason === 'implausible_validity'
          ? 'drivers.med.contradictory'
          : 'drivers.med.unreadable'
    return NextResponse.json({ proposal: null, notice })
  }

  await recordUsageQuietly(outcome.cost, { documentType: 'MEDICAL_CARD' })

  // ── WHO IT IS FOR: STATED, OR PROPOSED FROM THE PRINTED NAME ───────────
  //
  // MATCHED SERVER-SIDE, AGAINST THE TENANT-SCOPED ROSTER. Doing it in the
  // browser would mean shipping every driver's name to it and trusting the
  // answer that came back; here row-level security decides which drivers exist
  // to be matched against at all.
  //
  // EXACT SET OF NAME WORDS, and none and several both mean ask — see
  // `matchDriverByName` for why nearest-match is refused over a roster holding
  // `TJK logistic` and `7 Star`.
  const match = stated
    ? { kind: 'one', driver: stated }
    : matchDriverByName(
        outcome.fields.driverName?.value ?? null,
        await withCurrentOrg('read', 'driver', async (tx, session) =>
          tx.driver.findMany({
            where: {
              ...companyScopeFilter(session.companyScopes),
              deletedAt: null,
            },
            orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
            take: 500,
            select: { id: true, firstName: true, lastName: true },
          }),
        ),
      )

  // The name comparison is against the driver we are PROPOSING, when there is
  // one. With nobody proposed there is nothing to compare and the warning is
  // withheld rather than invented.
  const against =
    match.kind === 'one'
      ? `${match.driver.firstName} ${match.driver.lastName}`
      : ''
  const proposal = medicalCertProposal(outcome.fields, against)
  if (!proposal) {
    // Unreachable after `refuseMedicalCert` passes — it checks the same
    // conversion — and handled rather than asserted, because "cannot happen"
    // is a claim with a history in this codebase.
    return NextResponse.json({
      proposal: null,
      notice: 'drivers.med.unreadable',
    })
  }

  // THE PARSED FIELDS TRAVEL BESIDE THE PROPOSAL, WITH THEIR CONFIDENCES —
  // the same arrangement the CDL route makes, and what lets an accuracy run
  // grade per field. This is the document the caller just uploaded, returned
  // to the caller who uploaded it, and nothing is persisted either way.
  return NextResponse.json({
    proposal,
    // WHO TO FILE IT AGAINST, AND HOW SURE. `one` is a proposal a person still
    // confirms; `none` and `many` send the caller to a picker with these
    // values already in hand, so nothing is uploaded twice.
    match,
    fields: outcome.fields,
    // WHAT THE READ COST, ON THE WIRE — the same block the rate-con route has
    // carried since Phase 5, now on this one too. `doc-variance.mjs` and
    // `doc-accuracy.mjs` dump the whole response body, so putting it here is
    // what makes a variance run measure price as well as stability, with no
    // change to either instrument.
    cost: {
      milliCents: outcome.cost.milliCents,
      display: formatCostMilliCents(outcome.cost.milliCents),
      inputTokens: outcome.cost.usage.inputTokens,
      outputTokens: outcome.cost.usage.outputTokens,
      cacheWriteTokens: outcome.cost.usage.cacheWriteTokens ?? 0,
      cacheReadTokens: outcome.cost.usage.cacheReadTokens ?? 0,
      model: outcome.cost.model,
      // The swap, on the wire as well as in the ledger — so a measurement run
      // counts fallbacks instead of silently reporting the wrong engine.
      ...(outcome.cost.fellBackFrom
        ? { fellBackFrom: outcome.cost.fellBackFrom }
        : {}),
    },
    notice: null,
  })
}

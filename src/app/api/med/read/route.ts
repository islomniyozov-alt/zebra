import { NextResponse } from 'next/server'
import { requireSession, withCurrentOrg } from '@/lib/auth-context'
import { can } from '@/lib/permissions'
import { DOCUMENT_TYPES, IMAGE_TYPES } from '@/lib/claude'
import { medicalCertProposal, readMedicalCert } from '@/lib/med-cert'
import { apiError, authFailureResponse } from '../../_lib/respond'

// POST /api/med/read — read a medical certificate FOR A DRIVER WHO EXISTS.
//
// ── THE SAME SHAPE AS /api/cdl/read, AND ONE REAL DIFFERENCE ──────────────
//
// A route handler rather than a server action, multipart rather than base64,
// and the size limit stated on this path: all three for the reasons written
// out in `/api/cdl/read/route.ts` — Next's 1MB default rejected phone photos,
// base64's 4/3 inflation was pure cost, and raising `bodySizeLimit` would have
// been a global change to solve one upload's problem.
//
// WHAT DIFFERS IS THAT THIS ONE NAMES A DRIVER. The CDL is read before a
// driver exists; a medical certificate arrives on somebody's page. So this
// handler must prove the caller may see that driver before it reads anything,
// and it must resolve the driver's name through the tenant-scoped client — an
// id that came from the browser is a claim, not a permission.
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

  const driverId = form.get('driverId')
  if (typeof driverId !== 'string' || driverId === '') {
    return apiError(400, 'no_driver', 'No driver was named.')
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
  const driver = await withCurrentOrg('read', 'driver', async (tx) =>
    tx.driver.findFirst({
      where: { id: driverId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    }),
  )
  if (!driver) {
    return apiError(404, 'no_driver', 'That driver was not found.')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }

  const outcome = await readMedicalCert({
    base64: btoa(binary),
    mimeType: file.type,
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
    const notice =
      outcome.reason === 'call_failed'
        ? 'drivers.med.failed'
        : outcome.reason === 'expiry_before_issue' ||
            outcome.reason === 'implausible_validity'
          ? 'drivers.med.contradictory'
          : 'drivers.med.unreadable'
    return NextResponse.json({ proposal: null, notice })
  }

  const proposal = medicalCertProposal(
    outcome.fields,
    `${driver.firstName} ${driver.lastName}`,
  )
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
    fields: outcome.fields,
    notice: null,
  })
}

'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { recordRenewal } from '@/lib/compliance'
import { getLocaleContext } from '@/lib/locale'
import type { FileCoiState } from './coi-state'

// ---------------------------------------------------------------------------
// FILING A CONFIRMED CERTIFICATE OF INSURANCE.
//
// ── ONE CERTIFICATE, UP TO TWO ROWS, AND THE FORM SAYS WHICH ─────────────
//
// An ACORD certificate usually evidences auto liability AND cargo. They are
// separate obligations with separate limits that a carrier can hold one of and
// not the other, so they are separate `ComplianceItem` rows — and which ones
// exist comes off the FORM rather than off the read, because the person on the
// confirm step may have unticked a coverage the document mentions in passing.
//
// ── COMPANY-LEVEL, WHICH IS THE WHOLE POINT ─────────────────────────────
//
// `subject: 'company'` writes a row with a carrier and no asset link. Trucks
// inherit it — see `FLEET_COMPLIANCE_TYPES` — rather than each holding a copy,
// which is the arrangement 25 duplicated production rows earned.
//
// NOT TRUSTED FOR BEING ON THE FORM. `recordRenewal` resolves the company
// itself and returns `subject_not_found` for anything this tenant cannot see,
// so a forged id lands on nothing.
//
// DOMAIN LOGIC IS NOT HERE. This reads the form, calls one function per
// coverage, and revalidates — the standing rule about `'use server'` bodies.
// ---------------------------------------------------------------------------

/** `2027-03-04` from a date input, as a UTC day. Never `new Date(text)`. */
function utcDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const at = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  )
  return Number.isNaN(at.getTime()) ? null : at
}

export async function fileCoiAction(
  _previous: FileCoiState,
  formData: FormData,
): Promise<FileCoiState> {
  const { t } = await getLocaleContext()

  const companyId = String(formData.get('companyId') ?? '').trim()
  if (!companyId) {
    return { error: t('safety.coi.noCompany'), filedRecordIds: [] }
  }

  const expiresAt = utcDay(String(formData.get('expiresAt') ?? ''))
  if (!expiresAt) {
    return { error: t('safety.coi.noExpiry'), filedRecordIds: [] }
  }
  const effectiveRaw = String(formData.get('effectiveAt') ?? '')
  const issuedAt = effectiveRaw ? utcDay(effectiveRaw) : null

  const policyNumber = String(formData.get('policyNumber') ?? '').trim()
  const insurer = String(formData.get('insurer') ?? '').trim()

  // WHICH COVERAGES, FROM THE FORM. A limit is recorded as a note rather than
  // a column: `ComplianceItem` has no money field, and adding one for a
  // printed limit would be a column null on every other row.
  const coverages: {
    type: 'INSURANCE_LIABILITY' | 'INSURANCE_CARGO'
    limit: string
  }[] = []
  if (formData.get('liability') === 'on') {
    coverages.push({
      type: 'INSURANCE_LIABILITY',
      limit: String(formData.get('liabilityLimit') ?? '').trim(),
    })
  }
  if (formData.get('cargo') === 'on') {
    coverages.push({
      type: 'INSURANCE_CARGO',
      limit: String(formData.get('cargoLimit') ?? '').trim(),
    })
  }
  if (coverages.length === 0) {
    return { error: t('safety.coi.noCoverage'), filedRecordIds: [] }
  }

  const filed: string[] = []
  for (const coverage of coverages) {
    const result = await withCurrentOrg('create', 'compliance', async (tx) =>
      recordRenewal(tx, {
        subject: 'company',
        subjectId: companyId,
        type: coverage.type,
        issuedAt,
        expiresAt,
        // THE POLICY NUMBER IDENTIFIES THE POLICY and the insurer is who
        // carries the risk. Both on the row, because a certificate nobody can
        // trace back to a policy is worth a second look.
        identifier: policyNumber || null,
        issuer: insurer || null,
        notes: coverage.limit ? `Limit as printed: ${coverage.limit}` : null,
      }),
    )

    if (!result.ok) {
      // PARTIAL SUCCESS IS REPORTED, NOT ROLLED BACK. If liability filed and
      // cargo collided with an existing row, the liability row is real and
      // deleting it would be this action inventing a failure. The message says
      // what landed.
      const message =
        result.reason === 'duplicate'
          ? t('safety.coi.duplicate')
          : result.reason === 'bad_dates'
            ? t('safety.coi.badDates')
            : result.reason === 'subject_not_found'
              ? t('ref.error.notFound')
              : t('safety.coi.failed')
      return { error: message, filedRecordIds: filed }
    }
    filed.push(result.recordId)
  }

  revalidatePath('/safety')
  revalidatePath('/companies')
  return { error: null, filedRecordIds: filed }
}

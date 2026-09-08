'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { recordRenewal } from '@/lib/compliance'
import type { FileMedicalCertState } from './med-state'

// ---------------------------------------------------------------------------
// FILING A MEDICAL CERTIFICATE THAT SOMEBODY HAS CONFIRMED.
//
// ── THIS IS THE ONLY PATH THAT WRITES, AND THE READ NEVER TOUCHES IT ──────
//
// `/api/med/read` reads, compares and returns a proposal. It creates nothing.
// A ComplianceItem decides whether a person may legally drive, and one that
// appeared because a model read a photograph — with nobody having looked at
// the date — is a compliance record this system cannot vouch for. So the row
// is written here, by a click, on a date a human saw on screen.
//
// A THIN ACTION, PER AGENTS.md. It reads the form, calls one function, and
// revalidates. The rule it depends on — always a create, never an update, so
// last year's certificate survives as the evidence the driver was legal then —
// lives in `recordRenewal`, where a test can reach it.
//
// THE EXPIRY IS RE-READ FROM THE FORM, NOT CARRIED FROM THE READ. What gets
// filed is what the screen showed and the person agreed to. If the two ever
// disagreed, the value somebody looked at is the one that should win.
// ---------------------------------------------------------------------------

/** `yyyy-mm-dd` to a UTC midnight Date. No timezone anywhere in the trip. */
function utcDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  )
  return Number.isNaN(date.getTime()) ? null : date
}

export async function fileMedicalCertAction(
  _previous: FileMedicalCertState,
  formData: FormData,
): Promise<FileMedicalCertState> {
  const { t } = await getLocaleContext()

  // ── THE DRIVER IS PART OF WHAT WAS CONFIRMED, SO IT COMES OFF THE FORM ──
  //
  // It used to be bound to the action at render, back when the page stated the
  // subject and it could not change. The certificate is read BEFORE a driver
  // is settled now — proposed from the printed name, or picked when the name
  // matches none or several — so the driver is one of the values a person
  // agrees to, and it travels with the others.
  //
  // NOT TRUSTED FOR BEING ON THE FORM. `recordRenewal` resolves the subject
  // itself and returns `subject_not_found` for anything this tenant cannot
  // see, so a forged id lands on nothing.
  const driverId = String(formData.get('driverId') ?? '').trim()
  if (!driverId) {
    return { error: t('drivers.med.noDriver'), filedRecordId: null }
  }

  const expiresAt = utcDay(String(formData.get('expiresAt') ?? ''))
  if (!expiresAt) {
    return { error: t('drivers.med.noExpiry'), filedRecordId: null }
  }
  const issuedRaw = String(formData.get('issuedAt') ?? '')
  const issuedAt = issuedRaw ? utcDay(issuedRaw) : null

  const examinerName = String(formData.get('examinerName') ?? '').trim()
  const registry = String(formData.get('examinerRegistryNumber') ?? '').trim()

  const result = await withCurrentOrg('create', 'compliance', async (tx) =>
    recordRenewal(tx, {
      subject: 'driver',
      subjectId: driverId,
      type: 'MEDICAL_CARD',
      issuedAt,
      expiresAt,
      // THE REGISTRY NUMBER IDENTIFIES THE EXAMINER against a federal list;
      // the name is who signed it. Both are on the row because a certificate
      // nobody can trace back to an examiner is worth a second look.
      identifier: registry || null,
      issuer: examinerName || null,
    }),
  )

  if (!result.ok) {
    const message =
      result.reason === 'duplicate'
        ? t('drivers.med.duplicate')
        : result.reason === 'bad_dates'
          ? t('drivers.med.badDates')
          : result.reason === 'subject_not_found'
            ? t('ref.error.notFound')
            : t('drivers.med.failed')
    return { error: message, filedRecordId: null }
  }

  // BOTH SCREENS. The queue is where this is filed from, and the driver's own
  // page still SHOWS their compliance rows even though it no longer uploads.
  revalidatePath('/safety')
  revalidatePath(`/drivers/${driverId}`)
  return { error: null, filedRecordId: result.recordId }
}

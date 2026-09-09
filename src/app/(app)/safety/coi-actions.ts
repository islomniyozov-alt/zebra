'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { fileCoi, type CoiCoverageToFile } from '@/lib/coi-filing'
import { getLocaleContext } from '@/lib/locale'
import type { ComplianceType } from '@/generated/prisma/client'
import type { FileCoiState } from './coi-state'

// ---------------------------------------------------------------------------
// FILING A CONFIRMED CERTIFICATE OF INSURANCE.
//
// ── THIS READS THE FORM, CALLS ONE FUNCTION, AND REVALIDATES ─────────────
//
// The standing rule about `'use server'` bodies, and the rule this file used
// to bend: it held the coverage table, the note format and the subject choice
// inline. All three now live in `src/lib/coi-filing.ts`, where a test can
// reach them with a transaction and nothing else.
//
// ── WHICH COVERAGES COMES OFF THE FORM, NOT OFF THE READ ─────────────────
//
// The person on the confirm step may have unticked a coverage, or changed what
// obligation a printed row files as — "Non-Trucking Liability" has no
// obligation of its own in this system and the reader will not guess one. So
// every value here is what was on screen when somebody clicked, which is the
// only version anybody agreed to.
//
// NOT TRUSTED FOR BEING ON THE FORM. `recordRenewal` resolves every subject
// itself and returns `subject_not_found` for anything this tenant cannot see,
// so a forged id lands on nothing.
// ---------------------------------------------------------------------------

/** `2027-03-04` from a hidden field, as a UTC day. Never `new Date(text)`. */
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
  const nothing = { filedRecordIds: [], vinsFilled: [] }

  const companyId = String(formData.get('companyId') ?? '').trim()
  const truckIds = formData
    .getAll('truckId')
    .map((value) => String(value).trim())
    .filter((value) => value !== '')

  if (companyId === '' && truckIds.length === 0) {
    return { error: t('safety.coi.noSubject'), ...nothing }
  }

  // ── THE COVERAGES, ONE INDEXED GROUP PER TICKED ROW ────────────────────
  const coverages: CoiCoverageToFile[] = []
  for (const raw of formData.getAll('coverage')) {
    const index = String(raw)
    const expiresAt = utcDay(String(formData.get(`expiresAt.${index}`) ?? ''))
    if (!expiresAt) return { error: t('safety.coi.noExpiry'), ...nothing }

    const type = String(formData.get(`type.${index}`) ?? '').trim()
    if (type === '') return { error: t('safety.coi.noType'), ...nothing }

    const effectiveRaw = String(formData.get(`effectiveAt.${index}`) ?? '')
    coverages.push({
      type: type as ComplianceType,
      expiresAt,
      effectiveAt: effectiveRaw ? utcDay(effectiveRaw) : null,
      identifier:
        String(formData.get(`identifier.${index}`) ?? '').trim() || null,
      issuer: String(formData.get(`issuer.${index}`) ?? '').trim() || null,
      printedType:
        String(formData.get(`printedType.${index}`) ?? '').trim() || null,
      limit: String(formData.get(`limit.${index}`) ?? '').trim() || null,
    })
  }
  if (coverages.length === 0) {
    return { error: t('safety.coi.noCoverage'), ...nothing }
  }

  // ── THE VINs TO FILL, AS `truckId:VIN` PAIRS ──────────────────────────
  const vins = formData
    .getAll('vinFill')
    .map((value) => String(value).split(':'))
    .filter((parts): parts is [string, string] => parts.length === 2)
    .map(([truckId, vin]) => ({ truckId, vin }))

  const result = await withCurrentOrg('create', 'compliance', async (tx) =>
    fileCoi(tx, {
      subject:
        companyId !== ''
          ? { kind: 'company', companyId }
          : { kind: 'trucks', truckIds },
      coverages,
      vins,
    }),
  )

  const filled = result.vinsFilled

  if (result.failure) {
    // PARTIAL SUCCESS IS REPORTED, NOT ROLLED BACK — see `fileCoi`.
    const message =
      result.failure.reason === 'duplicate'
        ? t('safety.coi.duplicate')
        : result.failure.reason === 'bad_dates'
          ? t('safety.coi.badDates')
          : result.failure.reason === 'not_a_fleet_type'
            ? t('safety.coi.notFleetType')
            : result.failure.reason === 'subject_not_found'
              ? t('ref.error.notFound')
              : t('safety.coi.failed')
    return {
      error: message,
      filedRecordIds: result.recordIds,
      vinsFilled: filled,
    }
  }

  revalidatePath('/safety')
  revalidatePath('/companies')
  revalidatePath('/trucks')
  return { error: null, filedRecordIds: result.recordIds, vinsFilled: filled }
}

import {
  createTrailer,
  createTruck,
  type TrailerInput,
  type TruckInput,
} from './fleet'
import { recordRenewal } from './compliance'
import { normalizeTypedDate, utcMidnight } from './typed-date'
import type { TxClient } from './tenancy'
import type { MessageKey } from './i18n'
import type { RecordFormState } from '@/components/forms/RecordForm'

// ---------------------------------------------------------------------------
// ADDING A TRUCK OR A TRAILER, WITH ITS REGISTRATION (TMS §6.5 part 4,
// v11.55; owner's ruling 2026-11-24).
//
// ONE TRANSACTION. The unit and its REGISTRATION compliance item are written
// together or not at all: a truck saved with the expiry the person confirmed
// silently missing is exactly the renewal nobody is warned about. So the
// filing is the compliance panel's own `recordRenewal`, called inside the
// create's transaction, and a refusal from it throws and rolls the unit back.
//
// THE FILE COMES AFTER. The document is uploaded by the browser once the
// item exists (R2 is a third party, and no transaction is held across one),
// as that item's document — the inspection's own pattern. An upload that
// fails leaves a saved truck whose registration item says it has no file.
//
// WITHOUT A DOCUMENT NOTHING CHANGES: no filing is read and the unit is
// created exactly as part 3 creates it.
// ---------------------------------------------------------------------------

export type AssetKind = 'truck' | 'trailer'

/** The form's flag that a registration was read and is held. */
export const REGISTRATION_HELD_FIELD = 'registration'
export const REGISTRATION_EXPIRY_FIELD = 'registrationExpiresAt'
/** Optional (§6.5 part 5): the item's issued date when the card prints one. */
export const REGISTRATION_ISSUED_FIELD = 'registrationIssuedAt'

export interface RegistrationFiling {
  expiresAt: Date
  /** The date the card says it was issued, or null. */
  issuedAt: Date | null
  /** The plate number, the item's identifier. */
  identifier: string | null
  /** The plate state, the item's issuer — the state that registered it. */
  issuer: string | null
}

export type ReadRegistrationFiling =
  | { ok: true; filing: RegistrationFiling | null }
  | { ok: false; error: MessageKey; field: string }

const text = (formData: FormData, name: string) =>
  String(formData.get(name) ?? '').trim()

/**
 * The registration to file, from the form, or null when none is held. The
 * expiry is required while a document is held — it is the one fact the
 * renewal warning needs — and is a typed date like the compliance panel's.
 */
export function readRegistrationFiling(
  formData: FormData,
  today: Date = new Date(),
): ReadRegistrationFiling {
  if (text(formData, REGISTRATION_HELD_FIELD) !== 'yes')
    return { ok: true, filing: null }
  const typed = text(formData, REGISTRATION_EXPIRY_FIELD)
  if (typed === '')
    return {
      ok: false,
      error: 'fleet.registration.noExpiry',
      field: REGISTRATION_EXPIRY_FIELD,
    }
  const iso = normalizeTypedDate(typed, today)
  if (!iso)
    return {
      ok: false,
      error: 'fleet.registration.expiryNotDate',
      field: REGISTRATION_EXPIRY_FIELD,
    }
  // Blank is fine: many states' cards print no issue date (part 5).
  const typedIssued = text(formData, REGISTRATION_ISSUED_FIELD)
  const issuedIso =
    typedIssued === '' ? null : normalizeTypedDate(typedIssued, today)
  if (typedIssued !== '' && !issuedIso)
    return {
      ok: false,
      error: 'fleet.registration.issuedNotDate',
      field: REGISTRATION_ISSUED_FIELD,
    }
  const plate = text(formData, 'plate')
  const state = text(formData, 'plateState').toUpperCase().slice(0, 2)
  return {
    ok: true,
    filing: {
      expiresAt: utcMidnight(iso),
      issuedAt: issuedIso ? utcMidnight(issuedIso) : null,
      identifier: plate === '' ? null : plate,
      issuer: state === '' ? null : state,
    },
  }
}

/** The renewal refused the filing; the unit is rolled back with it. */
export class RegistrationRefused extends Error {
  constructor(readonly reason: string) {
    super(`registration refused: ${reason}`)
    this.name = 'RegistrationRefused'
  }
}

export interface CreatedAsset {
  id: string
  /** The REGISTRATION item, when one was filed — the document goes on it. */
  registrationId: string | null
}

/** What the short form's action answers when it does not redirect. */
export type NewAssetState = RecordFormState & { created?: CreatedAsset | null }

export async function createAssetWithRegistration(
  tx: TxClient,
  organizationId: string,
  kind: AssetKind,
  input: TruckInput & TrailerInput,
  filing: RegistrationFiling | null,
  options: { byUserId?: string | null } = {},
): Promise<CreatedAsset> {
  const unit =
    kind === 'truck'
      ? await createTruck(tx, organizationId, input, options)
      : await createTrailer(tx, organizationId, input, options)
  if (!unit) throw new Error('the unit was not created')
  if (!filing) return { id: unit.id, registrationId: null }

  const renewal = await recordRenewal(tx, {
    subject: kind,
    subjectId: unit.id,
    type: 'REGISTRATION',
    expiresAt: filing.expiresAt,
    issuedAt: filing.issuedAt,
    identifier: filing.identifier,
    issuer: filing.issuer,
    notes: null,
  })
  if (!renewal.ok) throw new RegistrationRefused(renewal.reason)
  return { id: unit.id, registrationId: renewal.recordId }
}

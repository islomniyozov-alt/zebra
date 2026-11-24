import { revalidatePath } from 'next/cache'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import {
  createAssetWithRegistration,
  readRegistrationFiling,
  REGISTRATION_EXPIRY_FIELD,
  RegistrationRefused,
  type AssetKind,
  type NewAssetState,
} from '@/lib/new-asset'
import type { TrailerInput, TruckInput } from '@/lib/fleet'
import type { Translate } from '@/lib/i18n'
import { rememberAuthority, toFormState } from './shared'

// THE SHORT FORM'S SAVE, FOR BOTH UNITS (TMS §6.5 parts 3 and 4). Glue only:
// the filing is read and the write made by `src/lib/new-asset.ts`, and the
// permission is `permissions.ts`'s, asked through `currentUserCan`.
//
// A held registration needs `compliance:create` as well as the unit's own
// create — asked BEFORE anything is written, so a refusal costs nothing and
// names what to do (remove the document) rather than saving half.

export type NewAssetOutcome =
  | { done: true; id: string; registrationId: string | null }
  | { done: false; state: NewAssetState }

export async function saveNewAsset(
  kind: AssetKind,
  input: TruckInput & TrailerInput,
  formData: FormData,
  t: Translate,
): Promise<NewAssetOutcome> {
  const filing = readRegistrationFiling(formData)
  if (!filing.ok) {
    return {
      done: false,
      state: { error: t(filing.error), field: REGISTRATION_EXPIRY_FIELD },
    }
  }
  if (filing.filing && !(await currentUserCan('create', 'compliance'))) {
    return {
      done: false,
      state: { error: t('fleet.registration.notAllowed'), field: null },
    }
  }

  let created
  try {
    created = await withCurrentOrg('create', kind, (tx, session) =>
      createAssetWithRegistration(
        tx,
        session.organizationId,
        kind,
        input,
        filing.filing,
        { byUserId: session.userId },
      ),
    )
  } catch (error) {
    if (error instanceof RegistrationRefused) {
      return {
        done: false,
        state: {
          error: t('fleet.registration.refused'),
          field: REGISTRATION_EXPIRY_FIELD,
        },
      }
    }
    return { done: false, state: toFormState(error, t) }
  }

  await rememberAuthority(input.companyId)
  revalidatePath(kind === 'truck' ? '/trucks' : '/trailers')
  return { done: true, ...created }
}

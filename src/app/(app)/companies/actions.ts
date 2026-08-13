'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  addCompany,
  deleteCompany,
  setCompanyActive,
  updateCompany,
} from '@/lib/companies'
import { requireSession } from '@/lib/auth-context'
import {
  renderConcerns,
  renderStatus,
  runCarrierLookup,
} from '@/lib/fmcsa-lookup'
import {
  ADD_COMPANY_INITIAL,
  type AddCompanyState,
  LOOKUP_INITIAL,
  type LookupState,
} from './company-state'

// The one write this screen has. It goes through `withCurrentOrg('create',
// 'company')`, so the permission is decided in permissions.ts and the row is
// attributed to whoever pressed the button — an authority appearing out of
// nowhere is the last thing an audit trail should be quiet about.

export async function addCompanyAction(
  _previous: AddCompanyState,
  formData: FormData,
): Promise<AddCompanyState> {
  const { t } = await getLocaleContext()
  const text = (name: string) => String(formData.get(name) ?? '')

  const outcome = await withCurrentOrg('create', 'company', (tx, session) =>
    addCompany(tx, session.organizationId, {
      name: text('name'),
      legalName: text('legalName'),
      mcNumber: text('mcNumber'),
      dotNumber: text('dotNumber'),
      addressLine1: text('addressLine1'),
      addressLine2: text('addressLine2'),
      city: text('city'),
      state: text('state'),
      postalCode: text('postalCode'),
      phone: text('phone'),
      email: text('email'),
    }),
  )

  if (!outcome.ok) {
    // THE LIMIT REFUSAL SAYS THE NUMBER. "You have reached your limit" is a
    // dead end; "your plan covers 2 authorities and you have 2" is something
    // the owner can act on, and it names the lever rather than hiding it.
    const error =
      outcome.reason === 'limit_reached'
        ? t('companies.error.limitReached').replace(
            '{limit}',
            String(outcome.limit ?? 1),
          )
        : outcome.reason === 'duplicate_name'
          ? t('companies.error.duplicateName')
          : outcome.reason === 'duplicate_dot'
            ? t('companies.error.duplicateDot').replace(
                '{dot}',
                outcome.dot ?? '',
              )
            : outcome.reason === 'bad_state'
              ? t('companies.error.badState')
              : t('ref.error.required')

    return {
      ...ADD_COMPANY_INITIAL,
      error,
      field:
        outcome.reason === 'bad_state'
          ? 'state'
          : outcome.reason === 'duplicate_dot'
            ? 'dotNumber'
            : outcome.reason === 'limit_reached'
              ? null
              : 'name',
    }
  }

  // Every screen that lists authorities is now wrong until it re-reads.
  revalidatePath('/companies')
  revalidatePath('/loads/new')
  revalidatePath('/settings')

  return { error: null, field: null, companyId: outcome.id }
}

/**
 * Every screen that lists or chooses an authority is wrong until it re-reads.
 *
 * The topbar switcher, the create-load select and the Relay import all filter
 * on `isActive`, which is exactly why a deactivation has to reach them.
 */
function revalidateAuthorities(id?: string): void {
  revalidatePath('/companies')
  if (id) revalidatePath(`/companies/${id}`)
  revalidatePath('/loads/new')
  revalidatePath('/loads/import')
  revalidatePath('/settings')
  // The layout holds the topbar switcher, so every screen under it is stale.
  revalidatePath('/', 'layout')
}

/**
 * Edit an authority.
 *
 * FIELD-LEVEL AUDIT COMES FROM THE PATH, NOT FROM HERE. `withCurrentOrg`
 * routes through the audited Prisma extension, which reads the row before,
 * reads it after, and writes `{ field: { from, to } }` — so an edit that
 * changes one letter of a legal name is recorded as that one letter. Writing a
 * second diff in this action would be a second story about what changed.
 */
export async function updateCompanyAction(
  id: string,
  _previous: AddCompanyState,
  formData: FormData,
): Promise<AddCompanyState> {
  const { t } = await getLocaleContext()
  const text = (name: string) => String(formData.get(name) ?? '')

  const outcome = await withCurrentOrg('update', 'company', (tx) =>
    updateCompany(tx, id, {
      name: text('name'),
      legalName: text('legalName'),
      mcNumber: text('mcNumber'),
      dotNumber: text('dotNumber'),
      addressLine1: text('addressLine1'),
      addressLine2: text('addressLine2'),
      city: text('city'),
      state: text('state'),
      postalCode: text('postalCode'),
      phone: text('phone'),
      email: text('email'),
    }),
  )

  if (!outcome.ok) {
    const error =
      outcome.reason === 'duplicate_name'
        ? t('companies.error.duplicateName')
        : outcome.reason === 'duplicate_dot'
          ? t('companies.error.duplicateDot').replace(
              '{dot}',
              outcome.dot ?? '',
            )
          : outcome.reason === 'bad_state'
            ? t('companies.error.badState')
            : outcome.reason === 'not_found'
              ? t('ref.error.notFound')
              : t('ref.error.required')

    return {
      ...ADD_COMPANY_INITIAL,
      error,
      field:
        outcome.reason === 'bad_state'
          ? 'state'
          : outcome.reason === 'duplicate_dot'
            ? 'dotNumber'
            : outcome.reason === 'not_found'
              ? null
              : 'name',
    }
  }

  revalidateAuthorities(id)
  return { error: null, field: null, companyId: id }
}

/**
 * Take an authority out of service.
 *
 * NOT A DELETE, and the distinction is the whole feature: `Company.id` IS the
 * tenant scope, so the row stays and every load, invoice and settlement it ran
 * keeps rendering. What changes is that it leaves the topbar switcher and the
 * create-load select, because both already filter on `isActive` — so nothing
 * NEW can be filed under it.
 */
export async function deactivateCompanyAction(id: string): Promise<void> {
  await withCurrentOrg('update', 'company', (tx) =>
    setCompanyActive(tx, id, false),
  )
  revalidateAuthorities(id)
}

export async function reactivateCompanyAction(id: string): Promise<void> {
  await withCurrentOrg('update', 'company', (tx) =>
    setCompanyActive(tx, id, true),
  )
  revalidateAuthorities(id)
}

/**
 * Remove an authority that never did anything.
 *
 * THE REFUSAL IS IN `deleteCompany` AND IT IS COUNTED INSIDE THE TRANSACTION,
 * so a load booked between the page rendering and the button being pressed
 * cannot be cascaded away by a check that was true a minute ago. The screen
 * hides the button when anything is filed under the authority; this is the
 * wall behind that, and it is the one that matters.
 */
export async function deleteCompanyAction(id: string): Promise<void> {
  const outcome = await withCurrentOrg('delete', 'company', (tx) =>
    deleteCompany(tx, id),
  )

  revalidateAuthorities(id)

  // A refusal leaves the screen where it is, still showing what is filed under
  // the authority and still offering deactivation. Redirecting to a list that
  // still contains the row would read as a silent success.
  if (outcome.ok) redirect('/companies')
}

// ---------------------------------------------------------------------------
// THE FMCSA LOOKUP, for an authority we book freight under.
//
// A SERVER FUNCTION, NOT A FORM ACTION, and called from a transition rather
// than by submitting. The form has one submit and it is Add authority; a
// lookup that submitted the form would be a button that looks like the save
// button next to it.
//
// THE WEBKEY IS THE REASON THIS IS ON THE SERVER AT ALL. FMCSA takes the key
// as a query parameter, so a browser fetch would put it in the network tab of
// anybody who opened this page — and in their history, and in any proxy log
// between here and Washington.
//
// IT NEVER WRITES. The answer goes into the form's fields and waits for a
// person to press Add authority. That is the extraction contract's posture —
// prefill, then a human — applied to a different source of the same kind of
// claim.
//
// The call, the budget and the sentences live in `fmcsa-lookup.ts`, shared
// with the broker screen. What stays here is the permission and the mapping
// from register fields onto THIS table's columns.
// ---------------------------------------------------------------------------

export async function lookupCarrierAction(input: {
  dot: string
  mc: string
}): Promise<LookupState> {
  const { t } = await getLocaleContext()

  // The permission is `company:create` and it is decided in permissions.ts, as
  // every permission is. The page already 404s for a role without it; this is
  // the second door, because a server function is reachable without the page.
  if (!(await currentUserCan('create', 'company'))) {
    return { ...LOOKUP_INITIAL, error: t('fmcsa.error.refused') }
  }

  // WHOSE BUDGET. Read after the permission check, so an unauthenticated call
  // is refused rather than counted.
  const session = await requireSession()

  const outcome = await runCarrierLookup({ ...input, userId: session.userId })
  if (!outcome.ok) {
    const message = Object.entries(outcome.values ?? {}).reduce(
      (sentence, [key, value]) => sentence.replaceAll(`{${key}}`, value),
      t(outcome.messageKey),
    )
    return { ...LOOKUP_INITIAL, error: message }
  }

  const carrier = outcome.carrier
  return {
    error: null,
    found: {
      prefill: {
        // THE TRADE NAME IS THE DBA WHEN THERE IS ONE. Zebra's `name` is what
        // the office calls this authority and `legalName` is what the invoice
        // footer prints; FMCSA's `dbaName` and `legalName` are exactly that
        // pair, in that order. The broker screen reverses this, and the
        // comment there says why.
        name: carrier.dbaName ?? carrier.legalName ?? '',
        legalName: carrier.legalName ?? '',
        dotNumber: carrier.dotNumber ?? '',
        addressLine1: carrier.addressLine1 ?? '',
        city: carrier.city ?? '',
        state: carrier.state ?? '',
        postalCode: carrier.postalCode ?? '',
        phone: carrier.phone ?? '',
      },
      entityType: carrier.entityType,
      operation: carrier.operation,
      safetyRating: carrier.safetyRating,
      dbaName: carrier.dbaName,
      status: renderStatus(carrier, t),
      // `operating` — this is an authority WE will run freight under, so
      // common or contract authority is what matters and broker authority is
      // not expected.
      concerns: renderConcerns(carrier, 'operating', t),
    },
  }
}

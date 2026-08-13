'use server'

import { revalidatePath } from 'next/cache'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { addCompany } from '@/lib/companies'
import {
  FmcsaError,
  type CarrierConcern,
  type FmcsaFailure,
  carrierNumber,
  concernsFor,
  lookupCarrier,
} from '@/lib/fmcsa'
import type { MessageKey } from '@/lib/i18n'
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

// ---------------------------------------------------------------------------
// THE FMCSA LOOKUP.
//
// A SERVER FUNCTION, NOT A FORM ACTION, and called from a transition rather
// than by submitting. The form has one submit and it is Add authority; a
// lookup that submitted the form would be a button that looks like the save
// button next to it. Taking a plain object rather than `FormData` also keeps
// the two paths visibly different in the client.
//
// THE WEBKEY IS THE REASON THIS IS ON THE SERVER AT ALL. FMCSA takes the key
// as a query parameter, so a browser fetch would put it in the network tab of
// anybody who opened this page — and in their history, and in any proxy log
// between here and Washington.
//
// IT NEVER WRITES. Nothing is saved, nothing is audited, nothing is created:
// the answer goes into the form's fields and waits for a person to press Add
// authority. That is the extraction contract's posture — prefill, then a human
// — applied to a different source of the same kind of claim.
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
    return { ...LOOKUP_INITIAL, error: t('companies.error.lookupRefused') }
  }

  // USDOT FIRST WHEN BOTH ARE TYPED. A DOT number identifies exactly one
  // authority; a docket number can exist as MC, FF and MX at once, and the
  // register answers that endpoint with a list. Preferring the unambiguous one
  // is not a preference about which field matters.
  const dot = carrierNumber(input.dot)
  const mc = carrierNumber(input.mc)
  const query = dot
    ? ({ kind: 'dot', number: dot } as const)
    : mc
      ? ({ kind: 'mc', number: mc } as const)
      : null

  if (!query) {
    return { ...LOOKUP_INITIAL, error: t('companies.error.lookupNeedNumber') }
  }

  try {
    const carrier = await lookupCarrier(query)

    return {
      error: null,
      found: {
        prefill: {
          // THE TRADE NAME IS THE DBA WHEN THERE IS ONE. Zebra's `name` is what
          // the office calls this authority and `legalName` is what the invoice
          // footer prints; FMCSA's `dbaName` and `legalName` are exactly that
          // pair, in that order.
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
        status:
          carrier.statusCode === null
            ? null
            : carrier.statusCode.toUpperCase() === 'A'
              ? t('companies.fmcsaActive')
              : t('companies.fmcsaInactive'),
        // The out-of-service sentence names the date, because "there is an
        // order" and "there was an order in 2019" are different facts.
        concerns: concernsFor(carrier).map((concern) =>
          t(CONCERN_KEYS[concern]).replace(
            '{date}',
            carrier.outOfServiceDate ?? '',
          ),
        ),
      },
    }
  } catch (error) {
    // EVERY FAILURE DEGRADES TO THE MANUAL FORM. Nothing here is cleared,
    // nothing is disabled, and every sentence ends by saying so — the lookup is
    // a convenience on a form that worked before it existed.
    if (error instanceof FmcsaError) {
      return {
        ...LOOKUP_INITIAL,
        error: t(LOOKUP_ERROR_KEYS[error.reason]),
      }
    }
    // An unexpected throw is still not worth a 500 on a form somebody can
    // finish by typing. Logged by the platform; shown as the generic sentence.
    return { ...LOOKUP_INITIAL, error: t('companies.error.lookupUnavailable') }
  }
}

/** One sentence per concern, in the catalogue with every other sentence. */
const CONCERN_KEYS: Record<CarrierConcern, MessageKey> = {
  not_allowed_to_operate: 'companies.warn.notAllowedToOperate',
  out_of_service: 'companies.warn.outOfService',
  inactive: 'companies.warn.inactive',
  no_active_authority: 'companies.warn.noActiveAuthority',
  unsatisfactory_rating: 'companies.warn.unsatisfactoryRating',
}

const LOOKUP_ERROR_KEYS: Record<FmcsaFailure, MessageKey> = {
  no_web_key: 'companies.error.lookupNoKey',
  bad_number: 'companies.error.lookupNeedNumber',
  not_found: 'companies.error.lookupNotFound',
  http_error: 'companies.error.lookupUnavailable',
  unreadable: 'companies.error.lookupUnavailable',
  unreachable: 'companies.error.lookupUnavailable',
}

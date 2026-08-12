import type { TxClient } from './tenancy'
import { optionalText, stateCode } from './reference'

// ---------------------------------------------------------------------------
// ADDING AN AUTHORITY (Phase 6 §7 flag 11).
//
// Companies were seed-only until now: `company:create` was a permission OWNER
// and ADMIN both held and nothing implemented, so the only ways a carrier
// existed were the seed script and hand-written SQL. Everything
// per-authority — the create form's first field, the factoring remit-to, the
// settlement week boundary, invoice numbering — was configured for carriers a
// developer had to conjure.
//
// A COMPANY IS AN OPERATING AUTHORITY, not a folder. `Company.id` IS the
// authority (tenancy.ts), so creating one is creating the thing every scoped
// query filters by, and it is why this is owner-gated rather than convenient.
//
// NOTHING IS DELETED HERE. An authority with freight under it does not go
// away, which is why the model has `isActive` and no `deletedAt` — the same
// reasoning `factoring.ts` records about its own company lookup.
// ---------------------------------------------------------------------------

export type AddCompanyFailure =
  | 'no_name'
  | 'duplicate_name'
  | 'limit_reached'
  | 'bad_state'

export type AddCompanyResult =
  | { ok: true; id: string }
  | { ok: false; reason: AddCompanyFailure; limit?: number }

export interface AddCompanyInput {
  name: string
  legalName?: string | null
  mcNumber?: string | null
  dotNumber?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  phone?: string | null
  email?: string | null
}

/**
 * A new authority under this organization.
 *
 * THE LIMIT IS THE PAID LEVER AND IT IS ENFORCED HERE. `Organization.
 * maxCompanies` has defaulted to 1 since the init migration and nothing has
 * ever checked it, because nothing could create a company. A tenant on a
 * one-authority plan that can add five is not on a plan.
 *
 * Counted INSIDE the caller's transaction, so two people adding the fifth
 * carrier at once cannot both pass a check that was true when each of them
 * read it.
 */
export async function addCompany(
  tx: TxClient,
  organizationId: string,
  input: AddCompanyInput,
): Promise<AddCompanyResult> {
  const name = input.name.trim()
  if (name === '') return { ok: false, reason: 'no_name' }

  // A TWO-LETTER CODE OR NOTHING, and stricter than `stateCode` on purpose.
  //
  // `stateCode` TRUNCATES — it is the shared helper and stops use it, where
  // leniency was the right call. "Texas" through it is "TE", which on a stop is
  // a wrong city label and on an AUTHORITY is a wrong state printed at the top
  // of every invoice that carrier ever sends. Refused here rather than
  // silently shortened.
  const state = optionalText(input.state)
  if (state !== null && !/^[A-Za-z]{2}$/.test(state)) {
    return { ok: false, reason: 'bad_state' }
  }
  const code = state === null ? null : stateCode(state)

  const organization = await tx.organization.findFirst({
    where: { id: organizationId },
    select: { maxCompanies: true },
  })
  const limit = organization?.maxCompanies ?? 1

  const existing = await tx.company.count()
  if (existing >= limit) {
    return { ok: false, reason: 'limit_reached', limit }
  }

  // Case-insensitive, because "RAM Haulage" and "Ram Haulage" as two
  // authorities is a mistake nobody notices until an invoice goes out under
  // the wrong one. Not a database constraint: the organization scope is
  // enforced by RLS and a unique index would have to include it, which is a
  // migration this screen does not need to earn.
  const clash = await tx.company.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  })
  if (clash) return { ok: false, reason: 'duplicate_name' }

  const created = await tx.company.create({
    data: {
      organizationId,
      name,
      legalName: optionalText(input.legalName),
      mcNumber: optionalText(input.mcNumber),
      dotNumber: optionalText(input.dotNumber),
      addressLine1: optionalText(input.addressLine1),
      addressLine2: optionalText(input.addressLine2),
      city: optionalText(input.city),
      state: code,
      postalCode: optionalText(input.postalCode),
      phone: optionalText(input.phone),
      email: optionalText(input.email),
    },
    select: { id: true },
  })

  // NO COUNTER IS SEEDED. Load numbers are allocated per authority on first
  // booking (`allocateNumber`), and the standing rule is that the row appears
  // when the first load does. Creating one here would put a counter at zero
  // under a carrier that may never book, and would be a second place that
  // decides where a series starts.
  return { ok: true, id: created.id }
}

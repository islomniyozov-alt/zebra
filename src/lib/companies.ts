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
  | 'duplicate_dot'
  | 'limit_reached'
  | 'bad_state'

export type AddCompanyResult =
  | { ok: true; id: string }
  | { ok: false; reason: AddCompanyFailure; limit?: number; dot?: string }

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

  // THE SCHEMA HAS ALWAYS HAD `@@unique([organizationId, dotNumber])` AND
  // NOTHING HAS EVER HANDLED IT.
  //
  // Harmless while a DOT number was something somebody occasionally typed;
  // not harmless now that the FMCSA lookup fills it in, because looking up the
  // same carrier twice is exactly what somebody does when they are not sure
  // whether they already added it. Unhandled, Prisma's unique violation
  // escapes `addCompanyAction` and the browser gets a 500 with no sentence in
  // it — on the one screen where the answer is a single friendly line.
  //
  // Checked here rather than caught below because the message names the
  // number, and a caught constraint error does not carry it.
  const dotNumber = optionalText(input.dotNumber)
  if (dotNumber !== null) {
    const sameDot = await tx.company.findFirst({
      where: { dotNumber },
      select: { id: true },
    })
    if (sameDot) {
      return { ok: false, reason: 'duplicate_dot', dot: dotNumber }
    }
  }

  const created = await tx.company.create({
    data: {
      organizationId,
      name,
      legalName: optionalText(input.legalName),
      mcNumber: optionalText(input.mcNumber),
      dotNumber,
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

// ---------------------------------------------------------------------------
// EDITING AND RETIRING AN AUTHORITY (owner report: rows are not clickable).
//
// Flag 11 built the create half and said so. What it skipped is everything
// after the first save: a typo in an MC number was uncorrectable, and an
// authority added by mistake was permanent. Both were reachable only with SQL,
// which is the state the whole screen exists to end.
//
// DEACTIVATE IS THE DEFAULT AND DELETE IS THE EXCEPTION, because `Company.id`
// IS the tenant scope every query filters by. Deleting one cascades — the
// schema says `onDelete: Cascade` on every child — so a hard delete of an
// authority that has run freight would take its loads, its invoices, its
// settlements and its audit trail with it, silently and in one statement.
// ---------------------------------------------------------------------------

/**
 * What is filed under this authority.
 *
 * COUNTED ACROSS EVERYTHING THAT CASCADES, not a representative sample. The
 * whole purpose is to answer "would deleting this destroy anything", and a
 * check that looked at loads and invoices would happily delete an authority
 * holding three trucks and a year of inspections.
 *
 * Three relations are deliberately NOT counted, because they are bookkeeping
 * this screen creates rather than history somebody entered:
 *
 *   * `settings` — one row per company, written at setup;
 *   * `memberScopes` — who may see it, which is about people, not freight;
 *   * `auditLogs` — including the row recording that it was created. Blocking
 *     on those would make every authority undeletable the moment it existed,
 *     which is the same as having no delete at all.
 */
export interface CompanyUsage {
  loads: number
  invoices: number
  settlements: number
  /** Everything else that would be destroyed. Summed, because the sentence
   *  names the three the owner asked for and this is the safety net. */
  other: number
  total: number
}

const CASCADING = {
  loads: true,
  invoices: true,
  settlements: true,
  payments: true,
  expenses: true,
  trucks: true,
  trailers: true,
  drivers: true,
  documents: true,
  maintenance: true,
  inspections: true,
  claims: true,
  fuelTxns: true,
  iftaMileage: true,
  complianceItems: true,
  dataQs: true,
  communications: true,
  notifications: true,
  calendarEvents: true,
  pendingUploads: true,
  factoringCompanies: true,
  integrations: true,
  assetHistory: true,
  // A counter row means this authority allocated a load number at some point,
  // which is freight even if the load has since gone.
  counters: true,
} as const

export async function companyUsage(
  tx: TxClient,
  companyId: string,
): Promise<CompanyUsage> {
  const row = await tx.company.findFirst({
    where: { id: companyId },
    select: { _count: { select: CASCADING } },
  })
  const counts = (row?._count ?? {}) as Record<string, number>

  const named = ['loads', 'invoices', 'settlements']
  const other = Object.entries(counts)
    .filter(([key]) => !named.includes(key))
    .reduce((sum, [, count]) => sum + count, 0)

  const loads = counts['loads'] ?? 0
  const invoices = counts['invoices'] ?? 0
  const settlements = counts['settlements'] ?? 0

  return {
    loads,
    invoices,
    settlements,
    other,
    total: loads + invoices + settlements + other,
  }
}

export type UpdateCompanyFailure = AddCompanyFailure | 'not_found'

export type UpdateCompanyResult =
  | { ok: true; id: string }
  | { ok: false; reason: UpdateCompanyFailure; dot?: string }

/**
 * Edit an authority.
 *
 * THE SAME REFUSALS AS CREATE AND FOR THE SAME REASONS — a two-letter state
 * because it prints at the top of every invoice, a unique name because two
 * "RAM Haulage" rows send invoices out under the wrong one, a unique USDOT
 * because the schema has always said so. The only difference is that this row
 * is allowed to be itself: every check excludes the record being edited, which
 * is the bug an edit form written by copying a create form always has.
 *
 * NO LIMIT CHECK. `maxCompanies` governs how many exist; editing one does not
 * make another.
 *
 * FIELD-LEVEL AUDIT COMES FOR FREE and deliberately so: this runs through the
 * audited Prisma extension, which diffs the row before and after and writes
 * `{ field: { from, to } }`. Writing a second diff here would be a second
 * story about what changed.
 */
export async function updateCompany(
  tx: TxClient,
  id: string,
  input: AddCompanyInput,
): Promise<UpdateCompanyResult> {
  const name = input.name.trim()
  if (name === '') return { ok: false, reason: 'no_name' }

  const current = await tx.company.findFirst({
    where: { id },
    select: { id: true },
  })
  if (!current) return { ok: false, reason: 'not_found' }

  const state = optionalText(input.state)
  if (state !== null && !/^[A-Za-z]{2}$/.test(state)) {
    return { ok: false, reason: 'bad_state' }
  }

  // `id: { not: id }` on both — a record is allowed to keep its own name and
  // its own USDOT, which is what makes this an edit rather than a create that
  // always refuses.
  const clash = await tx.company.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, id: { not: id } },
    select: { id: true },
  })
  if (clash) return { ok: false, reason: 'duplicate_name' }

  const dotNumber = optionalText(input.dotNumber)
  if (dotNumber !== null) {
    const sameDot = await tx.company.findFirst({
      where: { dotNumber, id: { not: id } },
      select: { id: true },
    })
    if (sameDot) return { ok: false, reason: 'duplicate_dot', dot: dotNumber }
  }

  await tx.company.update({
    where: { id },
    data: {
      name,
      legalName: optionalText(input.legalName),
      mcNumber: optionalText(input.mcNumber),
      dotNumber,
      addressLine1: optionalText(input.addressLine1),
      addressLine2: optionalText(input.addressLine2),
      city: optionalText(input.city),
      state: state === null ? null : stateCode(state),
      postalCode: optionalText(input.postalCode),
      phone: optionalText(input.phone),
      email: optionalText(input.email),
    },
  })

  return { ok: true, id }
}

/**
 * Take an authority out of service without taking its history with it.
 *
 * `isActive: false` is all this is, and every screen that offers a choice of
 * authority already filters on it — the topbar switcher, the create-load
 * select, the Relay import. A deactivated carrier therefore disappears from
 * everywhere somebody could file NEW freight under it, and keeps rendering on
 * every load, invoice and settlement it ever ran, because those join by id and
 * do not care.
 */
export async function setCompanyActive(
  tx: TxClient,
  id: string,
  isActive: boolean,
): Promise<{ ok: boolean }> {
  const existing = await tx.company.findFirst({
    where: { id },
    select: { id: true },
  })
  if (!existing) return { ok: false }
  await tx.company.update({ where: { id }, data: { isActive } })
  return { ok: true }
}

export type DeleteCompanyResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'has_history'; usage: CompanyUsage }

/**
 * Remove an authority that never did anything.
 *
 * THE ONLY CASE THIS ALLOWS is the one the owner named: a mistaken entry with
 * nothing under it. Everything else is refused in words and offered
 * deactivation instead, because `onDelete: Cascade` means a delete here is a
 * delete of every load, invoice, settlement, truck and inspection filed under
 * it — the single most destructive statement this application could run, and
 * it would report success.
 *
 * The count is taken INSIDE the caller's transaction, immediately before the
 * delete, so a load booked between somebody reading the screen and pressing
 * the button cannot be destroyed by a check that was true a minute ago.
 */
export async function deleteCompany(
  tx: TxClient,
  id: string,
): Promise<DeleteCompanyResult> {
  const existing = await tx.company.findFirst({
    where: { id },
    select: { id: true },
  })
  if (!existing) return { ok: false, reason: 'not_found' }

  const usage = await companyUsage(tx, id)
  if (usage.total > 0) return { ok: false, reason: 'has_history', usage }

  await tx.company.delete({ where: { id } })
  return { ok: true }
}

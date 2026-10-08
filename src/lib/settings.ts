import type { Prisma } from '@/generated/prisma/client'
import { parseMoneyToCents, parsePercentToBps } from './money'
import type { CompanyIdScopeFilter, TxClient } from './tenancy'
import { LISTED_AUTHORITY } from './companies'

// ---------------------------------------------------------------------------
// COMPANY SETTINGS (Phase 4 §3 step 6).
//
// `CompanySettings` has existed since the init migration and is read by the
// invoice service, the settlement service and the compliance queue. Nothing has
// ever WRITTEN one except the seed, so every authority in production carries
// whatever the defaults happened to be — including a 30-day compliance horizon
// nobody chose and a 3% factoring assumption that is not either carrier's rate.
//
// AUDITING IS NOT BUILT HERE. §4 asks that "Settings edits are audited with
// field-level diffs", and the Prisma audit extension already writes
// `{ field: { from, to } }` for every changed field on every write that goes
// through the scoped client (see audit.ts, `diffRows`). Building a second
// mechanism would be a second story about what changed. What this file owes the
// requirement is to make ONE update per save so the diff is one row, and to
// leave unchanged fields out of it — which is what `diffRows` already does when
// the values match.
//
// EVERY NUMBER IS PARSED THROUGH money.ts. Cents for money, basis points for
// percentages (rule 9-money). The screen types "3.5%" and "0.55"; nothing here
// invents a rounding rule of its own.
// ---------------------------------------------------------------------------

export interface SettingsRow {
  companyId: string
  companyName: string
  invoiceNumberPrefix: string
  invoiceTermsDays: number
  invoiceNotes: string | null
  remitToText: string | null
  defaultFuelCostPerMileCents: number
  defaultMpg: string
  factoringFeeBps: number
  dispatchFeeBps: number
  complianceWarnDays: number
  podMissingAlertDays: number
  invoiceOverdueDays: number
  settlementWeekEndsOn: number
}

const SELECT = {
  companyId: true,
  invoiceNumberPrefix: true,
  invoiceTermsDays: true,
  invoiceNotes: true,
  remitToText: true,
  defaultFuelCostPerMileCents: true,
  defaultMpg: true,
  factoringFeeBps: true,
  dispatchFeeBps: true,
  complianceWarnDays: true,
  podMissingAlertDays: true,
  invoiceOverdueDays: true,
  settlementWeekEndsOn: true,
  company: { select: { name: true } },
} satisfies Prisma.CompanySettingsSelect

type Stored = Prisma.CompanySettingsGetPayload<{ select: typeof SELECT }>

function shape(row: Stored): SettingsRow {
  return {
    companyId: row.companyId,
    companyName: row.company.name,
    invoiceNumberPrefix: row.invoiceNumberPrefix,
    invoiceTermsDays: row.invoiceTermsDays,
    invoiceNotes: row.invoiceNotes,
    remitToText: row.remitToText,
    defaultFuelCostPerMileCents: row.defaultFuelCostPerMileCents,
    // A `Decimal(5,2)`, kept as a STRING all the way to the input. Turning it
    // into a float here is how 6.5 becomes 6.500000000000001 in a form field.
    defaultMpg: row.defaultMpg.toString(),
    factoringFeeBps: row.factoringFeeBps,
    dispatchFeeBps: row.dispatchFeeBps,
    complianceWarnDays: row.complianceWarnDays,
    podMissingAlertDays: row.podMissingAlertDays,
    invoiceOverdueDays: row.invoiceOverdueDays,
    settlementWeekEndsOn: row.settlementWeekEndsOn,
  }
}

/**
 * Settings for every authority in scope, with one CREATED on the fly for any
 * that has none.
 *
 * The seed writes a settings row; nothing else ever has, so an authority added
 * by hand — or by a future screen — would have no row and the settings page
 * would show it nothing to edit. Reading is the right moment to fix that: the
 * row is entirely defaults, so creating it changes no behaviour and makes the
 * authority editable.
 */
export async function settingsForScope(
  tx: TxClient,
  scope: CompanyIdScopeFilter = {},
): Promise<SettingsRow[]> {
  const companies = await tx.company.findMany({
    where: { ...LISTED_AUTHORITY, ...scope },
    orderBy: { name: 'asc' },
    select: { id: true, organizationId: true },
  })

  const existing = await tx.companySettings.findMany({
    where: { companyId: { in: companies.map((company) => company.id) } },
    select: SELECT,
  })
  const byCompany = new Map(existing.map((row) => [row.companyId, row]))

  const rows: SettingsRow[] = []
  for (const company of companies) {
    const found = byCompany.get(company.id)
    if (found) {
      rows.push(shape(found))
      continue
    }
    const created = await tx.companySettings.create({
      data: { companyId: company.id, organizationId: company.organizationId },
      select: SELECT,
    })
    rows.push(shape(created))
  }

  return rows
}

// --- saving ------------------------------------------------------------------

export type SettingsFailure =
  | 'not_found'
  | 'bad_prefix'
  | 'bad_days'
  | 'bad_money'
  | 'bad_mpg'
  | 'bad_weekday'

export type SettingsResult =
  | { ok: true; changed: string[] }
  | { ok: false; reason: SettingsFailure; field?: string }

/** What a form posts. Everything is a string; nothing is trusted. */
export interface SettingsInput {
  invoiceNumberPrefix: string
  invoiceTermsDays: string
  invoiceNotes: string
  remitToText: string
  defaultFuelCostPerMile: string
  defaultMpg: string
  factoringFeePercent: string
  dispatchFeePercent: string
  complianceWarnDays: string
  podMissingAlertDays: string
  invoiceOverdueDays: string
  settlementWeekEndsOn: string
}

/** A whole number of days within a sane range, or null if it is not one. */
function days(value: string, max: number): number | null {
  const cleaned = value.trim()
  if (!/^\d+$/.test(cleaned)) return null
  const parsed = Number.parseInt(cleaned, 10)
  return parsed >= 0 && parsed <= max ? parsed : null
}

/**
 * Miles per gallon as a `Decimal(5,2)` string.
 *
 * Refused rather than clamped: a truck does not do 0 mpg and does not do 99,
 * and a profitability figure computed from either would be nonsense nobody
 * could trace back to a typo.
 */
export function parseMpg(value: string): string | null {
  const cleaned = value.trim()
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(cleaned)) return null
  const parsed = Number.parseFloat(cleaned)
  return parsed >= 1 && parsed <= 20 ? cleaned : null
}

export async function saveSettings(
  tx: TxClient,
  companyId: string,
  input: SettingsInput,
): Promise<SettingsResult> {
  const prefix = input.invoiceNumberPrefix.trim()
  // The prefix goes into an invoice number that people read down a phone and
  // type into a broker portal. Letters, digits and a dash — nothing that needs
  // escaping anywhere it lands.
  if (prefix === '' || prefix.length > 12 || !/^[A-Za-z0-9-]+$/.test(prefix)) {
    return { ok: false, reason: 'bad_prefix', field: 'invoiceNumberPrefix' }
  }

  const terms = days(input.invoiceTermsDays, 365)
  const warn = days(input.complianceWarnDays, 365)
  const podDays = days(input.podMissingAlertDays, 90)
  const overdue = days(input.invoiceOverdueDays, 90)
  for (const [value, field] of [
    [terms, 'invoiceTermsDays'],
    [warn, 'complianceWarnDays'],
    [podDays, 'podMissingAlertDays'],
    [overdue, 'invoiceOverdueDays'],
  ] as const) {
    if (value === null) return { ok: false, reason: 'bad_days', field }
  }

  const weekday = days(input.settlementWeekEndsOn, 6)
  if (weekday === null) {
    return { ok: false, reason: 'bad_weekday', field: 'settlementWeekEndsOn' }
  }

  let fuelCents: number
  try {
    fuelCents = parseMoneyToCents(input.defaultFuelCostPerMile)
  } catch {
    return { ok: false, reason: 'bad_money', field: 'defaultFuelCostPerMile' }
  }
  if (fuelCents < 0) {
    return { ok: false, reason: 'bad_money', field: 'defaultFuelCostPerMile' }
  }

  let factoringBps: number
  let dispatchBps: number
  try {
    factoringBps = parsePercentToBps(input.factoringFeePercent)
    dispatchBps = parsePercentToBps(input.dispatchFeePercent)
  } catch {
    return { ok: false, reason: 'bad_money', field: 'factoringFeePercent' }
  }
  if (
    factoringBps < 0 ||
    factoringBps > 10_000 ||
    dispatchBps < 0 ||
    dispatchBps > 10_000
  ) {
    return { ok: false, reason: 'bad_money', field: 'factoringFeePercent' }
  }

  const mpg = parseMpg(input.defaultMpg)
  if (mpg === null) return { ok: false, reason: 'bad_mpg', field: 'defaultMpg' }

  const existing = await tx.companySettings.findFirst({
    where: { companyId },
    select: SELECT,
  })
  if (!existing) return { ok: false, reason: 'not_found' }

  const next = {
    invoiceNumberPrefix: prefix,
    invoiceTermsDays: terms!,
    invoiceNotes: input.invoiceNotes.trim() || null,
    remitToText: input.remitToText.trim() || null,
    defaultFuelCostPerMileCents: fuelCents,
    defaultMpg: mpg,
    factoringFeeBps: factoringBps,
    dispatchFeeBps: dispatchBps,
    complianceWarnDays: warn!,
    podMissingAlertDays: podDays!,
    invoiceOverdueDays: overdue!,
    settlementWeekEndsOn: weekday,
  }

  // ONE UPDATE, so the audit row is one diff of the whole save. The extension
  // leaves unchanged fields out of it, so a save that touched the invoice
  // prefix and nothing else audits as exactly that.
  await tx.companySettings.update({ where: { companyId }, data: next })

  // Reported back for the screen's confirmation line: naming what moved is
  // worth more than "Saved", and it is the same set the audit row holds.
  const before = shape(existing)
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
    (key) => String(before[key]) !== String(next[key]),
  )

  return { ok: true, changed }
}

// --- the settlement week -----------------------------------------------------

/**
 * The last full settlement week for an authority, as ISO dates.
 *
 * Phase 3 step 6 hard-coded Monday-to-Sunday in `lastFullWeek`. This is the
 * same computation with the boundary read from `CompanySettings` — the field
 * PHASE-4-BRIEF.md §6 flag 2 said did not exist, created in this step's
 * migration.
 *
 * `endsOn` is a `Date.getUTCDay()` value: 0 Sunday through 6 Saturday. The week
 * that ends TODAY is not finished, so a settlement run on the boundary day
 * offers the week before it — the special case Phase 3 already named for
 * Sunday, stated once here for every day.
 */
export function lastFullWeekEnding(
  today: Date,
  endsOn: number,
): { start: string; end: string } {
  const end = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  )

  // How many days back the most recent boundary is. Zero means today IS the
  // boundary, and today's week is not finished — so go back a full seven.
  const delta = (end.getUTCDay() - endsOn + 7) % 7
  end.setUTCDate(end.getUTCDate() - (delta === 0 ? 7 : delta))

  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 6)

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

/** The boundary for one authority, or the default when it has no row yet. */
export async function weekEndsOnFor(
  tx: TxClient,
  companyId: string,
): Promise<number> {
  const row = await tx.companySettings.findFirst({
    where: { companyId },
    select: { settlementWeekEndsOn: true },
  })
  return row?.settlementWeekEndsOn ?? 0
}

/**
 * The most recent week that is finished for EVERY authority in a set.
 *
 * A user scoped to two carriers whose weeks end on different days has no single
 * "last full week", and picking either one offers a period that is still open
 * for the other — which would settle a driver mid-week and pay them for four
 * days. So: compute each boundary's last full week and take the EARLIEST end.
 *
 * With one authority, or with several that agree, this is exactly
 * `lastFullWeekEnding`. It only differs where the answer was genuinely
 * ambiguous, and there it errs towards a week nobody is still running freight
 * in.
 */
export function lastFullWeekAcross(
  today: Date,
  endsOn: readonly number[],
): { start: string; end: string } {
  if (endsOn.length === 0) return lastFullWeekEnding(today, 0)

  return endsOn
    .map((day) => lastFullWeekEnding(today, day))
    .reduce((earliest, week) => (week.end < earliest.end ? week : earliest))
}

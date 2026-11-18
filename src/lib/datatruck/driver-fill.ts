import { optionalText } from '../reference'
import { parseLicenceExpiry } from './drivers'
import { resolveState } from './states'

// ---------------------------------------------------------------------------
// FILL EMPTY DRIVER FIELDS FROM A FULLER EXPORT (owner's request 2026-11-18).
//
// Measured on dev that day, 168 drivers: 167 with no hire date, 21 with no
// CDL number, 168 with no CDL class, 168 with no medical-card record. The
// Datatruck exports the seeds read are the reason: the 2026-09-07 file has no
// hire-date column at all, the 2026-09-09 files carry one on 12 of 170 rows
// that no seed ever read, and none of the three has a class or a medical-card
// column. Adzhmal Alimi's row carries an expiry and nothing else.
//
// THE RULES, every one a refusal rather than a judgment:
//   - Keyed on `Driver ID` ↔ `Driver.externalId`, as every seed is. A row
//     whose name does not match the driver under that id is HELD by both
//     names: filling one person's licence onto another is the failure.
//   - A field is filled only when the driver's is EMPTY and the export's
//     parses. A value already there is never overwritten; a disagreement is
//     listed by name as KEPT, so it is visible, not resolved.
//   - Columns are found by header. One the export lacks is named in the
//     preview as absent — "nothing to fill" and "never looked" must not read
//     the same.
//   - A CDL or medical-card RECORD is created only where the driver has none
//     of that type AND `isQualifiable` holds (the DQF's own predicate: not a
//     payee, not INACTIVE). The applicant and terminated seeds file no
//     records on purpose — a queue of breaches nobody can clear — and this
//     keeps to that.
// ---------------------------------------------------------------------------

/** Header spellings accepted per field, first match wins. */
export const FILL_COLUMNS = {
  hireDate: ['Hire date'],
  cdlNumber: ['Driver license', 'CDL number'],
  cdlState: ['Driver license state', 'CDL state'],
  cdlClass: ['Driver license class', 'CDL class', 'License class'],
  cdlExpiresAt: ['Driver license expiration', 'CDL expiration'],
  medicalExpiresAt: [
    'Medical card expiration',
    'Medical card expiry',
    'Med card expiration',
    'Medical certificate expiration',
  ],
} as const

export type FillField = keyof typeof FILL_COLUMNS
export type DriverField = 'hireDate' | 'cdlNumber' | 'cdlState' | 'cdlClass'
export type RecordField = 'cdlExpiresAt' | 'medicalExpiresAt'

export interface CurrentDriver {
  id: string
  externalId: string | null
  firstName: string
  lastName: string
  hireDate: Date | null
  cdlNumber: string | null
  cdlState: string | null
  cdlClass: string | null
  hasCdlRecord: boolean
  hasMedicalRecord: boolean
  /** `isQualifiable` evaluated by the caller. */
  qualifiable: boolean
}

export interface FillPlan {
  /** Each field's header in this export, or null where it has none. */
  columns: { field: FillField; header: string | null }[]
  /** Driver fields to write, by name. Values are normalised; dates ISO days. */
  fills: { driverId: string; who: string; field: DriverField; value: string }[]
  /** Records to create, by name. */
  records: {
    driverId: string
    who: string
    field: RecordField
    expiresAt: string
  }[]
  /** Both sides hold a value and they differ. Never written. */
  kept: { who: string; field: DriverField; current: string; exported: string }[]
  /** A value the export holds that would not read. */
  unreadable: { who: string; field: FillField; raw: string; why: string }[]
  /** Under this Driver ID the database holds a different person. */
  heldByName: { externalId: string; exported: string; current: string }[]
  /** Export rows with no driver under their id. */
  unmatched: { externalId: string; who: string }[]
}

const nameKey = (first: string, last: string) =>
  `${first} ${last}`.trim().replace(/\s+/g, ' ').toUpperCase()

const dayOf = (date: Date | null) =>
  date ? date.toISOString().slice(0, 10) : null

export function planDriverFill(
  records: readonly Record<string, string>[],
  drivers: readonly CurrentDriver[],
): FillPlan {
  const headers = new Set(Object.keys(records[0] ?? {}))
  const columns = (Object.keys(FILL_COLUMNS) as FillField[]).map((field) => ({
    field,
    header: FILL_COLUMNS[field].find((name) => headers.has(name)) ?? null,
  }))
  const headerOf = new Map(columns.map((c) => [c.field, c.header]))
  const cell = (record: Record<string, string>, field: FillField) => {
    const header = headerOf.get(field)
    return header ? (record[header] ?? '').trim() : ''
  }

  const byExternalId = new Map(
    drivers.filter((d) => d.externalId).map((d) => [d.externalId!, d]),
  )
  const plan: FillPlan = {
    columns,
    fills: [],
    records: [],
    kept: [],
    unreadable: [],
    heldByName: [],
    unmatched: [],
  }

  for (const record of records) {
    const externalId = (record['Driver ID'] ?? '').trim()
    const exportedName =
      `${(record['First name'] ?? '').trim()} ${(record['Last name'] ?? '').trim()}`.trim()
    if (externalId === '') continue
    const driver = byExternalId.get(externalId)
    if (!driver) {
      plan.unmatched.push({ externalId, who: exportedName })
      continue
    }
    const who = `${driver.firstName} ${driver.lastName}`.trim()
    if (
      nameKey(record['First name'] ?? '', record['Last name'] ?? '') !==
      nameKey(driver.firstName, driver.lastName)
    ) {
      plan.heldByName.push({ externalId, exported: exportedName, current: who })
      continue
    }

    /** The export's value for a field, normalised, or null. */
    const read = (field: FillField): string | null => {
      const raw = cell(record, field)
      if (raw === '') return null
      if (field === 'cdlState') {
        const state = resolveState(raw)
        if (state.ok) return state.code
        plan.unreadable.push({
          who,
          field,
          raw,
          why: 'not a state code or a stated state name',
        })
        return null
      }
      if (
        field === 'hireDate' ||
        field === 'cdlExpiresAt' ||
        field === 'medicalExpiresAt'
      ) {
        const day = parseLicenceExpiry(raw)
        if (day.ok) return day.iso
        plan.unreadable.push({ who, field, raw, why: day.why })
        return null
      }
      const text = optionalText(raw)
      return field === 'cdlClass' ? (text?.toUpperCase() ?? null) : text
    }

    const current: Record<DriverField, string | null> = {
      hireDate: dayOf(driver.hireDate),
      cdlNumber: optionalText(driver.cdlNumber),
      cdlState: optionalText(driver.cdlState),
      cdlClass: optionalText(driver.cdlClass),
    }
    for (const field of [
      'hireDate',
      'cdlNumber',
      'cdlState',
      'cdlClass',
    ] as const) {
      const exported = read(field)
      if (exported === null) continue
      const held = current[field]
      if (held === null)
        plan.fills.push({ driverId: driver.id, who, field, value: exported })
      else if (held.toUpperCase() !== exported.toUpperCase())
        plan.kept.push({ who, field, current: held, exported })
    }

    for (const [field, has] of [
      ['cdlExpiresAt', driver.hasCdlRecord],
      ['medicalExpiresAt', driver.hasMedicalRecord],
    ] as const) {
      const expiresAt = read(field)
      if (expiresAt !== null && !has && driver.qualifiable)
        plan.records.push({ driverId: driver.id, who, field, expiresAt })
    }
  }
  return plan
}

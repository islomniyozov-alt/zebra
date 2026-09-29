// ---------------------------------------------------------------------------
// FUEL-CARD CSV IMPORT — THE PART THAT CAN BE WRITTEN WITHOUT THE FORMAT.
//
// Owner's brief, 2026-09-29: "provider format unknown — importer stub that
// names what it needs".
//
// ── WHY A STUB IS THE RIGHT ARTEFACT AND NOT A PLACEHOLDER ────────────────
//
// Nobody has seen the provider's export. The tempting thing is to write a
// parser against the two or three column names a search suggests and let the
// first real file correct it. THAT FAILS SILENTLY AND EXPENSIVELY: a positional
// reader lines up on the wrong column the first time a provider reorders its
// export, and the wrong column is money. It produces a plausible import.
//
// So this declares what it needs, matches headers BY NAME, and refuses a file
// it does not fully recognise — naming the header it could not find. A named
// refusal is a working importer for a format nobody has seen yet. A guess is
// not, and the difference only shows up after the numbers are in the database.
//
// It is the `sed`/`tail` lesson from AGENTS.md in a third place: the failure
// mode that costs sessions is the one that looks like success.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
//
// It does not write. `FuelTransaction` has no column for an invoice amount, a
// fee or a billable flag, and those are the held migration (§6.2.3). Parsing
// into a shape the database cannot yet hold is the useful half, and writing
// half a row is not.
// ---------------------------------------------------------------------------

/** What a fuel-card row has to carry before it is worth anything. */
export const REQUIRED_COLUMNS = [
  'purchasedAt',
  'cardLast4',
  'gallons',
  'retailAmount',
  'invoiceAmount',
] as const

export const OPTIONAL_COLUMNS = [
  'product',
  'fees',
  'unitNumber',
  'driverName',
  'vendorName',
  'city',
  'state',
  'odometer',
] as const

export type RequiredColumn = (typeof REQUIRED_COLUMNS)[number]
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]

/**
 * The header spellings seen so far, per column.
 *
 * EMPTY FOR EVERY COLUMN UNTIL A REAL FILE ARRIVES, and that is the honest
 * state: these are observations, and there are none. The first real export
 * adds its spellings here, in a commit that says which provider and which
 * file — so the list stays a record of what has actually been seen rather
 * than a list of what somebody imagined a provider might call a column.
 */
export const KNOWN_HEADERS: Record<RequiredColumn | OptionalColumn, string[]> =
  {
    purchasedAt: [],
    cardLast4: [],
    gallons: [],
    retailAmount: [],
    invoiceAmount: [],
    product: [],
    fees: [],
    unitNumber: [],
    driverName: [],
    vendorName: [],
    city: [],
    state: [],
    odometer: [],
  }

export interface FuelImportRow {
  purchasedAt: string
  cardLast4: string
  gallons: string
  retailAmount: string
  invoiceAmount: string
  optional: Partial<Record<OptionalColumn, string>>
}

export type FuelImportResult =
  | { ok: true; rows: FuelImportRow[] }
  | {
      ok: false
      reason: 'empty_file' | 'unmapped_columns' | 'no_mapping_configured'
      /** The required columns no header in the file could be matched to. */
      missing: RequiredColumn[]
      /** The file's own headers, so the reader can see what it DID have. */
      headers: string[]
    }

/** Split one CSV line, honouring double quotes. Enough for a header row. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      out.push(field)
      field = ''
    } else {
      field += char
    }
  }
  out.push(field)
  return out
}

const normalise = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')

/**
 * Parse a fuel-card export.
 *
 * REFUSES EVERY FILE TODAY, by construction: `KNOWN_HEADERS` is empty, so no
 * required column can be matched and the result names all five. That is not a
 * bug to be fixed later — it is the stub doing its job, and the refusal is the
 * thing that tells whoever has the first real export exactly which five
 * columns to map. It starts working the moment somebody adds the spellings,
 * and it never starts working by accident.
 */
export function parseFuelCsv(text: string): FuelImportResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) {
    return { ok: false, reason: 'empty_file', missing: [], headers: [] }
  }

  // `?? ''` ONLY TO SATISFY THE INDEX CHECK — the guard above has already
  // established that `lines` is non-empty, so this can never be the fallback.
  const headers = splitCsvLine(lines[0] ?? '').map((header) => header.trim())
  const seen = new Map(
    headers.map((header, index) => [normalise(header), index]),
  )

  const indexFor = (column: RequiredColumn | OptionalColumn): number | null => {
    for (const spelling of KNOWN_HEADERS[column]) {
      const index = seen.get(normalise(spelling))
      if (index !== undefined) return index
    }
    return null
  }

  const mapped = new Map<RequiredColumn | OptionalColumn, number>()
  const missing: RequiredColumn[] = []
  for (const column of REQUIRED_COLUMNS) {
    const index = indexFor(column)
    if (index === null) missing.push(column)
    else mapped.set(column, index)
  }

  if (missing.length > 0) {
    // NO SPELLINGS AT ALL IS A DIFFERENT SENTENCE from "your file is missing a
    // column". The first is about this repository, the second is about the
    // file somebody just chose, and telling a user to fix their export when
    // the mapping was never configured would send them looking in the one
    // place the problem is not.
    const configured = REQUIRED_COLUMNS.some(
      (column) => KNOWN_HEADERS[column].length > 0,
    )
    return {
      ok: false,
      reason: configured ? 'unmapped_columns' : 'no_mapping_configured',
      missing,
      headers,
    }
  }

  for (const column of OPTIONAL_COLUMNS) {
    const index = indexFor(column)
    if (index !== null) mapped.set(column, index)
  }

  const at = (cells: string[], column: RequiredColumn | OptionalColumn) => {
    const index = mapped.get(column)
    return index === undefined ? undefined : (cells[index] ?? '').trim()
  }

  const rows: FuelImportRow[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const optional: Partial<Record<OptionalColumn, string>> = {}
    for (const column of OPTIONAL_COLUMNS) {
      const value = at(cells, column)
      if (value !== undefined && value !== '') optional[column] = value
    }
    rows.push({
      purchasedAt: at(cells, 'purchasedAt') ?? '',
      cardLast4: at(cells, 'cardLast4') ?? '',
      gallons: at(cells, 'gallons') ?? '',
      retailAmount: at(cells, 'retailAmount') ?? '',
      invoiceAmount: at(cells, 'invoiceAmount') ?? '',
      optional,
    })
  }

  return { ok: true, rows }
}

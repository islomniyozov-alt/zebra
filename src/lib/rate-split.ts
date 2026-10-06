import type { AccessorialType } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE RATE FIELD IS THE LINE HAUL (§7.6, owner's ruling 2026-10-06, load 1177).
//
// A rate confirmation prints a line haul, usually a fuel surcharge, sometimes
// accessorial lines, and a total. Until migration 68 the create form prefilled
// the rate field from the TOTAL and the action stored that as `linehaulCents`,
// so fuel and detention became line haul and `PERCENT_LINEHAUL` paid on them:
// 1177 paid $887.25 under a 30% rule that should have paid $735.00.
//
// This is the one place the extraction's parsed money becomes the load's four
// columns. It is pure, so the action that calls it stays a form reader and the
// rule can be tested without standing up an auth context (AGENTS.md: domain
// logic in src/lib).
//
// ── ONLY WHEN THE PARTS AGREE WITH THE TOTAL ──────────────────────────────
//
// `parse.ts` already answers that: `totalAgrees` is true when line haul + fuel
// + the accessorial lines equal the printed total. A split that does not add up
// is a question for a person, not data for a column, so this returns null and
// the form shows an EMPTY rate field with the total in the hint.
// ---------------------------------------------------------------------------

/** `extractedJson.money`, as `parse.ts` stores it: integer cents or null. */
export interface StoredMoney {
  linehaulCents: number | null
  fuelSurchargeCents: number | null
  totalCents: number | null
  totalAgrees: boolean | null
  accessorials: readonly { label: string; cents: number }[]
}

export interface RateSplit {
  linehaulCents: number
  fuelSurchargeCents: number
  accessorials: readonly {
    type: AccessorialType
    amountCents: number
    label: string
  }[]
}

/**
 * The accessorial type a rate con's own words name, or OTHER.
 *
 * Matched on the printed label, case-insensitively, first keyword wins. The
 * label itself is kept on the row as the note, so an OTHER still says what it
 * was — "Detention (2 hrs)" is the artefact and the type is the index.
 */
export function accessorialTypeFor(label: string): AccessorialType {
  const text = label.toLowerCase()
  const rules: [RegExp, AccessorialType][] = [
    [/detention/, 'DETENTION'],
    [/layover/, 'LAYOVER'],
    [/tonu|truck ordered not used/, 'TONU'],
    [/lumper/, 'LUMPER'],
    [/extra stop|additional stop|stop[- ]off/, 'EXTRA_STOP'],
    [/driver assist|driver unload|driver load/, 'DRIVER_ASSIST'],
    [/redeliver/, 'REDELIVERY'],
    [/storage/, 'STORAGE'],
    [/fuel advance/, 'FUEL_ADVANCE_FEE'],
  ]
  for (const [pattern, type] of rules) {
    if (pattern.test(text)) return type
  }
  return 'OTHER'
}

/**
 * The split a load takes from its rate con, or null when there is none to take.
 *
 * Null when the extraction printed no line haul, or when its parts do not agree
 * with its total. A total alone is not a line haul — that reading is the defect
 * this replaces.
 */
export function rateSplitFromMoney(
  money: StoredMoney | null,
): RateSplit | null {
  if (!money) return null
  if (money.linehaulCents === null || money.linehaulCents < 0) return null
  if (money.totalAgrees !== true) return null
  return {
    linehaulCents: money.linehaulCents,
    fuelSurchargeCents: money.fuelSurchargeCents ?? 0,
    accessorials: money.accessorials
      .filter((line) => line.cents > 0)
      .map((line) => ({
        type: accessorialTypeFor(line.label),
        amountCents: line.cents,
        label: line.label,
      })),
  }
}

/**
 * `extractedJson` as the mint and the document store it, narrowed to the money.
 * Anything that is not the shape `parse.ts` writes reads as "no money".
 */
export function storedMoneyOf(extractedJson: unknown): StoredMoney | null {
  if (!extractedJson || typeof extractedJson !== 'object') return null
  const money = (extractedJson as { money?: unknown }).money
  if (!money || typeof money !== 'object') return null
  const m = money as Record<string, unknown>
  const cents = (value: unknown): number | null =>
    typeof value === 'number' && Number.isInteger(value) ? value : null
  const lines = Array.isArray(m['accessorials']) ? m['accessorials'] : []
  return {
    linehaulCents: cents(m['linehaulCents']),
    fuelSurchargeCents: cents(m['fuelSurchargeCents']),
    totalCents: cents(m['totalCents']),
    totalAgrees:
      typeof m['totalAgrees'] === 'boolean' ? m['totalAgrees'] : null,
    accessorials: lines.flatMap((line) => {
      if (!line || typeof line !== 'object') return []
      const row = line as Record<string, unknown>
      const amount = cents(row['cents'])
      if (amount === null) return []
      return [
        {
          label:
            typeof row['label'] === 'string' ? row['label'] : 'accessorial',
          cents: amount,
        },
      ]
    }),
  }
}

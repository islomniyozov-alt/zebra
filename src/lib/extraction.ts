import { MoneyFormatError, parseMoneyToCents } from './money'
import {
  CONFIDENCES,
  type Confidence,
  type Extracted,
  type ExtractedStop,
  type Field,
  type Maybe,
} from './extraction-shape'
import type { EquipmentType, StopType } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// PARSING WHAT THE MODEL SAID (Phase 5 §3 step 1).
//
// §1.2: "a response that doesn't parse is a failed extraction, never a
// half-filled form." So this is deliberately unforgiving. Every refusal below
// is a real shape a language model produces on a bad day:
//
//   * prose wrapped around the JSON, or a ```json fence;
//   * a bare value where a `{value, confidence}` object belongs;
//   * `"confidence": 0.82` instead of one of the three words;
//   * an equipment type the enum does not have;
//   * `"weightLbs": {"value": "42,000"}` — a number as a string.
//
// The alternative to refusing is a form with four fields filled and one
// silently wrong, which is worse than a form with none: the dispatcher checks
// what they typed and trusts what appeared.
//
// MONEY IS PARSED HERE AND NOWHERE ELSE IN THIS PIPELINE. The model returns the
// printed string; `parseMoneyToCents` turns it into integer cents (rule
// 9-money). A figure that does not parse is dropped with its reason rather than
// guessed at — a rate that silently becomes 0 is the failure the whole rule
// exists to prevent.
// ---------------------------------------------------------------------------

export type ParseFailure =
  | 'not_json'
  | 'not_an_object'
  | 'missing_field'
  | 'bad_field_shape'
  | 'bad_confidence'
  | 'bad_value_type'
  | 'bad_enum'
  | 'stops_not_an_array'
  | 'money_missing'

export class ExtractionParseError extends Error {
  constructor(
    readonly reason: ParseFailure,
    readonly path: string,
  ) {
    super(`extraction ${reason} at ${path}`)
    this.name = 'ExtractionParseError'
  }
}

const EQUIPMENT: readonly EquipmentType[] = [
  'DRY_VAN',
  'REEFER',
  'FLATBED',
  'STEP_DECK',
  'POWER_ONLY',
  'TANKER',
  'CONTAINER',
  'OTHER',
]

const STOP_TYPES: readonly StopType[] = ['PICKUP', 'DELIVERY']

type Json = Record<string, unknown>

/**
 * The model's text, as an object.
 *
 * A fenced block is unwrapped — models emit ```json around structured output
 * often enough that refusing it would be refusing a correct answer for its
 * packaging. Anything else that is not JSON is a failed extraction.
 */
export function parseResponseText(text: string): Json {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = (fenced?.[1] ?? text).trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new ExtractionParseError('not_json', '$')
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ExtractionParseError('not_an_object', '$')
  }
  return parsed as Json
}

/** `{value, confidence}` or null. Anything else is a refusal, not a coercion. */
function readField<T>(
  parent: Json,
  key: string,
  path: string,
  check: (value: unknown, at: string) => T,
): Maybe<T> {
  if (!Object.hasOwn(parent, key)) {
    throw new ExtractionParseError('missing_field', `${path}.${key}`)
  }

  const raw = parent[key]
  if (raw === null || raw === undefined) return null

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    // A bare `"CHICAGO"` where `{value, confidence}` belongs. Accepting it
    // would mean inventing a confidence, and an invented confidence is
    // indistinguishable from a measured one on the screen.
    throw new ExtractionParseError('bad_field_shape', `${path}.${key}`)
  }

  const object = raw as Json
  const confidence = object['confidence']
  if (
    typeof confidence !== 'string' ||
    !CONFIDENCES.includes(confidence as Confidence)
  ) {
    throw new ExtractionParseError('bad_confidence', `${path}.${key}`)
  }

  const value = check(object['value'], `${path}.${key}`)
  const note = object['note']

  return {
    value,
    confidence: confidence as Confidence,
    ...(typeof note === 'string' && note !== '' ? { note } : {}),
  }
}

const asString = (value: unknown, at: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ExtractionParseError('bad_value_type', at)
  }
  return value.trim()
}

const asNumber = (value: unknown, at: string): number => {
  // A NUMBER, not a numeric string. "42,000" from a model is a formatting
  // decision it was not asked to make, and Number("42,000") is NaN — which
  // would land as a blank field nobody could explain.
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ExtractionParseError('bad_value_type', at)
  }
  return value
}

const asBoolean = (value: unknown, at: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new ExtractionParseError('bad_value_type', at)
  }
  return value
}

const asEnum =
  <T extends string>(allowed: readonly T[]) =>
  (value: unknown, at: string): T => {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      throw new ExtractionParseError('bad_enum', at)
    }
    return value as T
  }

function readStop(raw: unknown, path: string): ExtractedStop {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ExtractionParseError('bad_field_shape', path)
  }
  const stop = raw as Json

  return {
    type: readField(stop, 'type', path, asEnum(STOP_TYPES)),
    name: readField(stop, 'name', path, asString),
    addressLine1: readField(stop, 'addressLine1', path, asString),
    addressLine2: readField(stop, 'addressLine2', path, asString),
    city: readField(stop, 'city', path, asString),
    state: readField(stop, 'state', path, asString),
    postalCode: readField(stop, 'postalCode', path, asString),
    scheduledAt: readField(stop, 'scheduledAt', path, asString),
    windowStart: readField(stop, 'windowStart', path, asString),
    windowEnd: readField(stop, 'windowEnd', path, asString),
    referenceNumber: readField(stop, 'referenceNumber', path, asString),
    contactName: readField(stop, 'contactName', path, asString),
    contactPhone: readField(stop, 'contactPhone', path, asString),
    instructions: readField(stop, 'instructions', path, asString),
  }
}

/** The model's response, as the shape the rest of the phase reads. */
export function parseExtraction(text: string): Extracted {
  const root = parseResponseText(text)

  const stopsRaw = root['stops']
  if (!Array.isArray(stopsRaw)) {
    throw new ExtractionParseError('stops_not_an_array', '$.stops')
  }

  const moneyRaw = root['money']
  if (moneyRaw === null || typeof moneyRaw !== 'object') {
    throw new ExtractionParseError('money_missing', '$.money')
  }
  const money = moneyRaw as Json

  const accessorialsRaw = money['accessorials']
  if (!Array.isArray(accessorialsRaw)) {
    throw new ExtractionParseError('stops_not_an_array', '$.money.accessorials')
  }

  return {
    brokerName: readField(root, 'brokerName', '$', asString),
    brokerReference: readField(root, 'brokerReference', '$', asString),
    bolNumber: readField(root, 'bolNumber', '$', asString),
    poNumber: readField(root, 'poNumber', '$', asString),
    commodity: readField(root, 'commodity', '$', asString),
    weightLbs: readField(root, 'weightLbs', '$', asNumber),
    pieces: readField(root, 'pieces', '$', asNumber),
    pallets: readField(root, 'pallets', '$', asNumber),
    equipmentType: readField(root, 'equipmentType', '$', asEnum(EQUIPMENT)),
    tempF: readField(root, 'tempF', '$', asNumber),
    isHazmat: readField(root, 'isHazmat', '$', asBoolean),
    isTeam: readField(root, 'isTeam', '$', asBoolean),
    sealNumber: readField(root, 'sealNumber', '$', asString),
    instructions: readField(root, 'instructions', '$', asString),
    stops: stopsRaw.map((stop, index) => readStop(stop, `$.stops[${index}]`)),
    money: {
      linehaul: readField(money, 'linehaul', '$.money', asString),
      fuelSurcharge: readField(money, 'fuelSurcharge', '$.money', asString),
      total: readField(money, 'total', '$.money', asString),
      accessorials: accessorialsRaw.map((item, index) => {
        const path = `$.money.accessorials[${index}]`
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          throw new ExtractionParseError('bad_field_shape', path)
        }
        const entry = item as Json
        return {
          description: readField(entry, 'description', path, asString),
          amount: readField(entry, 'amount', path, asString),
        }
      }),
    },
  }
}

// --- money, once, through money.ts -------------------------------------------

export interface MoneyLine {
  label: string
  /** Integer cents. The only representation anything downstream sees. */
  cents: number
  confidence: Confidence
  /** Exactly as printed, kept so a person can check the parse. */
  printed: string
}

export interface ExtractedMoneyCents {
  linehaulCents: number | null
  fuelSurchargeCents: number | null
  totalCents: number | null
  accessorials: MoneyLine[]
  /**
   * Figures the document carried that could not be read as amounts.
   *
   * Reported rather than dropped: "$1,8S0.00" with an O for a zero is a
   * scanning artefact somebody should see, and a silent omission would look
   * like a document that simply had no rate on it.
   */
  unreadable: { label: string; printed: string }[]
  /**
   * Whether the parts add up to the printed total.
   *
   * Null when either side is missing. FALSE is not an error — brokers print
   * totals that disagree with their own line items — but it is the single most
   * useful thing to show an accountant, so it is computed once here rather
   * than in whichever screen thinks to.
   */
  totalAgrees: boolean | null
  differenceCents: number | null
}

/**
 * Every money figure the model read, as integer cents.
 *
 * The one place in the extraction pipeline where a dollar becomes a number
 * (rule 9-money). Nothing here rounds: `parseMoneyToCents` truncates a third
 * decimal because a third decimal in a printed rate is a typo, and that
 * decision lives in money.ts where it is tested.
 */
export function moneyToCents(extracted: Extracted): ExtractedMoneyCents {
  const unreadable: { label: string; printed: string }[] = []

  const read = (label: string, field: Maybe<string>): number | null => {
    if (!field) return null
    try {
      const cents = parseMoneyToCents(field.value)
      // A negative linehaul is not a rate. It is a misread minus or a credit
      // memo somebody attached to the wrong pile; either way it is not a value
      // to prefill a form with.
      if (cents < 0) {
        unreadable.push({ label, printed: field.value })
        return null
      }
      return cents
    } catch (error) {
      if (error instanceof MoneyFormatError) {
        unreadable.push({ label, printed: field.value })
        return null
      }
      throw error
    }
  }

  const linehaulCents = read('linehaul', extracted.money.linehaul)
  const fuelSurchargeCents = read(
    'fuelSurcharge',
    extracted.money.fuelSurcharge,
  )
  const totalCents = read('total', extracted.money.total)

  const accessorials: MoneyLine[] = []
  for (const [index, line] of extracted.money.accessorials.entries()) {
    if (!line.amount) continue
    const label = line.description?.value ?? `accessorial ${index + 1}`
    const cents = read(label, line.amount)
    if (cents === null) continue
    accessorials.push({
      label,
      cents,
      // The amount's confidence, not the description's: the number is what
      // gets typed into a rate, and it is the number a reviewer is checking.
      confidence: line.amount.confidence,
      printed: line.amount.value,
    })
  }

  const parts =
    (linehaulCents ?? 0) +
    (fuelSurchargeCents ?? 0) +
    accessorials.reduce((sum, line) => sum + line.cents, 0)

  const haveParts = linehaulCents !== null || accessorials.length > 0
  const totalAgrees =
    totalCents === null || !haveParts ? null : parts === totalCents

  return {
    linehaulCents,
    fuelSurchargeCents,
    totalCents,
    accessorials,
    unreadable,
    totalAgrees,
    differenceCents:
      totalCents === null || !haveParts ? null : totalCents - parts,
  }
}

// --- what a dispatcher is allowed to see --------------------------------------

/** The extraction with every money field removed. Not blanked — removed. */
export type ExtractedWithoutMoney = Omit<Extracted, 'money'>

/**
 * §1.3: "A DISPATCHER's prefill contains no money."
 *
 * The money key is DELETED rather than emptied, so a payload serialized for a
 * dispatcher has no `money` in it at all — the same rule as every other
 * money-on-an-operational-screen field since Phase 3, and the same reason:
 * leaving it out is the only version that survives somebody reading the
 * network tab.
 *
 * Step 2 calls this; it lives here so the rule is next to the data it governs
 * rather than in whichever screen remembers.
 */
export function withoutMoney(extracted: Extracted): ExtractedWithoutMoney {
  const { money: _money, ...rest } = extracted
  return rest
}

/** Every field the model was unsure about, for the form to mark (§3 step 2). */
export function lowConfidenceFields(extracted: Extracted): string[] {
  const found: string[] = []

  const check = (path: string, field: Maybe<unknown>) => {
    if (field && field.confidence === 'low') found.push(path)
  }

  for (const [key, value] of Object.entries(extracted)) {
    if (key === 'stops' || key === 'money') continue
    check(key, value as Maybe<unknown>)
  }

  for (const [index, stop] of extracted.stops.entries()) {
    for (const [key, value] of Object.entries(stop)) {
      check(`stops[${index}].${key}`, value as Maybe<unknown>)
    }
  }

  // Money included, because the rate panel marks its own low-confidence values
  // for ACCOUNTING even though the dispatcher never sees them.
  check('money.linehaul', extracted.money.linehaul)
  check('money.fuelSurcharge', extracted.money.fuelSurcharge)
  check('money.total', extracted.money.total)

  return found
}

/** A `Field` helper for tests and fixtures. Not used by the parser. */
export function field<T>(value: T, confidence: Confidence = 'high'): Field<T> {
  return { value, confidence }
}

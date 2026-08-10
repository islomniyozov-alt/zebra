// ---------------------------------------------------------------------------
// SCORING ONE DOCUMENT AGAINST ONE SHEET (Phase 5 §5).
//
// Separated from the run so it can be tested without a network, a browser or a
// corpus — `tests/accuracy-score.test.ts`. An acceptance instrument that is
// itself unverified measures nothing twice: it produces a number, and the
// number's only evidence is that the code looked right.
// ---------------------------------------------------------------------------

/**
 * The extraction, flattened to the sheet's own key shape.
 *
 * MONEY COMES FROM `money`, NOT FROM `extracted`. The sheet stores cents,
 * because cents are what the system stores and therefore what an accuracy claim
 * about money has to be about — and `body.money` is what money.ts parsed, so
 * comparing against it is comparing the number that would have been saved.
 */
export function flatten(extracted, money) {
  const flat = {}
  if (!extracted) return flat

  for (const [key, field] of Object.entries(extracted)) {
    if (key === 'stops' || key === 'money') continue
    flat[key] = field?.value ?? null
  }
  for (const [index, stop] of (extracted.stops ?? []).entries()) {
    for (const [key, field] of Object.entries(stop ?? {})) {
      flat[`stops[${index}].${key}`] = field?.value ?? null
    }
  }
  flat['money.linehaulCents'] = money?.linehaulCents ?? null
  flat['money.fuelSurchargeCents'] = money?.fuelSurchargeCents ?? null
  flat['money.totalCents'] = money?.totalCents ?? null
  return flat
}

/** Two values are the same answer, or they are not. */
export function normalize(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  // Dates as the document printed them, trimmed to the minute: a model that
  // answers "2026-08-14T07:00" and truth of "2026-08-14T07:00:00" agree.
  //
  // ONLY A SECONDS COMPONENT. The first version stripped any trailing ":00",
  // which turned 07:00 into 07 — so a document scheduled at seven and one
  // scheduled at seven o'clock exactly scored as different answers, and the
  // instrument's own test is what caught it.
  return String(value)
    .trim()
    .replace(/(T\d{2}:\d{2}):00$/, '$1')
    .toUpperCase()
}

/**
 * One document's outcome, per field.
 *
 * Four answers rather than right/wrong, because they call for different fixes:
 * a MISSED field is a prompt that did not ask clearly enough, an INVENTED one
 * is a model filling a blank it should have left, and a WRONG one is a reading
 * error. Collapsing them into a percentage throws away which.
 *
 * An agreed absence is not scored at all: "the document has no PO and the model
 * said none" is right, and counting it would inflate every rate with the fields
 * documents mostly do not carry.
 */
export function scoreDocument(sheetFields, got) {
  const outcomes = []
  for (const [field, entry] of Object.entries(sheetFields ?? {})) {
    const truth = normalize(entry.truth)
    const actual = normalize(got[field])
    if (truth === null && actual === null) continue
    if (truth === null) outcomes.push([field, 'invented'])
    else if (actual === null) outcomes.push([field, 'missed'])
    else if (truth === actual) outcomes.push([field, 'right'])
    else outcomes.push([field, 'wrong'])
  }
  return outcomes
}

/**
 * A document the reader REFUSED scores zero on every field it should have had.
 *
 * Leaving it out would make the corpus smaller and the number better, which is
 * the most comfortable way to publish a wrong one.
 */
export function scoreRefusal(sheetFields) {
  return Object.entries(sheetFields ?? {})
    .filter(([, entry]) => entry.truth !== null && entry.truth !== undefined)
    .map(([field]) => [field, 'missed'])
}

/** Outcomes, per field, worst first — which is the order somebody fixes them. */
export function accuracyTable(outcomes) {
  const tally = new Map()
  for (const [field, outcome] of outcomes) {
    const row = tally.get(field) ?? {
      right: 0,
      wrong: 0,
      missed: 0,
      invented: 0,
    }
    row[outcome] += 1
    tally.set(field, row)
  }
  return [...tally.entries()]
    .map(([field, row]) => {
      const total = row.right + row.wrong + row.missed + row.invented
      return { field, ...row, total, rate: total ? row.right / total : 1 }
    })
    .sort((a, b) => a.rate - b.rate || a.field.localeCompare(b.field))
}

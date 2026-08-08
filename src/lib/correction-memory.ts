import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// CORRECTION MEMORY (Phase 5 §3 step 3).
//
// §1.4, which is a restraint rather than a feature: "'Learning' is data, not
// ML. Broker-name aliases and facility memory, written on dispatcher
// correction, applied on the next upload. No fine-tuning, no models trained."
//
// So there is nothing here that scores, weights or decays. A dispatcher types
// over an extracted broker name; the string they typed over is remembered
// against the customer they chose; the next upload of that string resolves. If
// it is ever wrong, they type over it again and the row is replaced. That is
// the whole mechanism, and it is legible to somebody reading two tables.
//
// THE CORRECTION LOG CHANGES NOTHING. §3 step 3: "the raw material for §5's
// accuracy numbers and nothing more." It is written beside the alias and read
// by the accuracy run, and no code path consults it to decide anything — which
// is what keeps "learning" honest here.
// ---------------------------------------------------------------------------

/**
 * A broker name folded for comparison.
 *
 * CASE AND SPACING ONLY, and the restraint is the point. "ITS Logistics LLC"
 * and "ITS National LLC" are two of this carrier's real brokers; a
 * normalisation that stripped legal suffixes to be clever would fold them into
 * one and route a load to the wrong customer. Punctuation goes because
 * "Big M II, Inc." and "Big M II Inc" are the same broker on two documents —
 * that much is observable in the corpus and nothing further is.
 */
export function normalizeAlias(name: string): string {
  return name.trim().toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ')
}

export interface ResolvedBroker {
  customerId: string
  name: string
  /** How it was found. The screen says different things about each. */
  via: 'alias' | 'exact'
}

/**
 * Which Customer an extracted broker string means, if anything.
 *
 * Alias first, then an exact fold of the customer's own name — so a broker
 * already in the book resolves without anybody having taught anything, and a
 * name only this carrier's paperwork uses resolves because somebody did.
 *
 * Returns null rather than a best guess. A near-match offered as an answer is
 * how a load ends up invoiced to the wrong company, and the form's own
 * create-on-miss already handles "this is somebody new" gracefully.
 */
export async function resolveBroker(
  tx: TxClient,
  extractedName: string,
): Promise<ResolvedBroker | null> {
  const normalized = normalizeAlias(extractedName)
  if (normalized === '') return null

  const alias = await tx.customerAlias.findFirst({
    where: { normalized },
    select: { customerId: true, customer: { select: { name: true } } },
  })
  if (alias) {
    return {
      customerId: alias.customerId,
      name: alias.customer.name,
      via: 'alias',
    }
  }

  // `mode: 'insensitive'` rather than a stored fold on Customer: the customer
  // table is not this feature's to reshape, and one broker lookup per upload
  // does not need an index it would have to be given.
  const customer = await tx.customer.findFirst({
    where: { name: { equals: extractedName.trim(), mode: 'insensitive' } },
    select: { id: true, name: true },
  })
  if (customer) {
    return { customerId: customer.id, name: customer.name, via: 'exact' }
  }

  return null
}

/**
 * Remember that this printed name means this customer.
 *
 * Upserted, so correcting the same string twice replaces the answer rather
 * than adding a second one — the unique index would refuse the second anyway,
 * and a refusal here would fail a save the dispatcher has already made.
 *
 * NOT WRITTEN WHEN THE NAME ALREADY MATCHED. An alias recording that
 * "Werner Logistics" means the customer called Werner Logistics teaches
 * nothing and would grow a row per load forever.
 */
export async function learnAlias(
  tx: TxClient,
  input: {
    organizationId: string
    extractedName: string
    customerId: string
    customerName: string
    userId?: string | null
  },
): Promise<'learned' | 'unchanged' | 'redundant'> {
  const normalized = normalizeAlias(input.extractedName)
  if (normalized === '') return 'unchanged'
  if (normalized === normalizeAlias(input.customerName)) return 'redundant'

  const existing = await tx.customerAlias.findFirst({
    where: { normalized },
    select: { id: true, customerId: true },
  })

  if (existing?.customerId === input.customerId) return 'unchanged'

  if (existing) {
    await tx.customerAlias.update({
      where: { id: existing.id },
      data: {
        customerId: input.customerId,
        alias: input.extractedName.trim(),
        learnedByUserId: input.userId ?? null,
        // The count restarts: it counts uses of THIS answer, and the answer
        // just changed.
        timesApplied: 0,
      },
    })
    return 'learned'
  }

  await tx.customerAlias.create({
    data: {
      organizationId: input.organizationId,
      customerId: input.customerId,
      alias: input.extractedName.trim(),
      normalized,
      learnedByUserId: input.userId ?? null,
    },
  })
  return 'learned'
}

/** Count a use. Best-effort: a lost increment is a statistic, not a fact. */
export async function noteAliasApplied(
  tx: TxClient,
  normalized: string,
): Promise<void> {
  await tx.customerAlias.updateMany({
    where: { normalized },
    data: { timesApplied: { increment: 1 } },
  })
}

// --- the correction log --------------------------------------------------------

export interface CorrectionInput {
  organizationId: string
  loadId?: string | null
  documentId?: string | null
  userId?: string | null
  /** Dotted path -> what the model said, and what it was changed to. */
  changes: {
    field: string
    extracted: string | null
    corrected: string | null
    confidence?: string | null
  }[]
}

/**
 * Record what somebody typed over.
 *
 * BOTH SIDES OF EVERY ROW. A log of new values answers "what is it now", and
 * §5's accuracy table asks "what was wrong" — which needs the old one. A field
 * the extraction left null and a person filled in is a correction too: the
 * model missing something is exactly as interesting as the model being wrong
 * about it.
 */
export async function recordCorrections(
  tx: TxClient,
  input: CorrectionInput,
): Promise<number> {
  const real = input.changes.filter(
    (change) => (change.extracted ?? '') !== (change.corrected ?? ''),
  )
  if (real.length === 0) return 0

  await tx.extractionCorrection.createMany({
    data: real.map((change) => ({
      organizationId: input.organizationId,
      loadId: input.loadId ?? null,
      documentId: input.documentId ?? null,
      field: change.field,
      extractedValue: change.extracted,
      correctedValue: change.corrected,
      confidence: change.confidence ?? null,
      correctedByUserId: input.userId ?? null,
    })),
  })

  return real.length
}

/**
 * The fields a saved load disagrees with its extraction about.
 *
 * Comparing SAVED values against EXTRACTED ones, both as the strings a person
 * would have seen, because that is the comparison a correction is. The
 * extraction is read from the server's own copy — never from the browser — so
 * a dispatcher's client cannot restate what the model said, and the money
 * fields are compared even though that same dispatcher never saw them.
 */
export function diffExtraction(
  extracted: Record<string, unknown> | null,
  saved: Record<string, string | null>,
): CorrectionInput['changes'] {
  if (!extracted) return []

  const changes: CorrectionInput['changes'] = []

  const read = (
    path: string,
  ): { value: string | null; confidence: string | null } => {
    // `stops[n].place` — the field the FORM actually has, assembled the way the
    // form assembles it. The create screen shows one "Salem, OR" input, not a
    // city and a state; comparing what somebody left in it against the city
    // alone reported a correction on every load that was never corrected, which
    // is how an accuracy table becomes a load count.
    const place = /^stops\[(\d+)\]\.place$/.exec(path)
    if (place) {
      const stopRow = (extracted['stops'] as Record<string, unknown>[])?.[
        Number(place[1])
      ]
      const field = (key: string) =>
        stopRow?.[key] as { value?: unknown; confidence?: string } | undefined
      const city = field('city')
      if (!city?.value) return { value: null, confidence: null }
      const state = field('state')
      return {
        value: state?.value
          ? `${String(city.value)}, ${String(state.value)}`
          : String(city.value),
        confidence: city.confidence ?? null,
      }
    }

    const stop = /^stops\[(\d+)\]\.(\w+)$/.exec(path)
    const money = /^money\.(\w+)$/.exec(path)

    const raw = stop
      ? ((extracted['stops'] as Record<string, unknown>[] | undefined)?.[
          Number(stop[1])
        ]?.[stop[2]!] ?? null)
      : money
        ? ((extracted['money'] as Record<string, unknown> | undefined)?.[
            money[1]!
          ] ?? null)
        : (extracted[path] ?? null)

    if (!raw || typeof raw !== 'object')
      return { value: null, confidence: null }
    const field = raw as { value: unknown; confidence?: string }
    return {
      value:
        field.value === null || field.value === undefined
          ? null
          : String(field.value),
      confidence: field.confidence ?? null,
    }
  }

  for (const [field, corrected] of Object.entries(saved)) {
    const { value, confidence } = read(field)

    // DIFFERENCES ONLY, which is what the name promises. The first version
    // returned every field and left the filtering to `recordCorrections`, so a
    // function called `diff` answered "here is everything" — and a caller
    // reading its result to count corrections would have counted loads.
    // `recordCorrections` still filters, because a backstop that agrees costs
    // nothing and a direct caller may appear.
    if ((value ?? '') === (corrected ?? '')) continue

    changes.push({ field, extracted: value, corrected, confidence })
  }

  return changes
}

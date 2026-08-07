import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TARGETS } from '@/lib/documents'

// ---------------------------------------------------------------------------
// EVERY UPLOAD TARGET MUST NAME A REAL MODEL AND A REAL COLUMN.
//
// `TARGETS[entity].model` is used as a PRISMA DELEGATE KEY — `tx[target.model]`
// — and `TARGETS[entity].column` is written straight into a `Document` create.
// Neither is checked against the schema by the compiler, so a wrong string
// compiles cleanly and throws at runtime, on the one path nobody exercises
// until a user tries it.
//
// That is exactly what happened. `maintenance` was mapped to a model named
// `maintenance`; the model is `MaintenanceRecord`, so the delegate is
// `maintenanceRecord`, and uploading a maintenance receipt would have crashed
// on `undefined.findUnique`. It went unnoticed because no screen had ever
// uploaded one — until Phase 4 step 3 needed to.
//
// READ FROM schema.prisma, not from the generated client: the schema is the
// source of truth, the client cannot be constructed without an adapter, and a
// hand-written list here would be the same kind of promise that broke.
// ---------------------------------------------------------------------------

const schema = readFileSync(
  join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
)

/** Model names as Prisma spells them: `MaintenanceRecord`, `Document`. */
const MODELS = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!)

/** The delegate is the model with a lowercase initial. */
const DELEGATES = new Set(
  MODELS.map((name) => name[0]!.toLowerCase() + name.slice(1)),
)

/** Every field declared on `Document`. */
const DOCUMENT_FIELDS = new Set(
  [
    ...(/^model\s+Document\s*\{([\s\S]*?)^\}/m
      .exec(schema)?.[1]
      ?.matchAll(/^\s{2}(\w+)\s+\S/gm) ?? []),
  ].map((m) => m[1]!),
)

describe('document upload targets', () => {
  const entries = Object.entries(TARGETS)

  it('read the schema at all', () => {
    // If the parsing above silently found nothing, every assertion below would
    // pass for the wrong reason.
    expect(MODELS).toContain('MaintenanceRecord')
    expect(MODELS).toContain('Document')
    expect(DOCUMENT_FIELDS.size).toBeGreaterThan(10)
    expect(entries.length).toBeGreaterThan(5)
  })

  it('names a model the client actually has', () => {
    const missing = entries
      .filter(([, target]) => !DELEGATES.has(target.model))
      .map(([entity, target]) => `${entity} -> ${target.model}`)

    expect(missing, missing.join(', ')).toEqual([])
  })

  it('names a column that exists on Document', () => {
    const missing = entries
      .filter(([, target]) => !DOCUMENT_FIELDS.has(target.column))
      .map(([entity, target]) => `${entity} -> ${target.column}`)

    expect(missing, missing.join(', ')).toEqual([])
  })
})

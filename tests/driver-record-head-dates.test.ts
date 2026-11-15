import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DATE_FIELDS } from '@/lib/driver-record-head'

// ---------------------------------------------------------------------------
// THE RECORD'S WHOLE-ROW READS NAME THEIR DATE COLUMNS (§6.4 part 2 v11.07).
//
// `readDriverRecordHead` reads Driver, RecurringDeduction and
// DriverOpeningBalance whole, as JSON, and turns their timestamps back into
// Dates BY NAME. A DateTime column added to one of those models and not to
// `DATE_FIELDS` would reach the page as a string. This reads the list from
// the schema — the artefact — and fails by name when the two part.
// ---------------------------------------------------------------------------

const schema = readFileSync('prisma/schema.prisma', 'utf8')

function dateFieldsOf(model: string): string[] {
  const start = schema.indexOf(`model ${model} {`)
  const body = schema.slice(start, schema.indexOf('\n}', start))
  return body
    .split('\n')
    .map((line) => /^\s+(\w+)\s+DateTime\??(\s|$)/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name))
}

describe('DATE_FIELDS is every DateTime column of the models read whole', () => {
  it.each(Object.keys(DATE_FIELDS) as (keyof typeof DATE_FIELDS)[])(
    '%s',
    (model) => {
      expect([...DATE_FIELDS[model]].sort()).toEqual(dateFieldsOf(model).sort())
    },
  )
})

import { Prisma } from '@/generated/prisma/client'
import { optionalText, stateCode } from './reference'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// MAIN'S LICENCE FIELDS AND THE CDL RECORD: ONE SOURCE (owner's request,
// 2026-11-18, Adzhmal Alimi on dev).
//
// The safety team held a current CDL record with a file while Main's CDL
// number, state and class sat blank. Two writers, no link between them: the
// compliance panel and the Documents-tab reader file a `ComplianceItem`, the
// Main form writes `Driver.cdl*`, and nothing carried one to the other.
//
// THE RULE, in one place:
//   - Main's field is Main's. A value there is never overwritten from here.
//   - An EMPTY Main field reads from the newest CDL record (latest expiry,
//     then id, the order the record head already reads them in).
//   - Recording a CDL — the panel, or a licence read on the Documents tab —
//     fills Main's empty fields with what was recorded.
//
// `cdlFillForMain` is the whole decision. The page's read (`mainCdlView`) and
// the write (`fillMainFromCdl`) both call it, so what Main SHOWS from a record
// and what recording WRITES cannot come apart — tests/integration/driver-cdl
// holds the two against each other on a real row.
//
// CLASS HAS NO COLUMN ON THE RECORD. `ComplianceItem` carries `identifier`
// (the number) and `issuer` (the state); a class arrives only from a licence
// reading at the moment it is filed, and fills Main then. A record alone
// cannot supply one, and nothing invents it.
// ---------------------------------------------------------------------------

export interface MainCdl {
  cdlNumber: string | null
  cdlState: string | null
  cdlClass: string | null
}

export type MainCdlField = keyof MainCdl

/** What a CDL record, or a filing of one, can say about the licence. */
export interface CdlFacts {
  number?: string | null
  state?: string | null
  class?: string | null
}

/** The CDL record shape the page holds: type, number, state, expiry, id. */
export interface CdlRecordRow {
  id: string
  type: string
  identifier: string | null
  issuer: string | null
  expiresAt: Date
}

/** The newest CDL record — latest expiry, then id — or null. */
export function newestCdlRecord<R extends CdlRecordRow>(
  records: readonly R[],
): R | null {
  let best: R | null = null
  for (const record of records) {
    if (record.type !== 'CDL') continue
    if (
      best === null ||
      record.expiresAt.getTime() > best.expiresAt.getTime() ||
      (record.expiresAt.getTime() === best.expiresAt.getTime() &&
        record.id < best.id)
    ) {
      best = record
    }
  }
  return best
}

/**
 * THE DECISION. The fields Main is missing that `facts` can supply, normalised
 * the way the Main form normalises them (`optionalText`, `stateCode`). A field
 * Main already holds is never in the result.
 */
export function cdlFillForMain(
  main: MainCdl,
  facts: CdlFacts,
): Partial<MainCdl> {
  const fill: Partial<MainCdl> = {}
  const number = optionalText(facts.number)
  const state = stateCode(facts.state)
  const cdlClass = optionalText(facts.class)?.toUpperCase() ?? null
  if (!optionalText(main.cdlNumber) && number) fill.cdlNumber = number
  if (!optionalText(main.cdlState) && state) fill.cdlState = state
  if (!optionalText(main.cdlClass) && cdlClass) fill.cdlClass = cdlClass
  return fill
}

/**
 * What Main shows: its own values, with each empty one read from the newest
 * CDL record. `fromRecord` names the fields that came from the record, so the
 * screen can say so.
 */
export function mainCdlView(
  main: MainCdl,
  records: readonly CdlRecordRow[],
): { values: MainCdl; fromRecord: MainCdlField[] } {
  const newest = newestCdlRecord(records)
  const fill = newest
    ? cdlFillForMain(main, { number: newest.identifier, state: newest.issuer })
    : {}
  return {
    values: { ...main, ...fill },
    fromRecord: Object.keys(fill) as MainCdlField[],
  }
}

/**
 * Fill the driver's empty CDL fields from a CDL just recorded. Runs inside the
 * recording's transaction, so the record and Main move together or not at
 * all. Returns the fields it wrote.
 */
export async function fillMainFromCdl(
  tx: TxClient,
  driverId: string,
  facts: CdlFacts,
): Promise<MainCdlField[]> {
  const main = await tx.driver.findFirst({
    where: { id: driverId, deletedAt: null },
    select: { cdlNumber: true, cdlState: true, cdlClass: true },
  })
  if (!main) return []
  const fill = cdlFillForMain(main, facts)
  const fields = Object.keys(fill) as MainCdlField[]
  if (fields.length === 0) return []
  // ONE STATEMENT, the empty-field condition repeated per column in SQL, so a
  // Main edit that lands between the read and this write is not overwritten.
  const sets = fields.map(
    (field) =>
      Prisma.sql`${Prisma.raw(`"${field}"`)} = CASE WHEN COALESCE(${Prisma.raw(`"${field}"`)}, '') = '' THEN ${fill[field]} ELSE ${Prisma.raw(`"${field}"`)} END`,
  )
  await tx.$executeRaw`
    UPDATE "Driver"
       SET ${Prisma.join(sets, ', ')}, "updatedAt" = now()
     WHERE id = ${driverId} AND "deletedAt" IS NULL`
  return fields
}

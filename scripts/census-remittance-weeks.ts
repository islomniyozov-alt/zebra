import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readRemittance } from '@/lib/amazon/remittance'

// ---------------------------------------------------------------------------
// WHICH WEEK DOES EACH AMAZON WORKBOOK PAY FOR? — AND IT ASKS THE FILE.
//
//   npx tsx -r dotenv/config scripts/census-remittance-weeks.ts
//   npx tsx -r dotenv/config scripts/census-remittance-weeks.ts --week 2026-08-30
//
// NO DATABASE AT ALL. Not "select only" — this file does not open a connection,
// which is why it needs no allowlist entry and can carry no target flag.
//
// ── WHY THE WORK PERIOD IS NOT THE ANSWER ─────────────────────────────────
//
// `Work period::` is Amazon's PAYMENT period, and the 2026-09-26 ruling on the
// money screen turned on exactly that distinction: their label spans two of our
// weeks, so a workbook labelled 9/13–9/19 also clears held lines from 9/6–9/12.
// A replay that picked its workbooks by the label would import the wrong set and
// then explain the gap as a matching failure.
//
// SO THE ANSWER IS THE ROWS. Every row carries its own `startDate`/`endDate` for
// the leg it pays, and the histogram below is over those — the weeks a workbook
// actually reaches into, not the one it is filed under. Same posture as flag 88:
// build the instrument from the artefact, not from what the label believes.
//
// A WEEK HERE IS SATURDAY-TO-FRIDAY, which is the settlement week Zebra uses
// and the one the Datatruck statements print. Amazon's own rows respect no such
// boundary, which is the point of counting them.
// ---------------------------------------------------------------------------

const DIR = 'corpus/amazon'

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const heading = (text: string) => {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 78)))
}

const arg = (name: string): string | null => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? null : (process.argv[at + 1] ?? null)
}

/**
 * The SUNDAY that starts the settlement week containing this date.
 *
 * ── READ OFF THE ARTEFACTS, NOT ASSUMED ───────────────────────────────────
 *
 * The first version of this went back to Saturday, and the buckets it printed
 * were wrong by one day for every row — a whole day's freight in the adjacent
 * week, which is the shape of error nobody notices in a summary.
 *
 * TWO ARTEFACTS SAY SUNDAY, independently: every Datatruck statement prints
 * `Period Start 8/30/2026` with `Period End 9/5/2026`, and 8/30/2026 is a
 * Sunday; and the batch this replay opens is `--week 2026-08-30`, fourteen days
 * from the 9/13 week already settled. That is "never supply the baseline you are
 * testing" arriving through a calendar instead of a git range.
 *
 * UTC THROUGHOUT. These are printed calendar days with no zone; reading them in
 * the machine's local zone would move a Saturday delivery into the next week
 * west of UTC.
 */
function weekOf(iso: string): string | null {
  const at = Date.parse(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(at)) return null
  const backToSunday = new Date(at).getUTCDay() // 0 Sun … 6 Sat
  return new Date(at - backToSunday * 86_400_000).toISOString().slice(0, 10)
}

/**
 * A printed day to `2026-09-01`, or null.
 *
 * THREE FORMS, AND THE THIRD IS THE ONE THESE FILES ACTUALLY USE. The first
 * version of this handled ISO and `9/1/2026` and nothing else, so every one of
 * 1,900 rows fell through as unreadable and the histogram bucketed per DAY while
 * reporting a week column. It looked like a finding about Amazon's dates.
 *
 * `Aug 1, 2026` is what the workbooks print. Named months are matched from a
 * table rather than handed to `Date.parse`, which accepts far more than this
 * should and resolves what it accepts in the local zone.
 */
const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
}

function isoDay(raw: string): string | null {
  const text = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (slash) {
    const [, month, day, year] = slash
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`
  }
  const named = /^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/.exec(text)
  if (named) {
    const month = MONTHS[named[1]!.slice(0, 3).toLowerCase()]
    if (month === undefined) return null
    return `${named[3]}-${month}-${named[2]!.padStart(2, '0')}`
  }
  return null
}

async function main(): Promise<void> {
  const only = arg('week')
  const files = readdirSync(DIR)
    .filter((name) => name.toLowerCase().endsWith('.xlsx'))
    .sort()

  heading(`AMAZON WORKBOOKS IN ${DIR} — ${files.length} file(s)`)

  const byWeek = new Map<
    string,
    { files: Set<string>; cents: number; rows: number }
  >()

  for (const name of files) {
    const outcome = await readRemittance(
      new Uint8Array(readFileSync(join(DIR, name))),
    )
    if (!outcome.ok) {
      console.log(`\n${name}`)
      console.log(`  REFUSED: ${outcome.reason.kind}`)
      continue
    }
    const { summary, rows, totals } = outcome.reading

    // THE HISTOGRAM IS OVER `endDate`, the leg's delivery — which is what
    // decides the settlement week for a driver, the same field `settleableWhere`
    // reads through the POD event.
    const weeks = new Map<string, { cents: number; rows: number }>()
    for (const row of rows) {
      const iso = isoDay(row.endDate)
      const week = iso === null ? null : weekOf(iso)
      const key = week ?? `unreadable(${row.endDate || 'blank'})`
      const cell = weeks.get(key) ?? { cents: 0, rows: 0 }
      cell.cents += row.grossCents
      cell.rows += 1
      weeks.set(key, cell)

      const all = byWeek.get(key) ?? {
        files: new Set<string>(),
        cents: 0,
        rows: 0,
      }
      all.files.add(name)
      all.cents += row.grossCents
      all.rows += 1
      byWeek.set(key, all)
    }

    console.log(`\n${name}`)
    console.log(`  invoice      ${summary.invoiceNumber ?? '(none)'}`)
    console.log(`  work period  ${summary.workPeriod ?? '(none)'}`)
    console.log(
      `  paid         ${summary.paymentDate ?? '(none)'}  ${summary.paymentStatus ?? ''}`,
    )
    console.log(
      `  total        ${summary.invoiceTotalCents === null ? '(none)' : money(summary.invoiceTotalCents)}` +
        `   body ${money(totals.bodyCents)}   ${rows.length} row(s)`,
    )
    for (const [week, cell] of [...weeks].sort()) {
      const mark = only !== null && week === only ? ' ←' : ''
      console.log(
        `    week ${week}   ${String(cell.rows).padStart(4)} row(s)   ${money(cell.cents).padStart(14)}${mark}`,
      )
    }
  }

  heading('EVERY SETTLEMENT WEEK THESE WORKBOOKS REACH INTO')
  for (const [week, cell] of [...byWeek].sort()) {
    console.log(
      `  ${week}   ${String(cell.rows).padStart(4)} row(s)   ${money(cell.cents).padStart(14)}   ` +
        `${cell.files.size} workbook(s): ${[...cell.files].join(', ')}`,
    )
  }
}

await main()

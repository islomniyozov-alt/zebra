import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'

// ---------------------------------------------------------------------------
// EVERY STATEMENT IN A FOLDER, PARSED — AND THE TIE-CHECK IS A HARD GATE.
//
//   npx tsx -r dotenv/config scripts/bulk-parse-statements.ts --production \
//     --dir corpus/datatruck/statements-2026-09-19 --period 9/6/2026
//
// SELECT ONLY.
//
// ── WHY A BULK PARSE IS ALLOWED TO EXIST AT ALL ───────────────────────────
//
// `tests/fixtures/datatruck-statements.ts` is transcribed by hand and tied to
// its own printed totals before anybody trusts a figure in it. Eighteen more
// statements is too many for that, and the alternative — a parse nobody checks —
// is worse than not parsing at all.
//
// SO THE TIE IS THE GATE, not a warning. A statement whose parsed lines do not
// reproduce its own printed gross, mileage AND amount is reported UNPARSED and
// contributes nothing. It is never partially believed, never repaired, never
// guessed at. Owner's ruling, 2026-09-26.
//
// That is the whole reason this can be run over a folder: a wrong parse cannot
// reach the comparison, so the failure mode is a missing answer rather than a
// false one.
//
// ── HOW A LINE IS READ ────────────────────────────────────────────────────
//
// The Earnings table's middle columns are optional — a load with no places and
// no dates prints as a load number and three figures — so the FIRST token is the
// load number and the LAST THREE are gross, mileage and amount. Nothing in
// between is relied on, because that is exactly what varies.
//
// ── WHAT IT COMPARES ──────────────────────────────────────────────────────
//
// Two questions per line, by ruling: does the load exist in Zebra, and does its
// recorded gross match the statement's. Paired on `Load.referenceNumber`, the
// same handle the remittance matcher uses.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const PRODUCTION = process.argv.includes('--production')
const arg = (name: string): string | null => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? null : (process.argv[at + 1] ?? null)
}

function target() {
  const url = PRODUCTION
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('No database url for that target.')
  return { url, label: PRODUCTION ? 'PRODUCTION' : 'DEV' }
}

const heading = (text: string) => {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 74)))
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

/** `$1,234.56` and `(1,234.56)` and `1234.5` to integer cents. */
function cents(raw: string): number | null {
  const text = raw.trim()
  const negative = /^\(.*\)$/.test(text)
  const bare = text.replace(/[()$,\s]/g, '')
  if (!/^-?\d*(\.\d+)?$/.test(bare) || bare === '') return null
  const [whole, fraction = ''] = bare.replace('-', '').split('.')
  const value =
    Number.parseInt(whole || '0', 10) * 100 +
    Number.parseInt(fraction.padEnd(2, '0').slice(0, 2) || '0', 10)
  return negative || bare.startsWith('-') ? -value : value
}

/** Mileage prints as `2,595.86` or `0`. Hundredths, like the fixtures. */
function hundredths(raw: string): number | null {
  const bare = raw.trim().replace(/,/g, '')
  if (!/^\d*(\.\d+)?$/.test(bare) || bare === '') return null
  const [whole, fraction = ''] = bare.split('.')
  return (
    Number.parseInt(whole || '0', 10) * 100 +
    Number.parseInt(fraction.padEnd(2, '0').slice(0, 2) || '0', 10)
  )
}

interface ParsedLine {
  loadNumber: string
  grossCents: number
  milesHundredths: number
  amountCents: number
}

interface Parsed {
  file: string
  number: string | null
  driver: string | null
  unitNumber: string | null
  tariff: string | null
  periodStart: string | null
  periodEnd: string | null
  lines: ParsedLine[]
  printed: {
    grossCents: number | null
    milesHundredths: number | null
    amountCents: number | null
  }
  /** Why it is unusable, when it is. */
  refusal: string | null
}

function parse(file: string): Parsed {
  const text = execFileSync('pdftotext', ['-layout', file, '-'], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  const rows = text.split(/\r?\n/)

  const grab = (label: RegExp): string | null => {
    for (const row of rows) {
      const hit = label.exec(row)
      if (hit) return (hit[1] ?? '').trim()
    }
    return null
  }

  const out: Parsed = {
    file,
    number: grab(/Settlement:\s*(ST-\d+)/),
    driver: grab(/Driver:\s*(.+?)\s{2,}/),
    unitNumber: grab(/Unit Number:\s*(\S+)/),
    tariff: grab(/(\d+%\s*from\s*gross)/i),
    periodStart: grab(/Period Start:\s*([\d/]+)/),
    periodEnd: grab(/Period End:\s*([\d/]+)/),
    lines: [],
    printed: { grossCents: null, milesHundredths: null, amountCents: null },
    refusal: null,
  }

  const headerAt = rows.findIndex((r) => /Load number\s+PU/.test(r))
  if (headerAt === -1) {
    out.refusal = 'no Earnings table header'
    return out
  }

  for (let i = headerAt + 1; i < rows.length; i++) {
    const row = rows[i]!
    const tokens = row.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue

    if (/^Total:?$/i.test(tokens[0] ?? '')) {
      const tail = tokens.slice(-3)
      out.printed = {
        grossCents: cents(tail[0] ?? ''),
        milesHundredths: hundredths(tail[1] ?? ''),
        amountCents: cents(tail[2] ?? ''),
      }
      break
    }
    // A deduction table follows the earnings one; stop before it.
    if (/^Deduction/i.test(tokens[0] ?? '')) break
    if (tokens.length < 4) continue

    const tail = tokens.slice(-3)
    const grossCents = cents(tail[0] ?? '')
    const milesHundredths = hundredths(tail[1] ?? '')
    const amountCents = cents(tail[2] ?? '')
    if (
      grossCents === null ||
      milesHundredths === null ||
      amountCents === null
    ) {
      continue
    }
    out.lines.push({
      loadNumber: tokens[0]!,
      grossCents,
      milesHundredths,
      amountCents,
    })
  }

  // ── THE TIE, AS A GATE ────────────────────────────────────────────────
  const sum = out.lines.reduce(
    (acc, l) => ({
      gross: acc.gross + l.grossCents,
      miles: acc.miles + l.milesHundredths,
      amount: acc.amount + l.amountCents,
    }),
    { gross: 0, miles: 0, amount: 0 },
  )
  const p = out.printed
  if (
    p.grossCents === null ||
    p.milesHundredths === null ||
    p.amountCents === null
  ) {
    out.refusal = 'no printed Total row to tie against'
  } else if (out.lines.length === 0) {
    out.refusal = 'no lines parsed'
  } else if (sum.gross !== p.grossCents) {
    out.refusal = `gross does not tie: parsed ${money(sum.gross)} vs printed ${money(p.grossCents)}`
  } else if (sum.amount !== p.amountCents) {
    out.refusal = `amount does not tie: parsed ${money(sum.amount)} vs printed ${money(p.amountCents)}`
  } else if (sum.miles !== p.milesHundredths) {
    out.refusal = `mileage does not tie: parsed ${sum.miles} vs printed ${p.milesHundredths}`
  }
  return out
}

async function main(): Promise<void> {
  const dir = arg('dir')
  const period = arg('period')
  if (!dir || !period) {
    throw new Error('Name --dir and --period (e.g. --period 9/6/2026).')
  }
  const where = target()
  const db = createPrismaClient(where.url)
  console.log(`Target: ${where.label}`)
  console.log(`Folder: ${dir}`)
  console.log(`Period: starting ${period}`)

  try {
    const files = readdirSync(dir)
      .filter((n) => n.toLowerCase().endsWith('.pdf'))
      .map((n) => join(dir, n))
      .sort()

    const parsed = files.map(parse).filter((p) => p.periodStart === period)

    // ONE PER SETTLEMENT NUMBER. The folder holds re-downloads: 23 files carry
    // 18 distinct numbers. A duplicate is skipped rather than counted twice,
    // and a duplicate that DISAGREES with its twin is reported.
    const bySettlement = new Map<string, Parsed>()
    const conflicts: string[] = []
    for (const p of parsed) {
      if (!p.number) continue
      const seen = bySettlement.get(p.number)
      if (!seen) {
        bySettlement.set(p.number, p)
        continue
      }
      const same =
        seen.printed.grossCents === p.printed.grossCents &&
        seen.printed.amountCents === p.printed.amountCents &&
        seen.lines.length === p.lines.length
      if (!same) {
        conflicts.push(
          `${p.number}: ${seen.file} and ${p.file} parse differently`,
        )
      }
    }

    const usable = [...bySettlement.values()].filter((p) => p.refusal === null)
    const refused = [...bySettlement.values()].filter((p) => p.refusal !== null)

    heading('THE PARSE')
    console.log(`  files in the folder matching the period: ${parsed.length}`)
    console.log(
      `  distinct settlements:                    ${bySettlement.size}`,
    )
    console.log(`  TIED and usable:                         ${usable.length}`)
    console.log(`  UNPARSED (reported, never guessed):      ${refused.length}`)
    for (const p of refused) {
      console.log(`    ${p.number ?? p.file}: ${p.refusal}`)
    }
    for (const line of conflicts) console.log(`    CONFLICT ${line}`)

    // ── THE COMPARISON ──────────────────────────────────────────────────
    const references = [
      ...new Set(usable.flatMap((p) => p.lines.map((l) => l.loadNumber))),
    ]
    const loads = await db.load.findMany({
      where: { referenceNumber: { in: references } },
      select: {
        loadNumber: true,
        referenceNumber: true,
        linehaulCents: true,
        accessorialsCents: true,
        totalRevenueCents: true,
        billingStatus: true,
      },
    })
    const byRef = new Map(loads.map((l) => [l.referenceNumber ?? '', l]))

    let present = 0
    let absent = 0
    let grossAgrees = 0
    let grossDiffers = 0

    for (const p of usable) {
      heading(
        `${p.number}  ${p.driver ?? '(no driver)'}  unit ${p.unitNumber ?? '-'}` +
          `  ${p.periodStart}–${p.periodEnd}  ${p.tariff ?? '(no tariff)'}`,
      )
      console.log(
        `  ${p.lines.length} line(s), gross ${money(p.printed.grossCents!)}` +
          `, driver amount ${money(p.printed.amountCents!)}  — ties`,
      )
      for (const line of p.lines) {
        const mine = byRef.get(line.loadNumber)
        if (!mine) {
          absent++
          console.log(
            `    ABSENT  ${line.loadNumber.padEnd(14)} gross ${money(line.grossCents)}`,
          )
          continue
        }
        present++
        if (mine.totalRevenueCents === line.grossCents) {
          grossAgrees++
          console.log(
            `    agree   ${line.loadNumber.padEnd(14)} ${mine.loadNumber}  ${money(line.grossCents)}`,
          )
        } else {
          grossDiffers++
          console.log(
            `    DIFFER  ${line.loadNumber.padEnd(14)} ${mine.loadNumber}` +
              `  statement ${money(line.grossCents)}  zebra ${money(mine.totalRevenueCents)}` +
              `  (linehaul ${money(mine.linehaulCents)} + accessorials ${money(mine.accessorialsCents)})` +
              `  zebra is ${mine.totalRevenueCents > line.grossCents ? 'HIGHER' : 'LOWER'}` +
              ` by ${money(Math.abs(mine.totalRevenueCents - line.grossCents))}`,
          )
        }
      }
    }

    heading('ACROSS EVERY TIED STATEMENT')
    console.log(`  lines compared:              ${present + absent}`)
    console.log(`  load present in Zebra:       ${present}`)
    console.log(`  load ABSENT from Zebra:      ${absent}`)
    console.log(`  recorded gross agrees:       ${grossAgrees}`)
    console.log(`  recorded gross DIFFERS:      ${grossDiffers}`)

    console.log('\nEVERY STATEMENT ABOVE IS A READ. Nothing was changed.')
  } finally {
    await db.$disconnect()
  }
}

await main()

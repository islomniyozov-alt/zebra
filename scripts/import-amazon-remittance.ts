import { neonConfig } from '@neondatabase/serverless'
import { readFileSync, readdirSync } from 'node:fs'
import { createPrismaClient } from '@/lib/db'
import { readRemittance } from '@/lib/amazon/remittance'
import { keyFor, type FreightRef } from '@/lib/amazon/remittance-preview'
import {
  REMITTANCE_IMPORT_TIMEOUT_MS,
  writeRemittance,
} from '@/lib/amazon/remittance-write'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// THE AMAZON REMITTANCE, WRITTEN. The runner `writeRemittance` never had.
//
//   npx tsx -r dotenv/config scripts/import-amazon-remittance.ts --production \
//     --invoice AZNG4464389DE99C487FB425AC77433D22DF
//   ... --apply
//
// `writeRemittance` has existed and been tested since 2026-09-11 with NO
// CALLER — no script, no route. The preview beside it is read-only by design and
// says so in its header. So the week could be counted and not imported.
//
// ── WHICH AUTHORITY THE CASH IS BOOKED TO ─────────────────────────────────
//
// `Payment` carries ONE `companyId`, and the week's Amazon freight runs across
// RAM Haulage and Dolphins Transport, so the authority has to be decided rather
// than derived from the loads.
//
// Owner's ruling, 2026-09-25: the company whose identity matches the workbook's
// Carrier line, and REFUSE unless exactly one.
//
// THE RULING SAID "MC" AND THE WORKBOOK HAS NO MC. Checked the raw sheet: there
// is no motor-carrier number anywhere in it. What it carries is a Carrier name
// and a SCAC:
//
//   carrier "RAM HAULAGE LLC"   scac "ABFQZ"
//   RAM Haulage: scac=ABFQZ, legalName="RAM Haulage LLC", mc=MC-112499
//
// So the match is SCAC AND `legalName`, both EXACT, and both must pick the same
// single company — confirmed as the substitution on 2026-09-25. That is stricter
// than either alone: a SCAC is machine-readable and unique, and requiring the
// legal name to agree means a SCAC typed onto the wrong company cannot route a
// week's cash by itself.
//
// NOT A FUZZY NAME MATCH. `legalName` is compared case-insensitively and
// otherwise exactly, the way `CUSTOMER_ALIASES` refuses similarity matching on
// the table that decides who gets invoiced.
//
// ── ONE WORKBOOK PER RUN, NAMED ───────────────────────────────────────────
//
// `--invoice` is required. The corpus holds seven weeks and six of them are
// already-settled history; a runner that swept the directory would be one
// keystroke from writing all of them. `writeRemittance` is idempotent and would
// refuse the repeats, which is exactly the safety net this does not want to
// depend on.
//
// ── THE DRY RUN IS THE REAL PATH, ROLLED BACK ─────────────────────────────
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const APPLY = process.argv.includes('--apply')
/**
 * RETIRE A PRIOR IMPORT OF THE SAME INVOICE AND WRITE IT AGAIN.
 *
 * `writeRemittance` is idempotent on `remittanceKey`, which is what stops a
 * double payment — so a re-import after a CODE fix does nothing at all unless
 * the earlier payment is retired first.
 *
 * WHY THIS EXISTS: the 2026-09-13..19 remittance was imported on 2026-09-25 by
 * a matcher that compared a trip's whole remitted total against ONE leg's rate,
 * and wrote one application carrying the trip total against that leg. Seven
 * loads then settled as `over` by four to eight times. The ruling of the same
 * day fixed the matcher; the rows it had already written have to be replaced.
 *
 * WHAT IT DOES, precisely:
 *
 *   the Payment           SOFT-deleted, `remittanceKey` cleared so the unique
 *                         index frees up, `referenceNumber` left holding the
 *                         invoice so the trail survives
 *   its applications      removed — pure derived join rows with no soft delete
 *   its accessorials      removed BY `sourceKey` PREFIX, which is the only
 *                         handle: `LoadAccessorial` carries no payment FK
 *
 * THE PAYMENT IS NOT HARD-DELETED, because the standing rule is soft delete on
 * anything financial. Clearing `remittanceKey` is what makes soft delete
 * sufficient — without it the unique index would refuse the replacement.
 */
const REIMPORT = process.argv.includes('--reimport')
const PRODUCTION = process.argv.includes('--production')
const INVOICE = (() => {
  const at = process.argv.indexOf('--invoice')
  return at === -1 ? null : (process.argv[at + 1] ?? null)
})()

const DIR = 'corpus/amazon'
const ORGANIZATION_SLUG = 'zebra'
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'

/** The customer the remittance pays against. Stated, like CUSTOMER_ALIASES. */
const CUSTOMER_NAME = 'Amazon Relay'

class Rehearsal extends Error {}

function target() {
  const url = PRODUCTION
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('No database url for that target.')
  return {
    url,
    label: PRODUCTION ? 'PRODUCTION' : 'DEV',
    host: new URL(url).hostname,
    expectOrganizationId: PRODUCTION ? PRODUCTION_ORGANIZATION_ID : null,
  }
}

const heading = (text: string) => {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 70)))
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

/** Case-insensitive, otherwise exact. Never a similarity score. */
const sameName = (a: string | null, b: string | null) =>
  a !== null && b !== null && a.trim().toUpperCase() === b.trim().toUpperCase()

async function main(): Promise<void> {
  if (!INVOICE) {
    throw new Error(
      'Name the workbook with --invoice <invoiceNumber>. Sweeping the directory' +
        ' would put six settled weeks one keystroke away.',
    )
  }
  const where = target()
  const db = createPrismaClient(where.url)
  console.log(`Target: ${where.label}`)
  console.log(
    `Mode:   ${APPLY ? 'APPLY — writes commit' : 'dry run — rolls back'}`,
  )

  try {
    const tenancy = await assertTenancy(db, {
      label: where.label,
      host: where.host,
      slug: ORGANIZATION_SLUG,
      expectOrganizationId: where.expectOrganizationId,
    })

    const file = readdirSync(DIR)
      .filter((n) => n.endsWith('.xlsx'))
      .find((n) => n.includes(INVOICE))
    if (!file) throw new Error(`No workbook in ${DIR} matching ${INVOICE}.`)
    console.log(`Workbook: ${file}`)

    const out = await readRemittance(
      new Uint8Array(readFileSync(`${DIR}/${file}`)),
    )
    if (!out.ok) {
      throw new Error(`The workbook was refused: ${JSON.stringify(out)}`)
    }
    const reading = out.reading
    const summary = reading.summary
    if (summary.invoiceNumber !== INVOICE) {
      throw new Error(
        `The workbook's invoice is ${summary.invoiceNumber}, not ${INVOICE}.`,
      )
    }
    console.log(
      `Period:   ${summary.workPeriod}   total ${money(summary.invoiceTotalCents ?? 0)}`,
    )
    console.log(
      `Carrier:  ${JSON.stringify(summary.carrier)}  scac ${JSON.stringify(summary.scac)}`,
    )

    // ── WHICH AUTHORITY, BY SCAC AND LEGAL NAME, EXACTLY ONE ──────────────
    const companies = await db.company.findMany({
      where: { organizationId: tenancy.organizationId },
      select: { id: true, name: true, legalName: true, scac: true },
    })
    const matches = companies.filter(
      (c) =>
        sameName(c.scac, summary.scac) &&
        sameName(c.legalName, summary.carrier),
    )
    if (matches.length !== 1) {
      heading('REFUSING: THE CARRIER DOES NOT PICK EXACTLY ONE COMPANY')
      console.log(
        `  workbook scac=${JSON.stringify(summary.scac)} carrier=${JSON.stringify(summary.carrier)}`,
      )
      for (const c of companies) {
        console.log(
          `  ${c.name.padEnd(32)} scac=${c.scac ?? '(none)'}  legal=${c.legalName ?? '(none)'}`,
        )
      }
      console.log(
        `\n  matched ${matches.length}. Both the SCAC and the legal name must` +
          `\n  agree, exactly, on one company — a week's cash is not routed by a` +
          `\n  near miss.`,
      )
      throw new Error(`Carrier matched ${matches.length} companies, not 1.`)
    }
    const company = matches[0]!
    console.log(`Company:  ${company.name}  ${company.id}  (scac + legal name)`)

    const customer = await db.customer.findFirst({
      where: { organizationId: tenancy.organizationId, name: CUSTOMER_NAME },
      select: { id: true, name: true },
    })
    if (!customer) throw new Error(`No customer named ${CUSTOMER_NAME}.`)
    console.log(`Customer: ${customer.name}  ${customer.id}`)

    // ── THE FREIGHT THE ROWS POINT AT, BUILT AS THE PREVIEW BUILDS IT ─────
    const references = [
      ...new Set(
        reading.rows
          .map((row) => {
            const key = keyFor(row)
            return key.branch === 'tour' || key.branch === 'load_under_trip'
              ? key.tripId
              : key.branch === 'single_load'
                ? key.loadId
                : null
          })
          .filter((value): value is string => value !== null),
      ),
    ]
    const loads = await db.load.findMany({
      where: { deletedAt: null, referenceNumber: { in: references } },
      select: {
        id: true,
        loadNumber: true,
        referenceNumber: true,
        totalRevenueCents: true,
        billingStatus: true,
      },
    })
    // EVERY LOAD PER REFERENCE, by the 2026-09-25 ruling. A `Map` of one
    // silently kept whichever leg was written last, which is how a trip's total
    // came to be compared against one leg's rate.
    const freight = new Map<string, FreightRef[]>()
    for (const load of loads) {
      if (!load.referenceNumber) continue
      const ref: FreightRef = {
        id: load.id,
        loadNumber: load.loadNumber,
        reference: load.referenceNumber,
        totalRevenueCents: load.totalRevenueCents,
        closedHistory: load.billingStatus === 'CLOSED_IN_DATATRUCK',
      }
      freight.set(load.referenceNumber, [
        ...(freight.get(load.referenceNumber) ?? []),
        ref,
      ])
    }
    // HOW MUCH THE GROUPING ACTUALLY DOES, measured rather than assumed: if no
    // reference is shared, the ruling changes nothing and saying so is the
    // honest report.
    const shared = [...freight.values()].filter((g) => g.length > 1)
    console.log(
      `Groups:   ${shared.length} reference(s) carry more than one load` +
        (shared.length > 0
          ? `, largest ${Math.max(...shared.map((g) => g.length))}`
          : ''),
    )
    console.log(
      `Freight:  ${references.length} reference(s) named, ${freight.size} found`,
    )

    let result: Awaited<ReturnType<typeof writeRemittance>> | null = null
    const retired: string[] = []

    await db
      .$transaction(
        async (tx) => {
          if (REIMPORT) {
            const prior = await tx.payment.findFirst({
              where: {
                organizationId: tenancy.organizationId,
                remittanceKey: INVOICE,
              },
              select: { id: true, amountCents: true },
            })
            if (!prior) {
              retired.push(
                'no prior import of this invoice — nothing to retire',
              )
            } else {
              const apps = await tx.paymentLoadApplication.deleteMany({
                where: { paymentId: prior.id },
              })
              const charges = await tx.loadAccessorial.deleteMany({
                where: {
                  organizationId: tenancy.organizationId,
                  sourceKey: { startsWith: `${INVOICE}:` },
                },
              })
              await tx.payment.update({
                where: { id: prior.id },
                data: {
                  deletedAt: new Date(),
                  // CLEARED so the unique index frees up for the replacement.
                  // `referenceNumber` still holds the invoice, so the trail is
                  // not lost by doing this.
                  remittanceKey: null,
                  notes: `Retired 2026-09-26: re-imported after the trip-aggregation ruling.`,
                },
              })
              retired.push(
                `payment ${prior.id} soft-deleted, remittanceKey cleared`,
                `${apps.count} application(s) removed`,
                `${charges.count} accessorial(s) removed by sourceKey prefix`,
              )
            }
          }

          result = await writeRemittance(tx, {
            organizationId: tenancy.organizationId,
            companyId: company.id,
            customerId: customer.id,
            reading,
            freightByReference: freight,
            receivedAt: summary.paymentDate
              ? new Date(`${summary.paymentDate} UTC`)
              : new Date(),
          })
          if (!APPLY) throw new Rehearsal('dry run')
        },
        { timeout: REMITTANCE_IMPORT_TIMEOUT_MS },
      )
      .catch((error: unknown) => {
        if (error instanceof Rehearsal) return
        throw error
      })

    if (!result) throw new Error('The write produced no result.')
    const written = result as Awaited<ReturnType<typeof writeRemittance>>

    heading('WHERE THE ROWS LANDED')
    const counts = written.preview.counts
    console.log(`  matched      ${counts.matched_exact}`)
    console.log(`  short        ${counts.short}`)
    console.log(`  over         ${counts.over}`)
    console.log(`  unmatched    ${counts.unmatched}`)
    console.log(
      `  closed history (deliberately untouched)  ${counts.matched_closed_history}`,
    )
    if (counts.unkeyable > 0) console.log(`  unkeyable    ${counts.unkeyable}`)

    if (retired.length > 0) {
      heading(APPLY ? 'RETIRED THE PRIOR IMPORT' : 'WOULD RETIRE')
      for (const line of retired) console.log(`  ${line}`)
    }

    heading(APPLY ? 'WRITTEN' : 'WOULD WRITE — nothing committed')
    console.log(`  payment              ${written.paymentId}`)
    console.log(`  already imported     ${written.alreadyImported}`)
    console.log(`  units applied        ${written.appliedUnits}`)
    console.log(`  applied              ${money(written.appliedCents)}`)
    console.log(`  accessorials written ${written.accessorialsWritten}`)
    console.log(`  skipped closed       ${written.skippedClosedHistory}`)
    console.log(`  unapplied            ${money(written.unappliedCents)}`)
    console.log(
      `\n  The payment amount is the ACH Amazon sent, not the sum of what` +
        `\n  matched — so the unapplied figure is visible rather than balancing` +
        `\n  itself away.`,
    )

    if (!APPLY) {
      console.log(
        '\nROLLED BACK. The statements above ran and were undone; re-run with --apply.',
      )
    }
  } finally {
    await db.$disconnect()
  }
}

await main()

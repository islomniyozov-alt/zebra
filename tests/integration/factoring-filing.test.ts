import { existsSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import {
  assemblePacket,
  filePacketForLoad,
  fileWithFactor,
  filingStateFor,
  markFactoredPaid,
  packetPlanFor,
} from '@/lib/factoring-filing'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE PACKET, BUILT FOR A SEEDED LOAD RATHER THAN FOR FIXTURES.
//
// `tests/factoring-packet.test.ts` proves the assembler against bytes I typed.
// That is a weaker claim than the acceptance asks for, and saying so is what
// produced this file: the half that touches the database was never exercised.
//
// Here a real load is created through `createLoad`, given a real customer, a
// real invoice with a real number from the counter, a real factor with a
// remit block, and real Document rows — and the packet comes out of THOSE.
//
// R2 IS NOT INVOLVED. `packetPlanFor` returns the keys to fetch; the fetch is
// the action's job because `objectBytes` refuses to run inside a transaction.
// The test supplies the bytes the same way the action will, which is also what
// makes the assembly assertable without a bucket.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let customerId = ''
let userId = ''
let factorId = ''

const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'factoring-filing.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: LOAD_WRITE_TIMEOUT_MS,
  })

/** A JPEG with a real SOF, the size of the packet's own scans. */
const jpeg = (): Uint8Array =>
  new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11,
    0x08, 0x05, 0x00, 0x03, 0xc0, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01,
    0x03, 0x11, 0x01, 0xff, 0xd9,
  ])

const textOf = (pdf: Uint8Array): string[] =>
  [
    ...new TextDecoder('latin1')
      .decode(pdf)
      .matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g),
  ].map((m) => m[1]!.replace(/\\([()\\])/g, '$1'))

const pagesIn = (pdf: Uint8Array): number =>
  (new TextDecoder('latin1').decode(pdf).match(/\/Type\s*\/Page[^s]/g) ?? [])
    .length

let loadId = ''
let keys: string[] = []

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Factoring ${nonce}`,
      slug: `factoring-${nonce}`,
      maxCompanies: 5,
      companies: {
        create: [
          {
            name: `Dolphins ${nonce}`,
            dotNumber: `2544585-${nonce}`,
            mcNumber: `MC-885668-${nonce}`,
          },
        ],
      },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id

  const user = await owner.user.create({
    data: { email: `fact-${nonce}@example.test`, name: 'Filing Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  // THE FACTOR, with the remit block and the assignment notice as DATA.
  // `remitAddressLine2` is deliberately the literal "0" Werner prints.
  const factor = await owner.factoringCompany.create({
    data: {
      organizationId,
      companyId,
      name: 'RTS Financial',
      remitAddressLine1: 'PO Box 840267',
      remitAddressLine2: '0',
      remitCity: 'Dallas',
      remitState: 'TX',
      remitPostalCode: '75284-0267',
      noticeOfAssignment:
        'This invoice has been assigned to RTS Financial and must be paid to RTS Financial.',
    },
  })
  factorId = factor.id

  customerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `WERNER ${nonce}` }),
    )
  ).id
  await owner.customer.update({
    where: { id: customerId },
    data: {
      addressLine1: 'PO BOX 45308',
      // THE LINE WERNER RENDERS AS A ZERO. It must not reach the page.
      addressLine2: '0',
      city: 'OMAHA',
      state: 'NE',
      postalCode: '68145-0308',
    },
  })

  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId,
        // THE BROKER'S OWN NUMBER — Werner's Route #.
        referenceNumber: `2004467733-${nonce}`,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: new Date(Date.UTC(2026, 8, 5)),
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: new Date(Date.UTC(2026, 8, 6)),
          },
        ],
        linehaulCents: 148806,
      },
      { byUserId: userId },
    ),
  )
  loadId = load.id

  const invoice = await owner.invoice.create({
    data: {
      organizationId,
      companyId,
      invoiceNumber: `DOL-${nonce}`,
      customerId,
      issueDate: new Date(Date.UTC(2026, 8, 7)),
      termsDays: 30,
      factoringCompanyId: factorId,
    },
  })
  await owner.invoiceLine.create({
    data: {
      invoiceId: invoice.id,
      organizationId,
      loadId,
      description: 'Linehaul',
      unitCents: 148806,
      amountCents: 148806,
    },
  })

  // THE THREE DOCUMENTS. A yard drop's POD is phone photographs, so two of
  // them are images — the shape the real packet carries.
  const documents = [
    { type: 'POD' as const, filename: 'pod-1.jpg', mimeType: 'image/jpeg' },
    { type: 'POD' as const, filename: 'pod-2.jpg', mimeType: 'image/jpeg' },
    { type: 'BOL' as const, filename: 'bol.jpg', mimeType: 'image/jpeg' },
    {
      type: 'RATE_CONFIRMATION' as const,
      filename: 'ratecon.pdf',
      mimeType: 'application/pdf',
    },
  ]
  keys = []
  for (const [index, document] of documents.entries()) {
    const r2Key = `${organizationId}/load/${loadId}/${nonce}-${String(index)}`
    keys.push(r2Key)
    await owner.document.create({
      data: {
        organizationId,
        companyId,
        loadId,
        r2Key,
        filename: document.filename,
        mimeType: document.mimeType,
        sizeBytes: 1024,
        type: document.type,
      },
    })
  }
}, 300_000)

afterAll(async () => {
  await owner.$disconnect()
})

/**
 * A one-page PDF carrying a mark that can be found again.
 *
 * A WHOLE DOCUMENT, not a lone stream. These fixtures used to be a bare object
 * with a content stream and no catalog, which was enough for the splicer that
 * read them: it looked for `Tj` anywhere in the bytes. The importer reads the
 * page tree, so a fixture without one is not a PDF — and being made to fix
 * these is the reader saying so, which is the behaviour wanted.
 */
const onePagePdf = (mark: string): Uint8Array => {
  const content = `BT /F1 10 Tf 56 700 Td (${mark}) Tj ET`
  const text = [
    '%PDF-1.4',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    'endobj',
    '4 0 obj',
    `<< /Length ${String(content.length)} >>`,
    'stream',
    content,
    'endstream',
    'endobj',
    'trailer',
    '<< /Size 5 /Root 1 0 R >>',
    'startxref',
    '0',
    '%%EOF',
  ].join('\n')
  return new TextEncoder().encode(text)
}

/** The bytes the action would have fetched from R2, by key. */
const bytesFor = (plan: { fetch: { key: string; mimeType: string }[] }) =>
  new Map(
    plan.fetch.map((want) => [
      want.key,
      want.mimeType.startsWith('image/')
        ? jpeg()
        : onePagePdf('Route 2004467733'),
    ]),
  )

describe('a seeded load becomes a packet', () => {
  it('is ready, and the plan names what to fetch in packet order', async () => {
    const plan = await inOrg((tx) => packetPlanFor(tx, loadId))
    expect(plan).not.toBeNull()
    expect(plan!.refusal).toBeNull()
    expect(plan!.readiness.ready).toBe(true)
    expect(plan!.fetch.map((f) => f.type)).toEqual([
      'POD',
      'POD',
      'BOL',
      'RATE_CONFIRMATION',
    ])
    expect(plan!.fetch.map((f) => f.key)).toEqual(keys)
  }, 300_000)

  it('assembles five pages in the artefact’s order, read from the bytes', async () => {
    const plan = (await inOrg((tx) => packetPlanFor(tx, loadId)))!
    const built = assemblePacket(plan, bytesFor(plan))
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.pageCount).toBe(5)
    expect(pagesIn(built.pdf)).toBe(5)
    expect(
      (new TextDecoder('latin1').decode(built.pdf).match(/\/DCTDecode/g) ?? [])
        .length,
    ).toBe(3)
    expect(built.filename).toMatch(/^packet-.+\.pdf$/)
  }, 300_000)

  it('prints the invoice fields from the rows, not from a fixture', async () => {
    const plan = (await inOrg((tx) => packetPlanFor(tx, loadId)))!
    const built = assemblePacket(plan, bytesFor(plan))
    if (!built.ok) throw new Error('not built')
    const printed = textOf(built.pdf)
    const joined = printed.join('\n')

    // The authority's own letterhead, from the Company row.
    expect(joined).toContain(`Dolphins ${nonce}`)
    // Bill To, from the customer record.
    expect(joined).toContain(`WERNER ${nonce}`)
    // Remit To the factor, as a block, with the notice as data.
    expect(joined).toContain('RTS Financial')
    expect(joined).toContain('PO Box 840267')
    expect(joined).toContain('assigned to RTS Financial')
    // Zebra's own per-authority series, never Datatruck's IN-plus-sequence.
    expect(joined).toContain(`DOL-${nonce}`)
    expect(joined).not.toMatch(/\bIN-\d{6}\b/)
    // Load Number is the BROKER's — Werner pays against its own Route #.
    expect(joined).toContain(`Load Number 2004467733-${nonce}`)
    // Terms 30 and a due date thirty days out, ISO-sliced.
    expect(joined).toContain('2026-09-07')
    expect(joined).toContain('2026-10-07')
    // One charge row.
    expect(joined).toContain('Linehaul - FLAT')

    // WERNER'S `, 0,` BUG, NOT REPRODUCED. Both the customer's address line 2
    // and the factor's are the literal "0" in this fixture.
    expect(printed).not.toContain('0')
    expect(joined).not.toContain(', 0,')
  }, 300_000)
})

describe('filing, and then a person clicking PAID', () => {
  it('refuses PAID before the load was ever filed', async () => {
    const result = await inOrg((tx) => markFactoredPaid(tx, loadId))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason.kind).toBe('not_filed')
  }, 300_000)

  it('files it, and files it only once', async () => {
    const first = await inOrg((tx) => fileWithFactor(tx, loadId))
    expect(first.ok).toBe(true)
    expect(
      (
        await owner.load.findUniqueOrThrow({
          where: { id: loadId },
          select: { billingStatus: true },
        })
      ).billingStatus,
    ).toBe('FILED_WITH_FACTOR')

    const second = await inOrg((tx) => fileWithFactor(tx, loadId))
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason.kind).toBe('already_filed')
  }, 300_000)

  // AND IT STAYS THERE. Factoring money stays out of the software, so nothing
  // arrives that could move the status on its own — the transition is a
  // button, and this is the button.
  it('moves to PAID only when a person says so', async () => {
    const result = await inOrg((tx) => markFactoredPaid(tx, loadId))
    expect(result.ok).toBe(true)
    expect(
      (
        await owner.load.findUniqueOrThrow({
          where: { id: loadId },
          select: { billingStatus: true },
        })
      ).billingStatus,
    ).toBe('PAID')
  }, 300_000)
})

describe('the disabled state names the missing piece', () => {
  // EACH OF THE FOUR, ON A REAL LOAD. The unit test proves the sentence; this
  // proves the query behind it — that a document row actually absent from the
  // database produces it.
  for (const missing of ['POD', 'BOL', 'RATE_CONFIRMATION'] as const) {
    it(`names ${missing} when its row is not there`, async () => {
      const bare = await inOrg((tx) =>
        createLoad(
          tx,
          organizationId,
          {
            companyId,
            customerId,
            stops: [
              {
                type: 'PICKUP',
                city: 'Whiteland',
                state: 'IN',
                scheduledAt: new Date(Date.UTC(2026, 8, 5)),
              },
              {
                type: 'DELIVERY',
                city: 'Gastonia',
                state: 'NC',
                scheduledAt: new Date(Date.UTC(2026, 8, 6)),
              },
            ],
            linehaulCents: 100000,
          },
          { byUserId: userId },
        ),
      )
      const invoice = await owner.invoice.create({
        data: {
          organizationId,
          companyId,
          invoiceNumber: `DOL-${nonce}-${missing}`,
          customerId,
          issueDate: new Date(Date.UTC(2026, 8, 7)),
          termsDays: 30,
        },
      })
      await owner.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          organizationId,
          loadId: bare.id,
          description: 'Linehaul',
          unitCents: 100000,
          amountCents: 100000,
        },
      })
      for (const type of ['POD', 'BOL', 'RATE_CONFIRMATION'] as const) {
        if (type === missing) continue
        await owner.document.create({
          data: {
            organizationId,
            companyId,
            loadId: bare.id,
            r2Key: `${organizationId}/load/${bare.id}/${type}`,
            filename: `${type}.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: 512,
            type,
          },
        })
      }

      const plan = await inOrg((tx) => packetPlanFor(tx, bare.id))
      expect(plan!.readiness.ready).toBe(false)
      expect(plan!.readiness.missing).toEqual([missing])
      expect(plan!.readiness.because).toContain(
        {
          POD: 'the POD',
          BOL: 'the BOL',
          RATE_CONFIRMATION: 'the rate confirmation',
        }[missing],
      )
      expect(plan!.refusal?.kind).toBe('not_ready')
    }, 300_000)
  }

  // THE FOURTH PIECE IS AN INVOICE ROW, not a document — the P3 rule.
  it('names the invoice when no invoice covers the load', async () => {
    const bare = await inOrg((tx) =>
      createLoad(
        tx,
        organizationId,
        {
          companyId,
          customerId,
          stops: [
            {
              type: 'PICKUP',
              city: 'Whiteland',
              state: 'IN',
              scheduledAt: new Date(Date.UTC(2026, 8, 5)),
            },
            {
              type: 'DELIVERY',
              city: 'Gastonia',
              state: 'NC',
              scheduledAt: new Date(Date.UTC(2026, 8, 6)),
            },
          ],
          linehaulCents: 100000,
        },
        { byUserId: userId },
      ),
    )
    for (const type of ['POD', 'BOL', 'RATE_CONFIRMATION'] as const) {
      await owner.document.create({
        data: {
          organizationId,
          companyId,
          loadId: bare.id,
          r2Key: `${organizationId}/load/${bare.id}/${type}`,
          filename: `${type}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 512,
          type,
        },
      })
    }

    const plan = await inOrg((tx) => packetPlanFor(tx, bare.id))
    expect(plan!.readiness.missing).toEqual(['INVOICE_PDF'])
    expect(plan!.readiness.because).toContain('the invoice')
  }, 300_000)
})

// ---------------------------------------------------------------------------
// THE WIRING, ON ITS OWN LOAD.
//
// The suite above mutates the shared load's billing status on its way to PAID,
// so the sequencer gets a second one. What is proved here is the ORDER, which
// is the thing the action delegates and therefore the thing no screen test
// could reach: the packet is built BEFORE the status moves, and a refusal
// leaves the status exactly where it was.
// ---------------------------------------------------------------------------

/** A second broker load with all four pieces, returned by id. */
async function seedFiledCandidate(suffix: string): Promise<{
  id: string
  keys: string[]
}> {
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId,
        referenceNumber: `2004467999-${suffix}`,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: new Date(Date.UTC(2026, 8, 5)),
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: new Date(Date.UTC(2026, 8, 6)),
          },
        ],
        linehaulCents: 148806,
      },
      { byUserId: userId },
    ),
  )

  const invoice = await owner.invoice.create({
    data: {
      organizationId,
      companyId,
      invoiceNumber: `DOL-${nonce}-${suffix}`,
      customerId,
      factoringCompanyId: factorId,
      issueDate: new Date(Date.UTC(2026, 8, 7)),
      termsDays: 30,
    },
  })
  await owner.invoiceLine.create({
    data: {
      invoiceId: invoice.id,
      organizationId,
      loadId: load.id,
      description: 'Linehaul',
      unitCents: 148806,
      amountCents: 148806,
    },
  })

  const keys: string[] = []
  const documents = [
    { type: 'POD' as const, filename: 'pod.jpg', mimeType: 'image/jpeg' },
    { type: 'BOL' as const, filename: 'bol.jpg', mimeType: 'image/jpeg' },
    {
      type: 'RATE_CONFIRMATION' as const,
      filename: 'ratecon.pdf',
      mimeType: 'application/pdf',
    },
  ]
  for (const [index, document] of documents.entries()) {
    const r2Key = `${organizationId}/load/${load.id}/${suffix}-${String(index)}`
    keys.push(r2Key)
    await owner.document.create({
      data: {
        organizationId,
        companyId,
        loadId: load.id,
        r2Key,
        filename: document.filename,
        mimeType: document.mimeType,
        sizeBytes: 1024,
        type: document.type,
      },
    })
  }

  return { id: load.id, keys }
}

/** The bucket, as a Map. The action passes `objectBytes` here instead. */
const bucketOf = (keys: readonly string[]) =>
  new Map(
    keys.map((key) => [
      key,
      key.endsWith('-2') ? onePagePdf('Route 2004467999') : jpeg(),
    ]),
  )

const ioOver = (bucket: ReadonlyMap<string, Uint8Array>) => ({
  read: inOrg,
  write: inOrg,
  fetchBytes: (key: string) => Promise.resolve(bucket.get(key) ?? null),
})

describe('filePacketForLoad — the button, end to end', () => {
  it('builds the packet and only then moves the status', async () => {
    const seeded = await seedFiledCandidate('w1')

    const before = await inOrg((tx) => filingStateFor(tx, seeded.id))
    expect(before!.canFile).toBe(true)
    expect(before!.canMarkPaid).toBe(false)
    expect(before!.readiness.missing).toEqual([])
    expect(before!.billingStatus).not.toBe('FILED_WITH_FACTOR')

    const outcome = await filePacketForLoad(
      ioOver(bucketOf(seeded.keys)),
      seeded.id,
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.pageCount).toBe(4)

    const after = await inOrg((tx) => filingStateFor(tx, seeded.id))
    expect(after!.billingStatus).toBe('FILED_WITH_FACTOR')
    expect(after!.canFile).toBe(false)
    expect(after!.canMarkPaid).toBe(true)

    // The second click is refused, and the status is untouched by it.
    const again = await filePacketForLoad(
      ioOver(bucketOf(seeded.keys)),
      seeded.id,
    )
    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.reason.kind).toBe('already_filed')
  }, 300_000)

  // THE ORDER IS THE POINT. `FILED_WITH_FACTOR` is a DECIDED status: it takes
  // the load off the ready-to-file list and off the drift check, so a load
  // marked filed whose packet never assembled is one nobody looks at again.
  it('leaves the status alone when the bucket has nothing at the key', async () => {
    const seeded = await seedFiledCandidate('w2')

    const outcome = await filePacketForLoad(ioOver(new Map()), seeded.id)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason.kind).toBe('packet')

    const after = await inOrg((tx) => filingStateFor(tx, seeded.id))
    expect(after!.billingStatus).not.toBe('FILED_WITH_FACTOR')
    expect(after!.canFile).toBe(true)
  }, 300_000)

  // The screen's read and the packet's read must answer the same question.
  it('reports the missing piece without rendering an invoice', async () => {
    const seeded = await seedFiledCandidate('w3')
    await owner.document.deleteMany({
      where: { loadId: seeded.id, type: 'BOL' },
    })

    const state = await inOrg((tx) => filingStateFor(tx, seeded.id))
    expect(state!.canFile).toBe(false)
    expect(state!.readiness.missing).toEqual(['BOL'])
    expect(state!.notFactored).toBeNull()

    const outcome = await filePacketForLoad(
      ioOver(bucketOf(seeded.keys)),
      seeded.id,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason.kind).toBe('not_ready')
  }, 300_000)

  it('refuses a load whose customer settles directly', async () => {
    const relay = await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `RELAY ${nonce}` }),
    )
    await owner.customer.update({
      where: { id: relay.id },
      data: { settlesDirectly: true },
    })
    const seeded = await seedFiledCandidate('w4')
    await owner.load.update({
      where: { id: seeded.id },
      data: { customerId: relay.id },
    })

    const state = await inOrg((tx) => filingStateFor(tx, seeded.id))
    expect(state!.canFile).toBe(false)
    expect(state!.notFactored).toContain('settles directly')

    const outcome = await filePacketForLoad(
      ioOver(bucketOf(seeded.keys)),
      seeded.id,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason.kind).toBe('not_factored')
  }, 300_000)
})

// ---------------------------------------------------------------------------
// THE REAL WERNER AGREEMENT, FILED ON A SEEDED LOAD.
//
// The acceptance for foreign-PDF embedding, and it is deliberately the whole
// path rather than the importer alone: a load in the database, a document row,
// the bytes of `corpus/werner-1..pdf` where R2 would have them, and the packet
// read back out of the file it produced.
//
// THAT FILE IS FIVE SCANNED PAGES WITH NO TEXT IN IT. The splicer this
// replaced found no text operators, contributed zero pages, and the packet
// refused — so this load could not be filed at all until now. `corpus/` is
// gitignored, so this skips where it is absent; `tests/pdf-import.test.ts`
// carries the structural half by hand for exactly that reason.
// ---------------------------------------------------------------------------

const WERNER_RATECON = 'corpus/werner-1..pdf'

describe.skipIf(!existsSync(WERNER_RATECON))(
  'the real Werner rate confirmation goes into a packet',
  () => {
    it('files it, and the packet carries all five of its pages', async () => {
      const seeded = await seedFiledCandidate('wr')
      const werner = new Uint8Array(readFileSync(WERNER_RATECON))

      // The rate confirmation's key is the third — `seedFiledCandidate` writes
      // POD, BOL, then RATE_CONFIRMATION — so the bucket answers with the real
      // file where the fixture PDF used to be.
      const bucket = new Map(bucketOf(seeded.keys))
      bucket.set(seeded.keys[2]!, werner)

      const outcome = await filePacketForLoad(ioOver(bucket), seeded.id)
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return

      // 1 invoice + 1 POD + 1 BOL + Werner's 5.
      expect(outcome.pageCount).toBe(8)

      // READ BACK OUT OF THE BYTES, not taken from the return value. The count
      // the assembler reports and the count the file contains are two claims,
      // and the one that matters to a factor is the second.
      const text = new TextDecoder('latin1').decode(outcome.pdf)
      expect((text.match(/\/Type\s*\/Page(?![s])/g) ?? []).length).toBe(8)

      // The two scans are still JPEGs carried whole, and Werner's own pages
      // brought their own compressed streams with them.
      expect((text.match(/\/DCTDecode/g) ?? []).length).toBe(2)
      expect((text.match(/\/FlateDecode/g) ?? []).length).toBeGreaterThan(10)

      const after = await inOrg((tx) => filingStateFor(tx, seeded.id))
      expect(after!.billingStatus).toBe('FILED_WITH_FACTOR')
    }, 300_000)
  },
)

import type { DocumentType } from '@/generated/prisma/client'
import { invoicePdfFor } from './invoice-render'
import {
  buildInvoicePacket,
  MAX_PACKET_SOURCE_BYTES,
  orderSources,
  packetInputsHash,
  type InvoicePacketRefusal,
} from './invoice-packet'
import { loadDetailView } from './load-detail-view'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// MERGE DOWNLOAD: THE INVOICE PACKET, STORED ONCE PER INPUTS (TMS §7.14 item
// 5; BROKER-LOAD-BRIEF step 4, R4 and R9).
//
// ── FOUR PHASES, AND THE NETWORK IS NEVER INSIDE A TRANSACTION ───────────
//
// The factoring filing's shape (`factoring-filing.ts`): read the rows and
// render the invoice inside a transaction; fetch from R2 outside it; build
// purely; write the row in a second short transaction. `objectBytes` and
// `putObject` call `assertOutsideTransaction`, so a fetch moved inside the
// read fails by name rather than holding a Postgres connection across R2.
//
// ── R4: THE SAME INPUTS ARE THE SAME PACKET ──────────────────────────────
//
// The plan computes `packetInputsHash` from the rows alone — each source's
// stored SHA-256 in packet order, then the invoice id — so a matching live
// packet is answered with ITS bytes and nothing is fetched, built or written.
// Changed inputs build a new packet; the old one is soft-deleted with
// `supersededByDocumentId` pointing at the new, kept in history, never a
// second live one. Two clicks racing are settled inside the write: the second
// finds the first's row with the same hash and returns it.
//
// ── R9: THE CAP IS CHECKED ON THE ROWS, BEFORE A BYTE IS FETCHED ─────────
//
// `sizeBytes` is on every document row, so a packet over 20 MB is refused
// without pulling 20 MB into a 128 MB isolate first. `buildInvoicePacket`
// checks again on the bytes, which are the truth.
// ---------------------------------------------------------------------------

const SOURCE_TYPES: DocumentType[] = ['POD', 'BOL', 'RATE_CONFIRMATION']

/** Invoices that are not paper anybody should send. */
const DEAD_INVOICE = ['VOID', 'WRITTEN_OFF'] as const

export interface InvoicePacketSourceRow {
  id: string
  type: DocumentType
  mimeType: string
  filename: string
  r2Key: string
  sha256: string | null
  sizeBytes: number
}

export type InvoicePacketPlanRefusal =
  | { kind: 'load_not_found' }
  | { kind: 'not_broker' }
  | InvoicePacketRefusal

export interface InvoicePacketPlan {
  loadId: string
  loadNumber: string
  organizationId: string
  companyId: string
  inputsHash: string
  invoiceId: string | null
  invoicePdf: Uint8Array | null
  sources: InvoicePacketSourceRow[]
  /** The live packet with the same inputs, when there is one. */
  reuse: { id: string; r2Key: string } | null
}

/** A source's identity: its stored hash, or its row when none was stored. */
const identity = (source: InvoicePacketSourceRow) =>
  source.sha256 ?? `document:${source.id}`

/** Phase one: the rows, the hash and the invoice page. Inside a transaction. */
export async function invoicePacketPlanFor(
  tx: TxClient,
  loadId: string,
): Promise<
  | { ok: true; plan: InvoicePacketPlan }
  | { ok: false; reason: InvoicePacketPlanRefusal }
> {
  const load = await tx.load.findFirst({
    where: { id: loadId, deletedAt: null },
    select: {
      id: true,
      loadNumber: true,
      organizationId: true,
      companyId: true,
      directSettled: true,
      customer: { select: { name: true } },
      documents: {
        where: {
          deletedAt: null,
          OR: [{ type: { in: SOURCE_TYPES } }, { type: 'INVOICE_PACKET' }],
        },
        orderBy: { uploadedAt: 'asc' },
        select: {
          id: true,
          type: true,
          mimeType: true,
          filename: true,
          r2Key: true,
          sha256: true,
          sizeBytes: true,
          packetInputsHash: true,
        },
      },
      invoiceLines: {
        where: {
          invoice: {
            deletedAt: null,
            status: { notIn: [...DEAD_INVOICE] },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { invoiceId: true },
      },
    },
  })
  if (!load) return { ok: false, reason: { kind: 'load_not_found' } }
  // AMAZON AND DIRECT-SETTLED FREIGHT HAS NO PACKET: nobody is invoiced and
  // the paperwork lives in Relay (§7.13).
  if (!loadDetailView(load).brokerShape) {
    return { ok: false, reason: { kind: 'not_broker' } }
  }

  const sources = orderSources(
    load.documents.filter((document) => document.type !== 'INVOICE_PACKET'),
  )
  if (sources.length === 0) {
    return { ok: false, reason: { kind: 'nothing_to_merge' } }
  }

  const invoiceId = load.invoiceLines[0]?.invoiceId ?? null
  const invoicePdf = invoiceId ? await invoicePdfFor(tx, invoiceId) : null

  const bytes =
    sources.reduce((sum, source) => sum + source.sizeBytes, 0) +
    (invoicePdf?.byteLength ?? 0)
  if (bytes > MAX_PACKET_SOURCE_BYTES) {
    return {
      ok: false,
      reason: { kind: 'too_large', bytes, limit: MAX_PACKET_SOURCE_BYTES },
    }
  }

  const inputsHash = await packetInputsHash(sources.map(identity), invoiceId)
  const live = load.documents.find(
    (document) =>
      document.type === 'INVOICE_PACKET' &&
      document.packetInputsHash === inputsHash,
  )

  return {
    ok: true,
    plan: {
      loadId: load.id,
      loadNumber: load.loadNumber,
      organizationId: load.organizationId,
      companyId: load.companyId,
      inputsHash,
      invoiceId,
      invoicePdf,
      sources,
      reuse: live ? { id: live.id, r2Key: live.r2Key } : null,
    },
  }
}

export interface InvoicePacketIo {
  read: <T>(fn: (tx: TxClient) => Promise<T>) => Promise<T>
  /** The write transaction, with the user who asked — the packet's uploader. */
  write: <T>(fn: (tx: TxClient, userId: string) => Promise<T>) => Promise<T>
  fetchBytes: (key: string) => Promise<Uint8Array | null>
  putBytes: (key: string, bytes: Uint8Array) => Promise<void>
  /** A fresh object key's unique part. Injected so tests can name it. */
  newId: () => string
}

export type InvoicePacketDownload =
  | {
      ok: true
      pdf: Uint8Array
      filename: string
      documentId: string
      /** True when the stored packet answered and nothing was built. */
      reused: boolean
      /** The invoice inside the packet, when one exists (Merge & send marks it sent). */
      invoiceId: string | null
    }
  | { ok: false; reason: InvoicePacketPlanRefusal }

/** The packet's filename: the load's number, as Datatruck names it. */
export const invoicePacketFilename = (loadNumber: string) =>
  `packet-${loadNumber}.pdf`

/** Phases one to four: the packet, reused or built and stored. */
export async function invoicePacketForLoad(
  io: InvoicePacketIo,
  loadId: string,
): Promise<InvoicePacketDownload> {
  const planned = await io.read((tx) => invoicePacketPlanFor(tx, loadId))
  if (!planned.ok) return planned
  const plan = planned.plan
  const filename = invoicePacketFilename(plan.loadNumber)

  if (plan.reuse) {
    const stored = await io.fetchBytes(plan.reuse.r2Key)
    // A ROW WHOSE OBJECT IS GONE IS REBUILT, not served as nothing.
    if (stored) {
      return {
        ok: true,
        pdf: stored,
        filename,
        documentId: plan.reuse.id,
        reused: true,
        invoiceId: plan.invoiceId,
      }
    }
  }

  // ONE FETCH PER KEY, as the factoring packet does.
  const bytesByKey = new Map<string, Uint8Array>()
  for (const key of new Set(plan.sources.map((source) => source.r2Key))) {
    const bytes = await io.fetchBytes(key)
    if (bytes) bytesByKey.set(key, bytes)
  }
  const parts = []
  for (const source of plan.sources) {
    const bytes = bytesByKey.get(source.r2Key)
    // THE ROW AND THE BUCKET DISAGREEING NEVER MAKES A PACKET THAT LOOKS
    // COMPLETE.
    if (!bytes) {
      return {
        ok: false,
        reason: {
          kind: 'no_pages_from',
          type: source.type,
          filename: source.filename,
        },
      }
    }
    parts.push({
      type: source.type,
      mimeType: source.mimeType,
      filename: source.filename,
      bytes,
      sha256: identity(source),
    })
  }

  const built = buildInvoicePacket({
    sources: parts,
    invoicePdf: plan.invoicePdf,
  })
  if (!built.ok) return built

  const r2Key = `${plan.organizationId}/load/${plan.loadId}/${io.newId()}-${filename}`
  await io.putBytes(r2Key, built.pdf)
  const sha256 = await sha256Hex(built.pdf)

  const stored = await io.write((tx, userId) =>
    storeInvoicePacket(tx, {
      plan,
      userId,
      r2Key,
      filename,
      sha256,
      sizeBytes: built.pdf.byteLength,
      pageCount: built.pageCount,
    }),
  )
  if (stored.raced) {
    // Another click stored the same inputs first; its bytes are the same
    // packet. Ours is an orphan object the reconciliation sweep clears.
    return {
      ok: true,
      pdf: built.pdf,
      filename,
      documentId: stored.documentId,
      reused: true,
      invoiceId: plan.invoiceId,
    }
  }
  return {
    ok: true,
    pdf: built.pdf,
    filename,
    documentId: stored.documentId,
    reused: false,
    invoiceId: plan.invoiceId,
  }
}

/** Phase four: one live packet per load, the old one superseded. */
export async function storeInvoicePacket(
  tx: TxClient,
  input: {
    plan: InvoicePacketPlan
    userId: string
    r2Key: string
    filename: string
    sha256: string
    sizeBytes: number
    pageCount: number
  },
): Promise<{ documentId: string; raced: boolean }> {
  // TWO WRITES FOR ONE LOAD TAKE TURNS. Without this, two clicks whose plans
  // both found no packet each read "none live" here under READ COMMITTED and
  // each created one — two live packets, and Merge & send then claimed and
  // sent both (step 5's integration run, 2026-11-23). The load row's lock
  // makes the second write wait for the first to commit, and its read below
  // then sees the first's packet and answers `raced`.
  await tx.$queryRaw`SELECT id FROM "Load" WHERE id = ${input.plan.loadId} FOR UPDATE`
  const live = await tx.document.findMany({
    where: {
      loadId: input.plan.loadId,
      type: 'INVOICE_PACKET',
      deletedAt: null,
    },
    select: { id: true, packetInputsHash: true },
  })
  const same = live.find(
    (document) => document.packetInputsHash === input.plan.inputsHash,
  )
  if (same) return { documentId: same.id, raced: true }

  const created = await tx.document.create({
    data: {
      organizationId: input.plan.organizationId,
      companyId: input.plan.companyId,
      loadId: input.plan.loadId,
      type: 'INVOICE_PACKET',
      r2Key: input.r2Key,
      filename: input.filename,
      mimeType: 'application/pdf',
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      pageCount: input.pageCount,
      packetInputsHash: input.plan.inputsHash,
      uploadedByUserId: input.userId,
    },
    select: { id: true },
  })
  for (const old of live) {
    await tx.document.update({
      where: { id: old.id },
      data: { deletedAt: new Date(), supersededByDocumentId: created.id },
    })
  }
  return { documentId: created.id, raced: false }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** Every refusal as a sentence naming what to go and do. */
export function invoicePacketRefusalDetail(
  reason: Exclude<InvoicePacketPlanRefusal, { kind: 'load_not_found' }>,
): string {
  switch (reason.kind) {
    case 'not_broker':
      return 'This load settles directly; its paperwork is on Amazon Relay and it has no invoice packet.'
    case 'nothing_to_merge':
      return 'Nothing to merge yet: upload the POD, the BOL or the rate con first.'
    case 'too_large':
      return `The files come to ${(reason.bytes / 1_048_576).toFixed(1)} MB, over the ${reason.limit / 1_048_576} MB a packet may hold. Remove a duplicate or re-upload a smaller scan.`
    case 'no_pages_from':
      return `${reason.filename} (${reason.type}) is missing from storage or has no pages. Upload it again.`
    case 'unreadable_image':
      return `The ${reason.type} could not be read as an image. Convert it to JPEG and upload it again.`
    case 'unimportable':
      return `${reason.filename} could not be merged (${reason.why}). Open it and re-save it as a PDF, then upload it again.`
    case 'not_ready':
      // The factoring packet's readiness refusal; the invoice packet never
      // raises it, and says so rather than printing nothing.
      return `Missing: ${reason.missing.join(', ')}.`
  }
}

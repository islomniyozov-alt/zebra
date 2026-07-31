import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { runInOrg } from '@/lib/tenancy'
import { unattributed, type Attribution } from '@/lib/audit'
import { deleteObject, headObject, r2ConfigFromEnv } from '@/lib/r2'
import {
  ConfirmError,
  DocumentPolicyError,
  MAX_UPLOAD_BYTES,
  confirmUpload,
  mintDownloadUrl,
  mintUpload,
  reconcileExpiredUploads,
} from '@/lib/documents'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// §9 against real R2 and a real Neon branch, as zebra_app.
//
// The point of these is the refusals. A presigned URL that works is easy; the
// value is in proving that the same URL cannot be used for a different file, a
// bigger file, another tenant's entity, or a Document row with nothing behind
// it.
// ---------------------------------------------------------------------------

const config = r2ConfigFromEnv()

let app: PrismaClient
let owner: PrismaClient

let orgA = ''
let orgB = ''
let companyA = ''
let loadA = ''
let loadB = ''
let userA = ''
let attribution: Attribution

const keysTouched = new Set<string>()

const PDF = new TextEncoder().encode('%PDF-1.4 pretend proof of delivery')

const digestOf = async (bytes: Uint8Array): Promise<string> => {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer>,
  )
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
}

let sha256 = ''

const makeOrg = async (label: string) => {
  const nonce = Math.random().toString(36).slice(2, 10)
  const organization = await owner.organization.create({
    data: {
      name: `Docs ${label}`,
      slug: `docs-${label}-${nonce}`,
      companies: { create: { name: 'Authority' } },
    },
    include: { companies: true },
  })
  const company = organization.companies[0]!
  const customer = await owner.customer.create({
    data: { organizationId: organization.id, name: 'Broker' },
  })
  const load = await owner.load.create({
    data: {
      organizationId: organization.id,
      companyId: company.id,
      customerId: customer.id,
      loadNumber: `L-${nonce}`,
    },
  })
  return {
    organizationId: organization.id,
    companyId: company.id,
    loadId: load.id,
  }
}

beforeAll(async () => {
  app = retryingClient(process.env.DATABASE_URL!)
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  sha256 = await digestOf(PDF)

  const a = await makeOrg('a')
  const b = await makeOrg('b')
  orgA = a.organizationId
  companyA = a.companyId
  loadA = a.loadId
  orgB = b.organizationId
  loadB = b.loadId

  const user = await owner.user.create({
    data: { email: `docs-${Date.now()}@example.test`, name: 'Uploader' },
  })
  userA = user.id
  attribution = {
    userId: userA,
    ip: '203.0.113.9',
    userAgent: 'zebra-tests/1.0',
  }
})

afterAll(async () => {
  for (const key of keysTouched) {
    await deleteObject(config, key).catch(() => {})
  }
  for (const id of [orgA, orgB]) {
    if (id) await owner.organization.delete({ where: { id } }).catch(() => {})
  }
  if (userA) await owner.user.delete({ where: { id: userA } }).catch(() => {})
  await app.$disconnect()
  await owner.$disconnect()
})

const mint = (
  overrides: Record<string, unknown> = {},
  orgId = orgA,
  entityId = loadA,
) =>
  runInOrg(
    app,
    orgId,
    async (tx) => {
      const minted = await mintUpload(
        tx,
        orgId,
        {
          entity: 'load',
          entityId,
          filename: 'POD.pdf',
          mimeType: 'application/pdf',
          sizeBytes: PDF.byteLength,
          sha256Base64: sha256,
          documentType: 'POD',
          ...overrides,
        },
        { requestedByUserId: userA },
      )
      keysTouched.add(minted.key)
      return minted
    },
    { attribution },
  )

const put = (url: string, headers: Record<string, string>, body: Uint8Array) =>
  fetch(url, { method: 'PUT', headers, body: body as BodyInit })

describe('the round trip', () => {
  it('uploads direct to R2 and reads back through a signed GET', async () => {
    const minted = await mint()

    // The browser would do exactly this: PUT the bytes to the URL with the
    // headers it was handed. No Worker in the path.
    const uploaded = await put(minted.url, minted.headers, PDF)
    expect(uploaded.status).toBe(200)

    const confirmed = await runInOrg(
      app,
      orgA,
      (tx) =>
        confirmUpload(tx, orgA, minted.pendingUploadId, {
          uploadedByUserId: userA,
        }),
      { attribution },
    )

    const document = await owner.document.findUniqueOrThrow({
      where: { id: confirmed.documentId },
    })
    expect(document.r2Key).toBe(minted.key)
    expect(document.loadId).toBe(loadA)
    expect(document.sizeBytes).toBe(PDF.byteLength)
    expect(document.type).toBe('POD')
    // The digest R2 verified, not one the client restated.
    expect(document.sha256).toBe(sha256)

    // The mint is consumed, so reconciliation cannot mistake it for an orphan.
    expect(
      await owner.pendingUpload.count({ where: { r2Key: minted.key } }),
    ).toBe(0)

    const download = await runInOrg(
      app,
      orgA,
      (tx) => mintDownloadUrl(tx, confirmed.documentId),
      {
        attribution: unattributed('read-only download URL check'),
      },
    )
    expect(download).not.toBeNull()

    const fetched = await fetch(download!.url)
    expect(fetched.status).toBe(200)
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(PDF)
    expect(fetched.headers.get('content-disposition')).toContain('POD.pdf')
  })

  it('does not serve the bucket without a signature', async () => {
    const minted = await mint()
    await put(minted.url, minted.headers, PDF)

    // Same object, no signature. A public bucket would answer 200 here.
    const unsigned = `${config.endpoint}/${config.bucket}/${minted.key}`
    const response = await fetch(unsigned)
    expect(response.status).toBeGreaterThanOrEqual(400)
  })
})

describe('the URL is bound to exactly one file', () => {
  it('refuses a different content type', async () => {
    const minted = await mint()
    const response = await put(
      minted.url,
      { ...minted.headers, 'content-type': 'text/html' },
      PDF,
    )
    expect(response.status).toBe(403)
    expect(await headObject(config, minted.key)).toBeNull()
  })

  it('refuses a larger body', async () => {
    // The criterion: an oversized PUT is refused by the URL's own constraints,
    // not by anything we remembered to check afterwards.
    //
    // The bigger content-length is sent honestly, because that is what a
    // browser uploading a bigger file actually does. Keeping the signed
    // (smaller) value instead makes the local HTTP client abort the socket,
    // which would test undici rather than R2.
    const minted = await mint()
    const bigger = new TextEncoder().encode(
      new TextDecoder().decode(PDF) + ' padding padding',
    )
    const response = await put(
      minted.url,
      { ...minted.headers, 'content-length': String(bigger.byteLength) },
      bigger,
    )
    expect(response.status).toBe(403)
    expect(await headObject(config, minted.key)).toBeNull()
  })

  it('refuses different bytes of the same length', async () => {
    // Length and type both match; only the content differs. The signed
    // checksum is what catches this.
    const minted = await mint()
    const swapped = new Uint8Array(PDF)
    swapped[0] = swapped[0]! ^ 0xff
    const response = await put(minted.url, minted.headers, swapped)
    // 400 BadDigest here rather than 403: R2 reports a checksum mismatch
    // differently from a signature mismatch. Both refuse before storing.
    expect([400, 403]).toContain(response.status)
    expect(await headObject(config, minted.key)).toBeNull()
  })

  it('refuses a PUT with the signed headers stripped', async () => {
    const minted = await mint()
    const response = await put(minted.url, {}, PDF)
    expect(response.status).toBe(403)
  })
})

describe('mint-time authorization', () => {
  it('will not mint for another organization’s load', async () => {
    // Scoped to A, asking for B's load. Row-level security makes it absent
    // rather than forbidden, and no URL is ever created.
    await expect(mint({}, orgA, loadB)).rejects.toThrow(DocumentPolicyError)
    expect(
      await owner.pendingUpload.count({ where: { targetId: loadB } }),
    ).toBe(0)
  })

  it('will not mint for an entity that does not exist', async () => {
    await expect(mint({}, orgA, 'cms5nope000000000000000zz')).rejects.toThrow(
      /No load with that id/,
    )
  })

  it('will not mint for an entity documents cannot attach to', async () => {
    await expect(mint({ entity: 'user' })).rejects.toThrow(/Cannot attach/)
  })

  it('refuses a file over the cap, before signing anything', async () => {
    await expect(mint({ sizeBytes: MAX_UPLOAD_BYTES + 1 })).rejects.toThrow(
      /limited to/,
    )
  })

  it('refuses a media type that is not on the allowlist', async () => {
    await expect(mint({ mimeType: 'text/html' })).rejects.toThrow(
      /not an accepted file type/,
    )
  })

  it('refuses a malformed digest', async () => {
    await expect(mint({ sha256Base64: 'not-a-digest' })).rejects.toThrow(
      /base64 SHA-256/,
    )
  })
})

describe('phantom rows', () => {
  it('refuses to confirm an upload that never happened', async () => {
    // The asymmetry §9 rules on: an orphan object is garbage only R2 knows
    // about, but a Document row pointing at nothing is a 404 during a broker
    // dispute.
    const minted = await mint()

    await expect(
      runInOrg(
        app,
        orgA,
        (tx) => confirmUpload(tx, orgA, minted.pendingUploadId),
        {
          attribution,
        },
      ),
    ).rejects.toThrow(ConfirmError)

    expect(await owner.document.count({ where: { r2Key: minted.key } })).toBe(0)
    // The mint survives, so it is still reconcilable rather than forgotten.
    expect(
      await owner.pendingUpload.count({ where: { r2Key: minted.key } }),
    ).toBe(1)
  })

  it('refuses to confirm another organization’s mint', async () => {
    const minted = await mint()
    await put(minted.url, minted.headers, PDF)

    await expect(
      runInOrg(
        app,
        orgB,
        (tx) => confirmUpload(tx, orgB, minted.pendingUploadId),
        {
          attribution: unattributed('cross-tenant confirm attempt'),
        },
      ),
    ).rejects.toThrow(/No such pending upload/)

    expect(await owner.document.count({ where: { r2Key: minted.key } })).toBe(0)
  })

  it('refuses to confirm an expired mint even though the object is there', async () => {
    const minted = await mint()
    await put(minted.url, minted.headers, PDF)
    await owner.pendingUpload.update({
      where: { id: minted.pendingUploadId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    await expect(
      runInOrg(
        app,
        orgA,
        (tx) => confirmUpload(tx, orgA, minted.pendingUploadId),
        {
          attribution,
        },
      ),
    ).rejects.toThrow(/expired/)
  })

  it('cannot confirm the same mint twice', async () => {
    const minted = await mint()
    await put(minted.url, minted.headers, PDF)

    await runInOrg(
      app,
      orgA,
      (tx) => confirmUpload(tx, orgA, minted.pendingUploadId),
      {
        attribution,
      },
    )

    // The mint is gone, so a replayed confirm cannot produce a second row for
    // the same object.
    await expect(
      runInOrg(
        app,
        orgA,
        (tx) => confirmUpload(tx, orgA, minted.pendingUploadId),
        {
          attribution,
        },
      ),
    ).rejects.toThrow(/No such pending upload/)

    expect(await owner.document.count({ where: { r2Key: minted.key } })).toBe(1)
  })
})

describe('reconciliation', () => {
  it('clears expired mints and the orphans behind them', async () => {
    const uploaded = await mint()
    await put(uploaded.url, uploaded.headers, PDF)
    const abandoned = await mint()

    for (const id of [uploaded.pendingUploadId, abandoned.pendingUploadId]) {
      await owner.pendingUpload.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      })
    }

    const result = await runInOrg(
      app,
      orgA,
      (tx) => reconcileExpiredUploads(tx),
      {
        attribution: unattributed('scheduled reconciliation sweep'),
      },
    )

    expect(result.expiredMints).toBeGreaterThanOrEqual(2)
    expect(result.orphansDeleted).toBeGreaterThanOrEqual(1)
    // The uploaded-but-unconfirmed object is gone; nothing referenced it.
    expect(await headObject(config, uploaded.key)).toBeNull()
    expect(
      await owner.pendingUpload.count({
        where: {
          id: { in: [uploaded.pendingUploadId, abandoned.pendingUploadId] },
        },
      }),
    ).toBe(0)
  })

  it('leaves a live mint alone', async () => {
    const live = await mint()
    const result = await runInOrg(
      app,
      orgA,
      (tx) => reconcileExpiredUploads(tx),
      {
        attribution: unattributed('scheduled reconciliation sweep'),
      },
    )
    expect(result.expiredMints).toBe(0)
    expect(
      await owner.pendingUpload.count({ where: { id: live.pendingUploadId } }),
    ).toBe(1)
  })
})

describe('documents obey the tenant wall', () => {
  it('will not mint a download URL for another organization’s document', async () => {
    const minted = await mint()
    await put(minted.url, minted.headers, PDF)
    const confirmed = await runInOrg(
      app,
      orgA,
      (tx) => confirmUpload(tx, orgA, minted.pendingUploadId),
      { attribution },
    )

    const asOther = await runInOrg(
      app,
      orgB,
      (tx) => mintDownloadUrl(tx, confirmed.documentId),
      {
        attribution: unattributed('cross-tenant download attempt'),
      },
    )
    expect(asOther).toBeNull()
  })

  it('records the company the target belongs to', async () => {
    const minted = await mint()
    const pending = await owner.pendingUpload.findUniqueOrThrow({
      where: { id: minted.pendingUploadId },
    })
    expect(pending.companyId).toBe(companyA)
  })
})

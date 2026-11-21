import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { photoFolders, setPhotoStage } from '@/lib/load-photos'
import type { TxClient } from '@/lib/tenancy'

// THE BROKER LOAD'S PHOTOS, OTHER PAY AND COMMODITIES (TMS §7.14 item 4;
// BROKER-LOAD-BRIEF step 3).

const doc = (over: Record<string, unknown>) => ({
  id: 'd',
  type: 'PHOTO',
  photoStage: null,
  deletedAt: null,
  ...over,
})

describe('photoFolders', () => {
  it('puts each live staged photo in its folder and nothing else anywhere', () => {
    const folders = photoFolders([
      doc({ id: 'p1', photoStage: 'PICKUP' }),
      doc({ id: 'd1', photoStage: 'DELIVERY' }),
      doc({ id: 'loose' }),
      doc({ id: 'gone', photoStage: 'PICKUP', deletedAt: new Date() }),
      doc({ id: 'pod', type: 'POD', photoStage: 'DELIVERY' }),
    ] as {
      id: string
      type: string
      photoStage: 'PICKUP' | 'DELIVERY' | null
      deletedAt: Date | null
    }[])
    expect(folders.PICKUP.map((row) => row.id)).toEqual(['p1'])
    expect(folders.DELIVERY.map((row) => row.id)).toEqual(['d1'])
  })
})

function stubTx(found: { id: string; type: string } | null) {
  const updates: unknown[] = []
  const tx = {
    document: {
      findFirst: async () => found,
      update: async (args: unknown) => {
        updates.push(args)
        return {}
      },
    },
  } as unknown as TxClient
  return { tx, updates }
}

describe('setPhotoStage', () => {
  it('files this load’s photo into a folder', async () => {
    const { tx, updates } = stubTx({ id: 'p1', type: 'PHOTO' })
    expect(await setPhotoStage(tx, 'l1', 'p1', 'PICKUP')).toEqual({ ok: true })
    expect(updates).toEqual([
      { where: { id: 'p1' }, data: { photoStage: 'PICKUP' } },
    ])
  })

  it('refuses a stage that is not a folder, a missing document, and a POD', async () => {
    const bad = stubTx({ id: 'p1', type: 'PHOTO' })
    expect(await setPhotoStage(bad.tx, 'l1', 'p1', 'YARD')).toEqual({
      ok: false,
      reason: 'bad_stage',
    })
    const missing = stubTx(null)
    expect(await setPhotoStage(missing.tx, 'l1', 'p1', 'PICKUP')).toEqual({
      ok: false,
      reason: 'not_found',
    })
    const pod = stubTx({ id: 'p1', type: 'POD' })
    expect(await setPhotoStage(pod.tx, 'l1', 'p1', 'DELIVERY')).toEqual({
      ok: false,
      reason: 'not_a_photo',
    })
    expect([...bad.updates, ...missing.updates, ...pod.updates]).toEqual([])
  })
})

describe('the page', () => {
  const page = readFileSync('src/app/(app)/loads/[id]/page.tsx', 'utf8')

  it('shows Other pay on broker freight to a role that may see money', () => {
    expect(page).toMatch(
      /const otherPayNode =\s*view\.brokerShape && maySeeRate \?/,
    )
  })

  it('shows Commodities only when Zebra stores one of its four fields', () => {
    expect(page).toContain(
      'view.brokerShape && commodityFacts.some((fact) => fact.value) ? (',
    )
  })

  it('puts the photo folders on the Documents tab, on broker freight', () => {
    expect(page).toContain('const photosNode = view.brokerShape ? (')
    expect(page).toMatch(/\{documentsNode\}\s*\{photosNode\}/)
  })

  it('keeps the note a person typed on an Other pay line', () => {
    const actions = readFileSync(
      'src/app/(app)/loads/[id]/rate-actions.ts',
      'utf8',
    )
    expect(actions).toContain(
      "notes: String(formData.get('notes') ?? '').trim() || null,",
    )
  })
})

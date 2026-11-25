import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import {
  createAssetWithRegistration,
  RegistrationRefused,
} from '@/lib/new-asset'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// ADD TRUCK BY DOCUMENT SAVES THE UNIT AND ITS REGISTRATION TOGETHER (TMS §6.5
// part 4, v11.55). The REGISTRATION compliance item is written in the unit's
// own transaction, with the expiry the person confirmed, so the renewal
// warning reads it from the first moment; a filing the renewal refuses rolls
// the unit back. Without a document the unit is created as before, alone.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'new-asset.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  organizationId = (
    await owner.organization.create({
      data: { name: `New asset ${nonce}`, slug: `new-asset-${nonce}` },
    })
  ).id
  companyId = (
    await owner.company.create({
      data: { organizationId, name: `Cyber ${nonce}` },
    })
  ).id
  userId = (
    await owner.user.create({
      data: { email: `new-asset-${nonce}@example.test`, name: 'Fleet' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

const expiresAt = new Date('2027-03-31T00:00:00.000Z')
const issuedAt = new Date('2026-03-31T00:00:00.000Z')

describe('Save with a registration held', () => {
  it('creates the truck and its REGISTRATION item with the expiry, plate and state', async () => {
    const created = await inOrg((tx) =>
      createAssetWithRegistration(
        tx,
        organizationId,
        'truck',
        {
          companyId,
          unitNumber: `R1-${nonce}`,
          plate: 'P123456',
          plateState: 'IL',
          ownerName: 'CYBER TRUCKING INC',
          lessorName: 'BROS LEASING INC',
          fuelType: 'Diesel',
          grossWeightLbs: '80000',
        },
        { expiresAt, issuedAt, identifier: 'P123456', issuer: 'IL' },
        { byUserId: userId },
      ),
    )
    expect(created.registrationId).not.toBeNull()
    const item = await owner.complianceItem.findUniqueOrThrow({
      where: { id: created.registrationId! },
    })
    expect(item).toMatchObject({
      type: 'REGISTRATION',
      truckId: created.id,
      organizationId,
      identifier: 'P123456',
      issuer: 'IL',
      deletedAt: null,
    })
    expect(item.expiresAt?.toISOString()).toBe(expiresAt.toISOString())
    // Part 5: the card's issue date files on the item, not on the truck.
    expect(item.issuedAt?.toISOString()).toBe(issuedAt.toISOString())
    const truck = await owner.truck.findUniqueOrThrow({
      where: { id: created.id },
    })
    expect(truck).toMatchObject({
      ownerName: 'CYBER TRUCKING INC',
      lessorName: 'BROS LEASING INC',
      fuelType: 'Diesel',
      grossWeightLbs: 80_000,
    })
  }, 300_000)

  it('files a trailer’s registration on the trailer', async () => {
    const created = await inOrg((tx) =>
      createAssetWithRegistration(
        tx,
        organizationId,
        'trailer',
        { companyId, unitNumber: `RT1-${nonce}` },
        { expiresAt, issuedAt: null, identifier: null, issuer: null },
        { byUserId: userId },
      ),
    )
    const item = await owner.complianceItem.findUniqueOrThrow({
      where: { id: created.registrationId! },
    })
    expect(item).toMatchObject({
      type: 'REGISTRATION',
      trailerId: created.id,
      truckId: null,
    })
  }, 300_000)

  it('a filing the renewal refuses rolls the truck back with it', async () => {
    const unitNumber = `R2-${nonce}`
    await expect(
      inOrg((tx) =>
        createAssetWithRegistration(
          tx,
          organizationId,
          'truck',
          { companyId, unitNumber },
          {
            expiresAt: new Date('not a date'),
            issuedAt: null,
            identifier: null,
            issuer: null,
          },
          { byUserId: userId },
        ),
      ),
    ).rejects.toBeInstanceOf(RegistrationRefused)
    expect(
      await owner.truck.count({ where: { organizationId, unitNumber } }),
    ).toBe(0)
  }, 300_000)
})

describe('Save without a document', () => {
  it('creates the truck alone, as part 3 does', async () => {
    const created = await inOrg((tx) =>
      createAssetWithRegistration(
        tx,
        organizationId,
        'truck',
        { companyId, unitNumber: `R3-${nonce}` },
        null,
        { byUserId: userId },
      ),
    )
    expect(created.registrationId).toBeNull()
    expect(
      await owner.complianceItem.count({ where: { truckId: created.id } }),
    ).toBe(0)
  }, 300_000)
})

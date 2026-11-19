import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { truckFields } from '@/app/(app)/trucks/fields'
import {
  TRUCK_DETAIL_FIELDS,
  TRUCK_FORM_FIELDS,
  TRUCK_IDENTITY_FIELDS,
  TRUCK_STATUS_FIELDS,
  truckFormValues,
} from '@/lib/truck-form'
import type { Translate } from '@/lib/i18n'

// THE TRUCK RECORD'S FORM (TMS v11.36 §6.5 part 2, owner 2026-11-19). Owner
// name and four more fields were on the form, written by Save, and never
// loaded back — the record reloaded blank. Every field the form offers now
// has a value from `truckFormValues`, a place on one of the two tabs, and a
// line in the edit action's reader. tests/integration/truck-form.test.ts
// saves and reloads every one.

const t = ((key: string) => key) as unknown as Translate
const offered = truckFields(t, [], 'edit')
  .filter((spec) => spec.kind !== 'hidden' && spec.kind !== 'confirm')
  .map((spec) => spec.name)

describe('every field the edit form offers', () => {
  it('is on exactly one tab', () => {
    expect([...offered].sort()).toEqual([...TRUCK_FORM_FIELDS].sort())
    const placed = [
      ...TRUCK_IDENTITY_FIELDS,
      ...TRUCK_STATUS_FIELDS,
      ...TRUCK_DETAIL_FIELDS,
    ]
    expect(new Set(placed).size).toBe(placed.length)
  })

  it('has a value loaded back from the stored truck — the five that were lost included', () => {
    const values = truckFormValues({
      unitNumber: '104',
      vin: '1XKAD49X0DJ000001',
      plate: 'P104',
      plateState: 'IL',
      make: 'Kenworth',
      model: 'T680',
      year: 2021,
      status: 'MAINTENANCE',
      ownershipType: 'LEASED',
      currentOdometer: 412_000,
      notes: 'washed',
      fuelType: 'Diesel',
      fleetStatus: 'In shop',
      ownerName: 'Karimov Leasing',
      grossWeightLbs: 52_000,
      axles: 3,
    })
    expect(Object.keys(values).sort()).toEqual([...TRUCK_FORM_FIELDS].sort())
    expect(values).toMatchObject({
      ownerName: 'Karimov Leasing',
      fleetStatus: 'In shop',
      fuelType: 'Diesel',
      axles: '3',
      grossWeightLbs: '52000',
    })
  })

  it('is read by the edit action only when the form sent it', () => {
    const actions = readFileSync('src/app/(app)/trucks/actions.ts', 'utf8')
    for (const name of TRUCK_FORM_FIELDS)
      expect(actions).toContain(`sent(formData, '${name}')`)
    expect(actions).toMatch(/updateTruck\(tx, id, readEdit\(formData\)\)/)
  })

  it('the page takes its values from truckFormValues, not a hand-built list', () => {
    const page = readFileSync('src/app/(app)/trucks/[id]/page.tsx', 'utf8')
    expect(page).toContain('const values = truckFormValues(truck)')
    expect(page).not.toMatch(/ownershipType: truck\.ownershipType,/)
  })
})

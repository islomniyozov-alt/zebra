import { describe, expect, it } from 'vitest'
import { baseAddress, normalizeAddress, stateFor } from '@/lib/inbound-email'
import type { LoadWarning } from '@/lib/load-warnings'

// Phase 6 §4 step 4. The two decisions mail makes before a person sees it:
// which address it arrived at, and whether anything about it wants stopping
// for. Both are pure, and both are the kind of thing that fails silently.

const warning = (kind: LoadWarning['kind']): LoadWarning => ({
  kind,
  messageKey: 'loads.warn.missingPickupDate',
  values: {},
})

describe('the address the mail arrived at', () => {
  it.each([
    ['loads@zebratms.com', 'loads@zebratms.com'],
    ['Loads@ZebraTMS.com', 'loads@zebratms.com'],
    ['  loads@zebratms.com  ', 'loads@zebratms.com'],
    // A From header is frequently the whole display form.
    ['Amazon Relay <relay-noreply@amazon.com>', 'relay-noreply@amazon.com'],
  ])('normalises %s', (raw, expected) => {
    expect(normalizeAddress(raw)).toBe(expected)
  })

  // PLUS-ADDRESSING IS THE ONE THAT WOULD HAVE BITTEN. A dispatcher sets up a
  // forwarding rule that tags the address and the tenant silently stops
  // matching — freight landing nowhere, with nothing on any screen to say so.
  it.each([
    ['loads+amazon@zebratms.com', 'loads@zebratms.com'],
    ['loads+anything+at+all@zebratms.com', 'loads@zebratms.com'],
    ['loads@zebratms.com', 'loads@zebratms.com'],
    // A plus in the DOMAIN is not a tag, and there is no local part to trim.
    ['loads@zebra+tms.com', 'loads@zebra+tms.com'],
  ])('folds the tag off %s', (raw, expected) => {
    expect(baseAddress(raw)).toBe(expected)
  })

  it('survives something that is not an address at all', () => {
    expect(baseAddress('not-an-address')).toBe('not-an-address')
  })
})

describe('which state an email lands in', () => {
  it('is READY when it read cleanly and nothing is worth saying', () => {
    expect(stateFor({ read: true, warnings: [] })).toBe('READY')
  })

  // WAS CONFLICT, IS NOW UNREAD, AND THE OLD COMMENT HERE EXPLAINED THE
  // CONFLATION RATHER THAN A DECISION: "unread is CONFLICT rather than REVIEW:
  // there is nothing to review." True, and it put "we could not read it" —
  // a claim about US — under a word that means "this may already be a load",
  // a claim about FREIGHT. So an unreadable message sorted beside a duplicate
  // booking, and a deferred one would have too. See tests/unread-state.test.ts.
  it('is UNREAD when the reader could not read it', () => {
    expect(stateFor({ read: false, warnings: [] })).toBe('UNREAD')
  })

  it('is REVIEW when something wants a person but nothing contradicts', () => {
    expect(
      stateFor({ read: true, warnings: [warning('missing_pickup_date')] }),
    ).toBe('REVIEW')
  })

  // THE DUPLICATE FAMILY IS THE CONFLICT FAMILY. Each one means "this booking
  // may already BE a load", which is spec §11's whole subject — and creating
  // the second one is the mistake the state exists to prevent.
  it.each([
    'duplicate_bol',
    'duplicate_po',
    'duplicate_reference',
    'duplicate_load',
  ] as const)('is CONFLICT for %s', (kind) => {
    expect(stateFor({ read: true, warnings: [warning(kind)] })).toBe('CONFLICT')
  })

  it('lets a conflict outrank a mere review', () => {
    expect(
      stateFor({
        read: true,
        warnings: [warning('missing_pickup_date'), warning('duplicate_bol')],
      }),
    ).toBe('CONFLICT')
  })
})

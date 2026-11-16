import { nameKey } from './name-key'

// ---------------------------------------------------------------------------
// IS THIS AN AMAZON LOAD — ONE PREDICATE, TWO SIDES (§7.13).
//
// §7.12's Amazon rules hang on `Load.directSettled`, copied from the customer
// when `createLoad` books the freight. The Datatruck history import never sets
// it, so its Amazon loads — 11,196 in the year's export — read
// `directSettled = false` and got the broker screen: rate con and POD
// "missing", a factoring checklist, a fuel surcharge on a fuel-included rate.
//
// SO THERE ARE TWO WAYS A LOAD IS AMAZON'S, AND EITHER IS ENOUGH:
//
//   BROKER — the customer is Amazon by name. A STATED TABLE, compared by
//   `nameKey`, never a similarity rule: a matcher loose enough to pair
//   "AMAZON LOGISTICS" with "Amazon Relay" would pair two real brokers
//   somewhere else. `Amazon Relay` is `RELAY_CUSTOMER_NAME`, which the history
//   import aliases `AMAZON LOGISTICS` to; `AMAZON LOGISTICS` itself is here
//   because dev created that row before the alias table existed.
//
//   RELAY — `directSettled`. `Load` has no source column; the Relay importers
//   book through `createLoad` against `Amazon Relay`, which settles directly,
//   so the flag is the mark a Relay-booked load carries. FLAGGED in §7.13: a
//   second direct-settling customer would count as Amazon here.
//
// Every §7.13 rule reads `isAmazonLoad` and nothing else. The two sides are
// exported so the agreement test can prove neither of them is dead.
// ---------------------------------------------------------------------------

/** Customer names that are Amazon, exactly as written. */
export const AMAZON_CUSTOMER_NAMES = [
  'Amazon Relay',
  'AMAZON LOGISTICS',
] as const

const AMAZON_KEYS: ReadonlySet<string> = new Set(
  AMAZON_CUSTOMER_NAMES.map(nameKey),
)

/** The broker side: the load's customer is Amazon by name. */
export function amazonByBroker(load: { customer: { name: string } }): boolean {
  return AMAZON_KEYS.has(nameKey(load.customer.name))
}

/** The Relay side: booked against a customer that settles directly. */
export function amazonByRelay(load: { directSettled: boolean }): boolean {
  return load.directSettled
}

export function isAmazonLoad(load: {
  directSettled: boolean
  customer: { name: string }
}): boolean {
  return amazonByBroker(load) || amazonByRelay(load)
}

import { describe, expect, it } from 'vitest'
import {
  ACCESSORIAL_TYPES,
  accessorialChoicesFor,
  loadDetailView,
  type LoadDetailView,
} from '@/lib/load-detail-view'

// ---------------------------------------------------------------------------
// SIX DISPLAY ITEMS BEHIND ONE READ.
//
// The Amazon load-detail redesign is six branches on `directSettled`, and they
// lived inside a server component where nothing could check them. A screen that
// shows the Documents panel to the wrong freight looks exactly like a screen;
// the failure is that a dispatcher is asked for a POD that lives in Relay, or —
// worse in the other direction — that broker freight quietly loses the panel it
// needs to get paid.
//
// SO BOTH ANSWERS ARE WRITTEN OUT IN FULL below, as objects rather than as six
// assertions. A field added to `LoadDetailView` without a decision for it fails
// to compile here, and a field whose default is wrong is visible by reading two
// blocks side by side rather than by tracing six conditionals through JSX.
// ---------------------------------------------------------------------------

describe('the screen a load gets', () => {
  // The three kinds of load §7.13 tells apart. A Relay booking settles
  // directly; the Datatruck history import's Amazon load does not carry the
  // flag; broker freight is neither.
  const relay = { directSettled: true, customer: { name: 'Amazon Relay' } }
  const imported = {
    directSettled: false,
    customer: { name: 'Amazon Relay' },
  }
  const werner = { directSettled: false, customer: { name: 'Werner' } }

  const amazon: LoadDetailView = {
    showAssignment: true,
    copyableIdentifiers: true,
    showStopTimezone: false,
    editStopAddress: true,
    showFuelSurcharge: false,
    documentsOnRelay: true,
    brokerShape: false,
    stopsAsTable: true,
    flagMissingAddress: true,
    notesInTimeline: true,
    showFactoring: false,
    // §7.12: the arrangement is a fact, and the tracker's fourth word is the
    // statement's, not the invoice's.
    paymentTypeDerived: true,
    settledWord: 'onStatement',
  }

  const broker: LoadDetailView = {
    showAssignment: false,
    copyableIdentifiers: false,
    showStopTimezone: true,
    editStopAddress: false,
    showFuelSurcharge: true,
    documentsOnRelay: false,
    brokerShape: true,
    stopsAsTable: false,
    flagMissingAddress: false,
    notesInTimeline: false,
    showFactoring: true,
    paymentTypeDerived: false,
    settledWord: 'invoiced',
  }

  it('strips the panels Relay freight does not use', () => {
    expect(loadDetailView(relay)).toEqual(amazon)
  })

  it('leaves broker freight the full screen', () => {
    expect(loadDetailView(werner)).toEqual(broker)
  })

  // §7.13 — THE LOAD THE BRIEF WAS ABOUT. DT-018794 came from the history
  // import: Amazon's by its customer, not flagged direct. The Amazon rules
  // apply; §7.12's direct-settlement rules still read the flag.
  it("gives an imported Amazon load Amazon's screen and keeps the flag's rules", () => {
    expect(loadDetailView(imported)).toEqual({
      ...broker,
      showFuelSurcharge: false,
      documentsOnRelay: true,
      brokerShape: false,
      showFactoring: false,
    })
  })

  // THE HALF THAT MATTERS MOST TO GET WRONG. On broker freight the POD upload
  // IS how the load becomes payable and invoiceable; a card that told it the
  // paperwork lives in Relay would be silent about the slot it needs.
  it('never tells freight that needs documents that they are on Relay', () => {
    expect(loadDetailView(werner).documentsOnRelay).toBe(false)
  })

  // MONEY §7. Broker freight is the only freight that is ever factored, and a
  // Factoring panel on an Amazon load is a button whose only possible outcome
  // is a refusal — and its "Still missing:" list asks for Relay's paperwork.
  it('offers factoring only on freight that can be invoiced', () => {
    expect(loadDetailView(werner).showFactoring).toBe(true)
    expect(loadDetailView(relay).showFactoring).toBe(false)
    expect(loadDetailView(imported).showFactoring).toBe(false)
  })

  // Relay and broker freight differ on every field: each field is one of the
  // two decisions, and a Relay load is both direct-settled and Amazon's.
  it('differs on every field between Relay and broker freight', () => {
    for (const key of Object.keys(amazon) as (keyof LoadDetailView)[]) {
      expect(amazon[key], key).not.toBe(broker[key])
    }
  })

  it('is frozen, so a caller cannot answer differently further down', () => {
    const view = loadDetailView(relay)
    expect(Object.isFrozen(view)).toBe(true)
  })
})

describe('the accessorials a load may be given', () => {
  it('offers TONU alone on direct-settled freight', () => {
    expect(
      accessorialChoicesFor(ACCESSORIAL_TYPES, { directSettled: true }),
    ).toEqual(['TONU'])
  })

  it('offers the whole list to broker freight', () => {
    expect(
      accessorialChoicesFor(ACCESSORIAL_TYPES, { directSettled: false }),
    ).toEqual(ACCESSORIAL_TYPES)
  })

  // THE FILTER IS OVER THE SHARED LIST, and this is what says so. If TONU were
  // ever renamed or dropped upstream, an accessorial list that returned a
  // hardcoded ['TONU'] would keep offering a type the rest of the application
  // no longer has — so the shared list must actually contain it.
  it('takes TONU from the shared list rather than inventing it', () => {
    expect(ACCESSORIAL_TYPES).toContain('TONU')
  })

  // A LIST OF TWELVE IS THE FAILURE THIS PREVENTS: billing Amazon for a lumper
  // it will never reimburse.
  it('drops the broker vocabulary Relay does not pay', () => {
    const offered = accessorialChoicesFor(ACCESSORIAL_TYPES, {
      directSettled: true,
    })
    expect(offered.length).toBe(1)
    expect(ACCESSORIAL_TYPES.length).toBeGreaterThan(1)
  })
})

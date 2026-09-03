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
  const amazon: LoadDetailView = {
    showAssignment: true,
    copyableIdentifiers: true,
    showStopTimezone: false,
    editStopAddress: true,
    showFuelSurcharge: false,
    editMiles: true,
    showDocuments: false,
    numberedStops: true,
    flagMissingAddress: true,
    notesInTimeline: true,
  }

  const broker: LoadDetailView = {
    showAssignment: false,
    copyableIdentifiers: false,
    showStopTimezone: true,
    editStopAddress: false,
    showFuelSurcharge: true,
    editMiles: false,
    showDocuments: true,
    numberedStops: false,
    flagMissingAddress: false,
    notesInTimeline: false,
  }

  it('strips the panels Relay freight does not use', () => {
    expect(loadDetailView({ directSettled: true })).toEqual(amazon)
  })

  it('leaves broker freight the full screen', () => {
    expect(loadDetailView({ directSettled: false })).toEqual(broker)
  })

  // THE HALF THAT MATTERS MOST TO GET WRONG. Removing the Documents panel is
  // safe on direct-settled freight only because `transitionOperational` fires
  // the POD there; on broker freight the POD upload IS how the load becomes
  // payable and invoiceable, and losing it would be silent.
  it('never takes the documents panel off freight that needs it', () => {
    expect(loadDetailView({ directSettled: false }).showDocuments).toBe(true)
  })

  // Every decision comes from the one flag, so the two answers must differ on
  // every field. A field that reads the same both ways is either a mistake or
  // does not belong in this module.
  it('differs on every field, because every field is that one decision', () => {
    for (const key of Object.keys(amazon) as (keyof LoadDetailView)[]) {
      expect(amazon[key], key).not.toBe(broker[key])
    }
  })

  it('is frozen, so a caller cannot answer differently further down', () => {
    const view = loadDetailView({ directSettled: true })
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

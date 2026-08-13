import type { Translate } from '@/lib/i18n'

// The FMCSA lookup's words, in one place.
//
// A PLAIN MODULE so a server page can build them and a client component can
// hold the type. Two screens ask the register the same question, and eleven
// label keys listed twice is eleven chances for one screen to say something
// the other does not.

export interface FmcsaLabels {
  lookup: string
  lookupPending: string
  lookupHint: string
  lookupFilled: string
  from: string
  title: string
  entity: string
  operation: string
  status: string
  rating: string
  dba: string
}

export function fmcsaLabels(t: Translate): FmcsaLabels {
  return {
    lookup: t('fmcsa.lookup'),
    lookupPending: t('fmcsa.lookupPending'),
    lookupHint: t('fmcsa.lookupHint'),
    lookupFilled: t('fmcsa.lookupFilled'),
    from: t('fmcsa.from'),
    title: t('fmcsa.title'),
    entity: t('fmcsa.entity'),
    operation: t('fmcsa.operation'),
    status: t('fmcsa.status'),
    rating: t('fmcsa.rating'),
    dba: t('fmcsa.dba'),
  }
}

/** What the panel shows. Shown, never stored — no table has columns for it. */
export interface FmcsaPanelData {
  entityType: string | null
  operation: string | null
  safetyRating: string | null
  dbaName: string | null
  /** `Active` / `Inactive`, already in the reader's language. */
  status: string | null
  /** One sentence per thing worth saying. Possibly empty. */
  concerns: string[]
}

/**
 * What a lookup action returns, whatever table it is filling.
 *
 * Generic over the prefill, because `Company` and `Customer` are different
 * tables with different columns and a shared mapping would be a mapping
 * neither caller could read.
 */
export interface FmcsaAnswer<Prefill> {
  /** Pre-translated. Present means the form was left exactly as it was. */
  error: string | null
  found: (FmcsaPanelData & { prefill: Prefill }) | null
}

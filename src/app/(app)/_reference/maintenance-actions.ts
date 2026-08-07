'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { recordWorkOrder, type MaintenanceSubject } from '@/lib/maintenance'
import { MoneyFormatError, parseMoneyToCents } from '@/lib/money'
import { normalizeTypedDate, utcMidnight } from '@/lib/typed-date'
import { MAINTENANCE_INITIAL, type MaintenanceState } from './maintenance-state'
import type { MaintenanceCategory } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

// Recording a work order is `maintenance:create` — FLEET_WRITE, so a DISPATCHER
// cannot open one. They read the history because a truck in the shop is a
// dispatch fact; what it cost is not theirs (§2.5).
//
// THE COST IS PARSED HERE, by money.ts, and travels as integer cents. The
// service refuses a non-integer, so an amount that somehow arrived as a float
// is a refusal rather than a fraction of a cent nobody can reproduce.

const ERRORS: Record<string, MessageKey> = {
  subject_not_found: 'maintPanel.error.subjectNotFound',
  no_date: 'maintPanel.error.noDate',
  bad_odometer: 'maintPanel.error.badOdometer',
  bad_cost: 'maintPanel.error.badCost',
}

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

/** A typed whole number, or `undefined` if the field was left blank. */
function optionalCount(value: string): number | null | undefined {
  if (value === '') return null
  const cleaned = value.replace(/[\s,]/g, '')
  if (!/^\d+$/.test(cleaned)) return undefined
  const parsed = Number.parseInt(cleaned, 10)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export async function recordWorkOrderAction(
  subject: MaintenanceSubject,
  subjectId: string,
  _previous: MaintenanceState,
  formData: FormData,
): Promise<MaintenanceState> {
  // "810" is the 10th of August — the same typed-date field the load form and
  // the compliance panel use.
  const serviced = normalizeTypedDate(text(formData, 'servicedAt'))
  if (!serviced) {
    return { error: 'maintPanel.error.noDate', createdId: null }
  }

  const nextTyped = text(formData, 'nextServiceAt')
  const next = nextTyped === '' ? null : normalizeTypedDate(nextTyped)
  if (nextTyped !== '' && !next) {
    return { error: 'maintPanel.error.noDate', createdId: null }
  }

  // A BLANK COST IS ZERO, not a refusal. Warranty work and a recall both cost
  // nothing and both belong in the history; forcing somebody to type "0" to
  // record one is how they stop recording them.
  const costTyped = text(formData, 'cost')
  let costCents = 0
  if (costTyped !== '') {
    try {
      costCents = parseMoneyToCents(costTyped)
    } catch (error) {
      if (error instanceof MoneyFormatError) {
        return { error: 'maintPanel.error.badCost', createdId: null }
      }
      throw error
    }
  }

  const odometer = optionalCount(text(formData, 'odometer'))
  const nextOdometer = optionalCount(text(formData, 'nextServiceOdometer'))
  if (odometer === undefined || nextOdometer === undefined) {
    return { error: 'maintPanel.error.badOdometer', createdId: null }
  }

  const outcome = await withCurrentOrg('create', 'maintenance', (tx) =>
    recordWorkOrder(tx, {
      subject,
      subjectId,
      servicedAt: utcMidnight(serviced),
      category: text(formData, 'category') as MaintenanceCategory,
      costCents,
      odometer,
      vendorName: text(formData, 'vendorName'),
      description: text(formData, 'description'),
      notes: text(formData, 'notes'),
      nextServiceAt: next ? utcMidnight(next) : null,
      nextServiceOdometer: nextOdometer,
    }),
  )

  if (!outcome.ok) {
    return {
      error: ERRORS[outcome.reason] ?? 'maintPanel.error.subjectNotFound',
      createdId: null,
    }
  }

  revalidatePath(
    subject === 'truck' ? `/trucks/${subjectId}` : `/trailers/${subjectId}`,
  )
  revalidatePath('/maintenance')

  return { ...MAINTENANCE_INITIAL, createdId: outcome.recordId }
}

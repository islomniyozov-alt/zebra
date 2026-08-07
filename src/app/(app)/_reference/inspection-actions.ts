'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import {
  addViolation,
  recordInspection,
  withdrawViolation,
} from '@/lib/inspections'
import { normalizeTypedDate, utcMidnight } from '@/lib/typed-date'
import { INSPECTION_INITIAL, type InspectionState } from './inspection-state'
import type { InspectionLevel, ViolationUnit } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

// Recording an inspection is `inspection:create` — FLEET_WRITE. A DISPATCHER
// reads them (an out-of-service driver is a dispatch fact) and files none.

const RECORD_ERRORS: Record<string, MessageKey> = {
  no_subject: 'ins.error.noSubject',
  subject_not_found: 'ins.error.subjectNotFound',
  mixed_authority: 'ins.error.mixedAuthority',
  no_date: 'ins.error.noDate',
  bad_state: 'ins.error.badState',
}

const VIOLATION_ERRORS: Record<string, MessageKey> = {
  inspection_not_found: 'ins.error.inspectionNotFound',
  no_code: 'ins.error.noCode',
  bad_weight: 'ins.error.badWeight',
}

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

export async function recordInspectionAction(
  _previous: InspectionState,
  formData: FormData,
): Promise<InspectionState> {
  const typed = normalizeTypedDate(text(formData, 'inspectedAt'))
  if (!typed) return { error: 'ins.error.noDate' }

  const outcome = await withCurrentOrg('create', 'inspection', (tx) =>
    recordInspection(tx, {
      truckId: text(formData, 'truckId') || null,
      trailerId: text(formData, 'trailerId') || null,
      driverId: text(formData, 'driverId') || null,
      inspectedAt: utcMidnight(typed),
      level: text(formData, 'level') as InspectionLevel,
      state: text(formData, 'state'),
      reportNumber: text(formData, 'reportNumber'),
      location: text(formData, 'location'),
      inspectorName: text(formData, 'inspectorName'),
      notes: text(formData, 'notes'),
    }),
  )

  if (!outcome.ok) {
    return { error: RECORD_ERRORS[outcome.reason] ?? 'ins.error.noSubject' }
  }

  revalidatePath('/safety/inspections')
  // STRAIGHT TO THE EVENT, because recording one is never the whole job: the
  // violations go on next, and landing back on the list would mean finding the
  // row you just created before you could carry on.
  redirect(`/safety/inspections/${outcome.inspectionId}`)
}

export async function addViolationAction(
  inspectionId: string,
  _previous: InspectionState,
  formData: FormData,
): Promise<InspectionState> {
  const weightTyped = text(formData, 'severityWeight')
  let severityWeight: number | null = null
  if (weightTyped !== '') {
    if (!/^\d+$/.test(weightTyped)) return { error: 'ins.error.badWeight' }
    severityWeight = Number.parseInt(weightTyped, 10)
  }

  const outcome = await withCurrentOrg('update', 'inspection', (tx) =>
    addViolation(tx, {
      inspectionId,
      code: text(formData, 'code'),
      description: text(formData, 'description'),
      unit: text(formData, 'unit') as ViolationUnit,
      // An unchecked box posts nothing at all, so absence is false.
      outOfService: formData.get('outOfService') !== null,
      severityWeight,
    }),
  )

  if (!outcome.ok) {
    return {
      error: VIOLATION_ERRORS[outcome.reason] ?? 'ins.error.inspectionNotFound',
    }
  }

  revalidatePath(`/safety/inspections/${inspectionId}`)
  revalidatePath('/safety/inspections')
  return INSPECTION_INITIAL
}

export async function withdrawViolationAction(
  inspectionId: string,
  violationId: string,
): Promise<void> {
  await withCurrentOrg('update', 'inspection', (tx) =>
    withdrawViolation(tx, violationId),
  )
  revalidatePath(`/safety/inspections/${inspectionId}`)
  revalidatePath('/safety/inspections')
}

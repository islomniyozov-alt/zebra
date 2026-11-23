import type { ComplianceType } from '@/generated/prisma/client'
import type { MessageKey } from './i18n'
import { normalizeTypedDate, utcMidnight } from './typed-date'

// ---------------------------------------------------------------------------
// THE COMPLIANCE PANEL'S FORM, READ (§0 rule 14, v11.45).
//
// Out of the `'use server'` action so it can be tested without an auth
// context (AGENTS.md: the action reads the form, calls one function,
// revalidates). Two promises it keeps:
//
//   * IT NEVER DEPENDS ON A READER. What the person typed is what gets
//     saved; nothing here asks what a document reader said, so a reading that
//     failed entirely leaves this path exactly as usable.
//   * A REFUSAL HANDS BACK EVERYTHING TYPED, and names the field it could not
//     read and why. On dev, 2026-11-23, an expiry typed `2/18/2027` answered
//     "Enter the expiry date." about a field that held one, and the form came
//     back empty.
// ---------------------------------------------------------------------------

/** Every field the panel's form sends, in the order it shows them. */
export const COMPLIANCE_FORM_FIELDS = [
  'type',
  'expiresAt',
  'issuedAt',
  'identifier',
  'issuer',
  'notes',
] as const

export type ComplianceFormField = (typeof COMPLIANCE_FORM_FIELDS)[number]
export type ComplianceFormValues = Record<ComplianceFormField, string>

export interface RenewalFields {
  type: ComplianceType
  expiresAt: Date
  issuedAt: Date | null
  identifier: string
  issuer: string
  notes: string
  cdlClass: string
}

export type ReadRenewalForm =
  | { ok: true; fields: RenewalFields; values: ComplianceFormValues }
  | { ok: false; error: MessageKey; values: ComplianceFormValues }

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

/** What the person typed, field by field — handed back on any refusal. */
export function typedValues(formData: FormData): ComplianceFormValues {
  return Object.fromEntries(
    COMPLIANCE_FORM_FIELDS.map((field) => [field, text(formData, field)]),
  ) as ComplianceFormValues
}

export function readRenewalForm(
  formData: FormData,
  today: Date = new Date(),
): ReadRenewalForm {
  const values = typedValues(formData)

  if (values.expiresAt === '') {
    return { ok: false, error: 'compliancePanel.error.noExpiry', values }
  }
  // "810" is the 10th of August and `2/18/2027` the 18th of February — the
  // same typed-date field the load form uses (see typed-date.ts).
  const expires = normalizeTypedDate(values.expiresAt, today)
  if (!expires) {
    return { ok: false, error: 'compliancePanel.error.expiryNotDate', values }
  }

  const issued =
    values.issuedAt === '' ? null : normalizeTypedDate(values.issuedAt, today)
  if (values.issuedAt !== '' && !issued) {
    return { ok: false, error: 'compliancePanel.error.issuedNotDate', values }
  }

  return {
    ok: true,
    values,
    fields: {
      type: values.type as ComplianceType,
      expiresAt: utcMidnight(expires),
      issuedAt: issued ? utcMidnight(issued) : null,
      identifier: values.identifier,
      issuer: values.issuer,
      notes: values.notes,
      // Only the licence reader sends it; it fills Main's empty class.
      cdlClass: text(formData, 'cdlClass'),
    },
  }
}

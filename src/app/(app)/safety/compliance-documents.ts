import type { ComplianceType } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// COMPLIANCE DOCUMENTS THIS SYSTEM CAN READ.
//
// ── ONE FRONT DOOR, NOT ONE LINK PER TYPE ─────────────────────────────────
//
// Registration and annual inspections are next, and the shape they must not
// arrive in is a second "Add a registration" link beside the first, each with
// its own zone, its own copy and its own idea of what a drop means. That is
// three of everything by the time inspections land.
//
// So the intake is generic and THIS LIST is what it reads from. Adding a
// document type is a row here plus its reader — never another control on the
// screen.
//
// ── THE TYPE IS STATED, NEVER CLASSIFIED FROM THE IMAGE ───────────────────
//
// The obvious alternative is to let a model look at the photograph and decide
// whether it is a medical card or a registration. This codebase refuses that
// kind of inference everywhere else it appears — an enum that told a model the
// permitted answers turned a Georgia `CLASS AM` into `A` at high confidence,
// and a nearest-match over the driver roster would file a certificate against
// a company. A misclassified document is the same failure with a whole
// contract behind it: a registration read by the medical reader would be
// refused for having no expiry it recognises, or worse, would not be.
//
// WHILE THERE IS EXACTLY ONE READABLE TYPE, the intake goes straight to it and
// says so in the copy. When there are two, it has to ask which — and that is a
// change to the intake's rendering, not to this file. The comment is here so
// the person adding registration knows the asking is owed.
// ---------------------------------------------------------------------------

export interface ReadableComplianceDocument {
  /** The row this eventually becomes. */
  type: ComplianceType
  /** The read route. Returns a proposal; it never writes. */
  route: string
  /** What a person calls it — "Medical card". */
  nameKey: MessageKey
}

export const READABLE_COMPLIANCE_DOCUMENTS: readonly ReadableComplianceDocument[] =
  [
    {
      type: 'MEDICAL_CARD',
      route: '/api/med/read',
      nameKey: 'complianceType.MEDICAL_CARD',
    },
    // REGISTRATION and ANNUAL_INSPECTION go here, each with a reader behind
    // the route. Neither has one yet, and listing a type whose route 404s
    // would put a control on screen that cannot work — the intake would offer
    // a choice and then fail on it.
  ]

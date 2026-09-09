import type { ComplianceType, DocumentType } from '@/generated/prisma/client'
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
// ── THE ASKING IS OWED NOW, AND IT IS A PROPOSAL ─────────────────────────
//
// There are two readable types since 2026-09-09, so the intake can no longer
// go straight to one. The owner's ruling settles how it asks:
//
//   CLASSIFICATION PROPOSES, NEVER CHOOSES. The document is classified, read
//   with the proposed type's contract, and the confirm step NAMES the type it
//   decided and lets the person change it — which re-reads with the correct
//   contract. A wrong guess costs one re-read and can never cause a wrong
//   filing. A low-confidence classification asks BEFORE extracting, so a guess
//   never spends a read.
//
// That is the one place the paragraph above bends, and the verdict on the
// confirm step is what makes the bend safe: the type is on screen beside the
// values, and nothing is stored until somebody agrees with both.
// ---------------------------------------------------------------------------

export interface ReadableComplianceDocument {
  /** The compliance row this eventually becomes. */
  type: ComplianceType
  /**
   * The DOCUMENT this is, in the vocabulary the classifier speaks.
   *
   * Two vocabularies, deliberately: `DocumentType` describes the FILE and
   * `ComplianceType` the OBLIGATION, and they are not one-to-one. One ACORD
   * certificate evidences liability AND cargo — one document, two obligations
   * — which is exactly why the classifier answers in the first vocabulary and
   * the reader produces rows in the second.
   */
  documentType: DocumentType
  /** The read route. Returns a proposal; it never writes. */
  route: string
  /** What a person calls it — "Medical card". */
  nameKey: MessageKey
  /**
   * What the CLASSIFIER is told to look for. One sentence, about the
   * document's own headings rather than about what we want off it — a
   * description that mentions expiry dates teaches it to find expiry dates on
   * anything.
   */
  looksLike: string
}

export const READABLE_COMPLIANCE_DOCUMENTS: readonly ReadableComplianceDocument[] =
  [
    {
      type: 'MEDICAL_CARD',
      documentType: 'MEDICAL_CARD',
      route: '/api/med/read',
      nameKey: 'complianceType.MEDICAL_CARD',
      looksLike:
        'a Medical Examiner’s Certificate — a small federal form naming a driver and a medical examiner, with a National Registry number',
    },
    {
      // LIABILITY IS THE ROW THIS FILES FIRST. A certificate usually evidences
      // cargo as well, and `coiProposal` produces that second row when the
      // document actually carries a cargo line — which is why one entry here
      // maps to two possible obligations.
      type: 'INSURANCE_LIABILITY',
      documentType: 'INSURANCE_CERT',
      route: '/api/coi/read',
      nameKey: 'complianceType.INSURANCE_LIABILITY',
      looksLike:
        'an ACORD certificate of liability insurance — a wide grid of coverage rows with INSURED, INSURER and POLICY NUMBER columns, usually headed ACORD',
    },
    // REGISTRATION and ANNUAL_INSPECTION go here, each with a reader behind
    // the route. Neither has one yet, and listing a type whose route 404s
    // would put a control on screen that cannot work — and would give the
    // classifier a type it can propose and nothing can read.
  ]

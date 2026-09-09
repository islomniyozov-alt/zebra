import type { Translate } from '@/lib/i18n'
import { READABLE_COMPLIANCE_DOCUMENTS } from './compliance-documents'

// The certificate panel's pre-translated strings, plus the ones the INTAKE
// needs that are not about any one document type.
//
// A TRANSLATOR CLOSURE CANNOT CROSS TO A CLIENT COMPONENT, so every label has
// to be resolved on the server and handed over — the same reason `medLabels`
// exists and the same reason this is a function rather than a constant.
//
// `typeNames` IS BUILT FROM THE REGISTRY where it names DOCUMENTS, and listed
// by hand where it names OBLIGATIONS — the two vocabularies
// `compliance-documents.ts` keeps apart. One ACORD certificate is one document
// and up to four obligations; a single map would have merged them.
export function coiLabels(t: Translate) {
  return {
    dropTitle: t('safety.intake.dropTitle'),
    heading: t('safety.coi.heading'),
    insured: t('safety.coi.insured'),
    filesAgainst: t('safety.coi.filesAgainst'),
    nobody: t('safety.coi.nobody'),
    coverages: t('safety.coi.coverages'),
    unnamedCoverage: t('safety.coi.unnamedCoverage'),
    filesAs: t('safety.coi.filesAs'),
    pickType: t('safety.coi.pickType'),
    cannotFile: t('safety.coi.cannotFile'),
    confidence: t('safety.coi.confidence'),
    policyNumber: t('safety.coi.policyNumber'),
    insurer: t('safety.coi.insurer'),
    effectiveAt: t('safety.coi.effectiveAt'),
    expiresAt: t('safety.coi.expiresAt'),
    limit: t('safety.coi.limit'),
    vehicles: t('safety.coi.vehicles'),
    vinFills: t('safety.coi.vinFills'),
    vinAlready: t('safety.coi.vinAlready'),
    vinNoTruck: t('safety.coi.vinNoTruck'),
    vinUnreadable: t('safety.coi.vinUnreadable'),
    vinsWritten: t('safety.coi.vinsWritten'),
    none: t('drivers.med.none'),
    file: t('safety.coi.file'),
    filed: t('safety.coi.filed'),
    cancel: t('safety.med.cancel'),
    // ── THE INTAKE'S OWN COPY ─────────────────────────────────────────────
    whichType: t('safety.intake.whichType'),
    readAs: t('safety.intake.readAs'),
    notThat: t('safety.intake.notThat'),
    documentNames: Object.fromEntries(
      READABLE_COMPLIANCE_DOCUMENTS.map((row) => [
        row.documentType,
        t(row.nameKey),
      ]),
    ) as Record<string, string>,
    /** The OBLIGATIONS a coverage row can file as. */
    typeNames: {
      INSURANCE_LIABILITY: t('complianceType.INSURANCE_LIABILITY'),
      INSURANCE_CARGO: t('complianceType.INSURANCE_CARGO'),
      INSURANCE_PHYSICAL_DAMAGE: t('complianceType.INSURANCE_PHYSICAL_DAMAGE'),
      OTHER: t('complianceType.OTHER'),
    } as Record<string, string>,
    confidenceNames: {
      high: t('safety.coi.confidence.high'),
      medium: t('safety.coi.confidence.medium'),
      low: t('safety.coi.confidence.low'),
    } as Record<string, string>,
    /** Why one coverage row cannot become a record. Keyed by `RowRefusal`. */
    rowRefusals: {
      no_expiry: t('safety.coi.row.noExpiry'),
      low_confidence_expiry: t('safety.coi.row.lowConfidenceExpiry'),
      unreadable_expiry: t('safety.coi.row.unreadableExpiry'),
      unreadable_effective: t('safety.coi.row.unreadableEffective'),
      expiry_before_effective: t('safety.coi.row.expiryBeforeEffective'),
      implausible_term: t('safety.coi.row.implausibleTerm'),
    } as Record<string, string>,
    /** Why a VIN failed its check. Never an accusation — see `vin.ts`. */
    vinReasons: {
      wrong_length: t('safety.coi.vin.wrongLength'),
      illegal_character: t('safety.coi.vin.illegalCharacter'),
      check_digit: t('safety.coi.vin.checkDigit'),
    } as Record<string, string>,
    notices: {
      'safety.coi.unreadable': t('safety.coi.unreadable'),
      'safety.coi.contradictory': t('safety.coi.contradictory'),
      'safety.coi.failed': t('safety.coi.failed'),
      'safety.intake.unreadable': t('safety.intake.unreadable'),
      'safety.intake.failed': t('safety.intake.failed'),
    } as Record<string, string>,
  }
}

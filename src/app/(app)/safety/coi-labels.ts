import type { Translate } from '@/lib/i18n'
import { READABLE_COMPLIANCE_DOCUMENTS } from './compliance-documents'

// The certificate panel's pre-translated strings, plus the two the INTAKE
// needs that are not about any one document type.
//
// A TRANSLATOR CLOSURE CANNOT CROSS TO A CLIENT COMPONENT, so every label has
// to be resolved on the server and handed over — the same reason `medLabels`
// exists and the same reason this is a function rather than a constant.
//
// `typeNames` IS BUILT FROM THE REGISTRY rather than listed here. The intake
// renders one button per readable type, and a hand-kept map would be the
// second place to add registration to — and the one that gets missed.
export function coiLabels(t: Translate) {
  return {
    dropTitle: t('safety.intake.dropTitle'),
    heading: t('safety.coi.heading'),
    forCompany: t('safety.coi.forCompany'),
    policyNumber: t('safety.coi.policyNumber'),
    insurer: t('safety.coi.insurer'),
    effectiveAt: t('safety.coi.effectiveAt'),
    expiresAt: t('safety.coi.expiresAt'),
    liability: t('complianceType.INSURANCE_LIABILITY'),
    cargo: t('complianceType.INSURANCE_CARGO'),
    limit: t('safety.coi.limit'),
    none: t('drivers.med.none'),
    file: t('safety.coi.file'),
    filing: t('drivers.med.reading'),
    filed: t('safety.coi.filed'),
    cancel: t('safety.med.cancel'),
    // ── THE INTAKE'S OWN COPY ─────────────────────────────────────────────
    whichType: t('safety.intake.whichType'),
    whichCarrier: t('safety.coi.noCompany'),
    readAs: t('safety.intake.readAs'),
    notThat: t('safety.intake.notThat'),
    typeNames: Object.fromEntries(
      READABLE_COMPLIANCE_DOCUMENTS.map((row) => [
        row.documentType,
        t(row.nameKey),
      ]),
    ) as Record<string, string>,
    notices: {
      'safety.coi.unreadable': t('safety.coi.unreadable'),
      'safety.coi.contradictory': t('safety.coi.contradictory'),
      'safety.coi.failed': t('safety.coi.failed'),
      'safety.intake.unreadable': t('safety.intake.unreadable'),
      'safety.intake.failed': t('safety.intake.failed'),
    } as Record<string, string>,
  }
}

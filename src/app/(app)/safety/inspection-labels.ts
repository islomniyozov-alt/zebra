import type { Translate } from '@/lib/i18n'

// The annual inspection's confirm step, in words (TMS §7.8, v11.47). Built on
// the server and handed to the client component, as `coiLabels` is.

export function inspectionLabels(t: Translate) {
  return {
    heading: t('safety.inspection.heading'),
    truck: t('safety.inspection.truck'),
    proposedByUnit: t('safety.inspection.proposedByUnit'),
    proposedByVin: t('safety.inspection.proposedByVin'),
    chooseTruck: t('safety.inspection.chooseTruck'),
    fleetUnit: t('safety.inspection.fleetUnit'),
    vin: t('safety.inspection.vin'),
    result: t('safety.inspection.result'),
    passed: t('safety.inspection.passed'),
    failed: t('safety.inspection.failed'),
    reportNumber: t('safety.inspection.reportNumber'),
    inspectionDate: t('safety.inspection.inspectionDate'),
    expires: t('safety.inspection.expires'),
    expiresDerived: t('safety.inspection.expiresDerived'),
    inspector: t('safety.inspection.inspector'),
    notes: t('safety.inspection.notes'),
    byHand: t('safety.inspection.byHand'),
    readAs: t('safety.inspection.readAs'),
    file: t('safety.inspection.file'),
    filed: t('safety.inspection.filed'),
    attachFailed: t('safety.inspection.attachFailed'),
    cancel: t('safety.med.cancel'),
    why: {
      not_shown: t('safety.inspection.why.notShown'),
      low_confidence: t('safety.inspection.why.lowConfidence'),
      not_a_date: t('safety.inspection.why.notADate'),
      after_upload: t('safety.inspection.why.afterUpload'),
      vin_invalid: t('safety.inspection.why.vinInvalid'),
      not_pass_fail: t('safety.inspection.why.notPassFail'),
    } as Record<string, string>,
    errors: {
      'compliancePanel.error.noExpiry': t('compliancePanel.error.noExpiry'),
      'compliancePanel.error.expiryNotDate': t(
        'compliancePanel.error.expiryNotDate',
      ),
      'compliancePanel.error.issuedNotDate': t(
        'compliancePanel.error.issuedNotDate',
      ),
      'compliancePanel.error.badDates': t('compliancePanel.error.badDates'),
      'compliancePanel.error.duplicate': t('compliancePanel.error.duplicate'),
      'compliancePanel.error.subjectNotFound': t(
        'compliancePanel.error.subjectNotFound',
      ),
      'safety.inspection.noTruck': t('safety.inspection.noTruck'),
    } as Record<string, string>,
  }
}

export type InspectionLabels = ReturnType<typeof inspectionLabels>

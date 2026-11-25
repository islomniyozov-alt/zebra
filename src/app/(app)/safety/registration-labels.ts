import type { Translate } from '@/lib/i18n'

// A cab card's confirm step on the Safety intake, in words (TMS §7.8,
// v11.57). Built on the server and handed to the client, as
// `inspectionLabels` is.

export function registrationLabels(t: Translate) {
  return {
    heading: t('safety.registration.heading'),
    vin: t('fleet.vin'),
    unitNumber: t('fleet.unitNumber'),
    plate: t('fleet.plate'),
    owner: t('trucks.ownerName'),
    truck: t('safety.inspection.truck'),
    chooseTruck: t('safety.inspection.chooseTruck'),
    matchedBy: {
      vin: t('safety.registration.matchedByVin'),
      unit: t('safety.registration.matchedByUnit'),
      plate: t('safety.registration.matchedByPlate'),
    },
    several: t('safety.registration.several'),
    noTruck: t('safety.registration.noTruck'),
    expires: t('fleet.registration.expires'),
    issued: t('fleet.registration.issued'),
    byHand: t('fleet.registration.byHand'),
    seen: t('fleet.registration.seen'),
    file: t('safety.registration.file'),
    filed: t('safety.registration.filed'),
    attachFailed: t('safety.registration.attachFailed'),
    cancel: t('safety.med.cancel'),
    errors: {
      'fleet.registration.noExpiry': t('fleet.registration.noExpiry'),
      'fleet.registration.expiryNotDate': t('fleet.registration.expiryNotDate'),
      'fleet.registration.issuedNotDate': t('fleet.registration.issuedNotDate'),
      'compliancePanel.error.badDates': t('compliancePanel.error.badDates'),
      'compliancePanel.error.duplicate': t('compliancePanel.error.duplicate'),
      'compliancePanel.error.noExpiry': t('compliancePanel.error.noExpiry'),
      'compliancePanel.error.subjectNotFound': t(
        'compliancePanel.error.subjectNotFound',
      ),
      'safety.inspection.noTruck': t('safety.inspection.noTruck'),
    } as Record<string, string>,
  }
}

export type RegistrationLabels = ReturnType<typeof registrationLabels>

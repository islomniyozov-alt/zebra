import type { Translate } from '@/lib/i18n'

// The upload's pre-translated strings, in one place.
//
// A TRANSLATOR CLOSURE CANNOT CROSS TO A CLIENT COMPONENT, so every label has
// to be resolved on the server and handed over. Gathered here rather than
// inline in the page because the panel is rendered from two places — a row and
// the picker — and two copies of a twenty-key object is one copy and one
// missing key waiting.
export function medLabels(t: Translate) {
  return {
    dropTitle: t('drivers.med.dropTitle'),
    dropBody: t('drivers.med.dropBody'),
    dropHint: t('drivers.med.dropHint'),
    reading: t('drivers.med.reading'),
    heading: t('drivers.med.heading'),
    expires: t('drivers.med.expires'),
    issued: t('drivers.med.issued'),
    examiner: t('drivers.med.examiner'),
    registry: t('drivers.med.registry'),
    asPrinted: t('drivers.med.asPrinted'),
    nameWarning: t('drivers.med.nameWarning'),
    file: t('drivers.med.file'),
    discard: t('drivers.med.discard'),
    filed: t('drivers.med.filed'),
    none: t('drivers.med.none'),
    forDriver: t('safety.med.forDriver'),
    subjectStated: t('safety.med.subjectStated'),
    subjectProposed: t('safety.med.subjectProposed'),
    notThem: t('safety.med.notThem'),
    askNone: t('safety.med.askNone'),
    askMany: t('safety.med.askMany'),
    askBody: t('safety.med.askBody'),
    // PRE-TRANSLATED AND KEYED BY WHAT THE ROUTE RETURNS. The route deals in
    // i18n keys rather than sentences so it stays language-free.
    notices: {
      'drivers.med.unreadable': t('drivers.med.unreadable'),
      'drivers.med.contradictory': t('drivers.med.contradictory'),
      'drivers.med.wrongType': t('drivers.med.wrongType'),
      'drivers.med.tooLarge': t('drivers.med.tooLarge'),
      'drivers.med.notAllowed': t('drivers.med.notAllowed'),
      'drivers.med.failed': t('drivers.med.failed'),
    },
  }
}

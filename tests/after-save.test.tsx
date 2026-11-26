/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { translator } from '@/lib/i18n'
import { judgeRegistration } from '@/lib/extraction/registration-fields'
import { registrationPrefill } from '@/lib/extraction/registration-fields'
import { matchRegistrationUnit } from '@/lib/registration-match'
import { judgeInspection } from '@/lib/extraction/inspection-fields'
import { inspectionPrefill } from '@/lib/annual-inspection'

// ---------------------------------------------------------------------------
// A SAVE SHOWS ITS RESULT BY ITSELF (TMS §0 rule 15, §7.8 v11.59; owner's
// ruling 2026-11-26). The browser half: submit, then the screen moves on —
// the intake back to an empty drop zone with the sentence, the page
// refreshed, the new load opened — with no reload.
//
// The server actions are stubs that answer "filed"; what is under test is
// what the SCREEN does with that answer.
// ---------------------------------------------------------------------------

const refresh = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push }),
}))

const uploadDocument = vi.fn(async () => ({ documentId: 'd1' }))
vi.mock('@/lib/upload-client', () => ({
  uploadDocument: (...a: unknown[]) => uploadDocument(...(a as [])),
  photosAsDocument: vi.fn(),
}))

let filedCount = 0
vi.mock('@/app/(app)/safety/registration-actions', () => ({
  fileRegistrationAction: vi.fn(async () => ({
    error: null,
    createdId: `reg-${++filedCount}`,
    typed: null,
  })),
}))
vi.mock('@/app/(app)/safety/inspection-actions', () => ({
  fileInspectionAction: vi.fn(async () => ({
    error: null,
    createdId: 'insp-1',
    values: null,
  })),
}))
vi.mock('@/app/(app)/safety/coi-actions', () => ({
  fileCoiAction: vi.fn(async () => ({
    error: null,
    filedRecordIds: ['coi-1'],
    vinsFilled: [],
  })),
}))
vi.mock('@/app/(app)/safety/med-actions', () => ({
  fileMedicalCertAction: vi.fn(async () => ({
    error: null,
    filedRecordId: 'med-1',
  })),
}))
const createLoadAction = vi.fn()
vi.mock('@/app/(app)/loads/new/actions', () => ({
  createLoadAction: (...a: unknown[]) => createLoadAction(...a),
}))

const { ComplianceIntake } = await import('@/app/(app)/safety/ComplianceIntake')
const { medLabels } = await import('@/app/(app)/safety/med-labels')
const { coiLabels } = await import('@/app/(app)/safety/coi-labels')
const { inspectionLabels } = await import(
  '@/app/(app)/safety/inspection-labels'
)
const { registrationLabels } = await import(
  '@/app/(app)/safety/registration-labels'
)

const t = translator('en')
const UPLOADED = '2026-11-26'
const high = (value: string) => ({ value, confidence: 'high' as const })

function registrationReading(plate: string) {
  const verdicts = judgeRegistration(
    {
      vin: high('1M8GDM9AXKP042788'),
      plate: high(plate),
      plateState: high('IL'),
      expiresAt: high('03/31/27'),
      year: high('2020'),
      make: high('VOLV'),
      model: null,
      ownerName: high('TEST CARRIER LLC'),
      gvwr: null,
      unitNumber: high('524'),
      issuedAt: null,
      fuel: null,
      vehicleType: high('TT'),
      lessorName: null,
    },
    UPLOADED,
  )
  const units = [
    {
      kind: 'truck' as const,
      id: 't524',
      unitNumber: '524',
      vin: '1M8GDM9AXKP042788',
      plate: null,
      plateState: null,
    },
  ]
  return {
    verdict: {
      type: 'REGISTRATION',
      confidence: 'high',
      because: null,
      stated: false,
    },
    proposal: null,
    notice: null,
    registration: {
      verdicts,
      prefill: registrationPrefill(verdicts),
      match: matchRegistrationUnit(verdicts, units),
      units,
      addForm: 'truck',
    },
  }
}

function inspectionReading() {
  const verdicts = judgeInspection(
    {
      reportNumber: high('160526036'),
      inspectionDate: high('02/18/2026'),
      fleetUnit: high('4974'),
      vin: null,
      inspectorName: null,
      agency: null,
      result: null,
    },
    UPLOADED,
  )
  const trucks = [{ id: 't4974', unitNumber: '4974', vin: null }]
  return {
    verdict: {
      type: 'INSPECTION_REPORT',
      confidence: 'high',
      because: null,
      stated: false,
    },
    proposal: null,
    notice: null,
    inspection: {
      verdicts,
      prefill: inspectionPrefill(verdicts),
      match: { kind: 'one', truck: trucks[0], by: 'unit' },
      trucks,
    },
  }
}

const COI_READING = {
  verdict: {
    type: 'INSURANCE_CERT',
    confidence: 'high',
    because: null,
    stated: false,
  },
  notice: null,
  proposal: {
    coverages: [
      {
        printedType: 'AUTOMOBILE LIABILITY',
        proposedType: 'INSURANCE_LIABILITY',
        caution: null,
        expiresAt: '2027-03-01',
        effectiveAt: '2026-03-01',
        identifier: 'POL-1',
        issuer: 'Insurer',
        limit: null,
        confidence: 'high',
        refusal: null,
      },
    ],
    vehicles: [],
    subject: {
      kind: 'company',
      company: { id: 'c1', name: 'RAM' },
      because: 'named',
    },
    insuredName: 'RAM',
    carrier: null,
  },
}

const MED_READING = {
  verdict: {
    type: 'MEDICAL_CARD',
    confidence: 'high',
    because: null,
    stated: false,
  },
  notice: null,
  proposal: {
    expiresAt: '2027-05-01',
    expiresAtPrinted: '05/01/2027',
    expiresAtConfidence: 'high',
    issuedAt: '2025-05-01',
    issuedAtPrinted: '05/01/2025',
    examinerName: 'Dr Test',
    examinerRegistryNumber: '1234567890',
    nameDisagreement: null,
    printedName: 'Ali Test',
  },
  match: {
    kind: 'one',
    driver: { id: 'dr1', firstName: 'Ali', lastName: 'Test' },
  },
}

let readings: unknown[] = []
beforeEach(() => {
  readings = []
  filedCount = 0
  refresh.mockClear()
  push.mockClear()
  uploadDocument.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => readings.shift(),
    })),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const intake = () =>
  render(
    <ComplianceIntake
      roster={[{ id: 'dr1', firstName: 'Ali', lastName: 'Test' }]}
      labels={medLabels(t)}
      coi={coiLabels(t)}
      inspection={inspectionLabels(t)}
      registration={registrationLabels(t)}
    />,
  )

const zone = () =>
  document.querySelector<HTMLInputElement>('input[type="file"]')

async function drop(name: string) {
  const input = zone()
  expect(input, 'the drop zone is back').not.toBeNull()
  const file = new File(['x'], name, { type: 'application/pdf' })
  await act(async () => {
    fireEvent.change(input!, { target: { files: [file] } })
  })
}

async function file(buttonName: string, filedText: string) {
  const button = await screen.findByRole('button', { name: buttonName })
  await act(async () => {
    fireEvent.click(button)
  })
  // The sentence, ABOVE AN EMPTY ZONE: the reading and "Read as…" are gone.
  await waitFor(() => expect(screen.getByText(filedText)).toBeTruthy())
  expect(zone()).not.toBeNull()
  expect(screen.queryByText(/^Read as/)).toBeNull()
  expect(screen.queryByRole('button', { name: buttonName })).toBeNull()
}

describe('the Safety intake resets after any File', () => {
  it('two registrations filed in a row, no reload between them', async () => {
    intake()
    readings.push(registrationReading('P 1297245'))
    await drop('card-1.pdf')
    await screen.findByText(t('safety.registration.heading'))
    await file(t('safety.registration.file'), t('safety.registration.filed'))
    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(1))
    expect(refresh).toHaveBeenCalledTimes(1)

    readings.push(registrationReading('P 5550001'))
    await drop('card-2.pdf')
    await screen.findByText(t('safety.registration.heading'))
    // Dropping the next document cleared the last sentence.
    expect(screen.queryByText(t('safety.registration.filed'))).toBeNull()
    await file(t('safety.registration.file'), t('safety.registration.filed'))
    expect(uploadDocument).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('an inspection resets it, after its photo is on', async () => {
    intake()
    readings.push(inspectionReading())
    await drop('inspection.pdf')
    await file(t('safety.inspection.file'), t('safety.inspection.filed'))
    expect(uploadDocument).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('an insurance certificate resets it', async () => {
    intake()
    readings.push(COI_READING)
    await drop('coi.pdf')
    await file(
      t('safety.coi.file'),
      t('safety.coi.filed').replace('{count}', '1'),
    )
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('a medical card resets it', async () => {
    intake()
    readings.push(MED_READING)
    await drop('med.pdf')
    await file(t('drivers.med.file'), t('drivers.med.filed'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('the sentence goes by itself; the zone stays', async () => {
    // Installed BEFORE the File, so the line's own timer is a fake one.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    intake()
    readings.push(registrationReading('P 1297245'))
    await drop('card-1.pdf')
    await file(t('safety.registration.file'), t('safety.registration.filed'))
    await act(async () => {
      vi.advanceTimersByTime(6100)
    })
    expect(screen.queryByText(t('safety.registration.filed'))).toBeNull()
    expect(zone()).not.toBeNull()
  })
})

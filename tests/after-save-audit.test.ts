import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// A SAVE SHOWS ITS RESULT BY ITSELF (TMS §0 rule 15, v11.59; owner's rule
// 2026-11-26) — THE AUDIT, ONE CASE PER FORM.
//
// The forms the 2026-11-26 audit found already right, each pinned to the
// mechanism that shows its result: a redirect to the record or to the list
// that names it, or a refresh after a browser-side upload. The five that
// needed a fix are driven in a browser in `after-save.test.tsx` (the Safety
// intake) and `after-save-forms.test.tsx` (Add load, Add authority, the
// parked medical card, the turned-and-read card).
//
// Read from the source because each action runs behind `withCurrentOrg` and
// ends in `redirect()`, which throws a framework signal outside a request —
// the line itself is the thing that acts.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, 'utf8')

/** The body of one exported server action, up to the next export. */
function action(path: string, name: string) {
  const source = read(path)
  const start = source.indexOf(`export async function ${name}(`)
  expect(start, `${name} is in ${path}`).toBeGreaterThanOrEqual(0)
  const next = source.indexOf('\nexport ', start + 1)
  return source.slice(start, next < 0 ? undefined : next)
}

describe('create forms open what they made, or the list naming it', () => {
  it('Add truck opens the truck (with a card: after the file is on it)', () => {
    const body = action('src/app/(app)/trucks/actions.ts', 'createTruckAction')
    expect(body).toContain('redirect(`/trucks/${outcome.id}`)')
    const form = read('src/components/forms/NewAssetForm.tsx')
    expect(form).toContain(
      '.then(() => router.push(`/${kind}s/${created.id}`))',
    )
  })

  it('Add trailer opens the trailer', () => {
    const body = action(
      'src/app/(app)/trailers/actions.ts',
      'createTrailerAction',
    )
    expect(body).toContain('redirect(`/trailers/${outcome.id}`)')
  })

  it('Add driver opens the drivers list, revalidated', () => {
    const body = action(
      'src/app/(app)/drivers/actions.ts',
      'createDriverAction',
    )
    expect(body).toContain("revalidatePath('/drivers')")
    expect(body).toContain("redirect('/drivers')")
  })

  it('Add broker opens the brokers list, revalidated', () => {
    const body = action(
      'src/app/(app)/brokers/actions.ts',
      'createBrokerAction',
    )
    expect(body).toContain("revalidatePath('/brokers')")
    expect(body).toContain("redirect('/brokers')")
  })

  it('Add user shows the new user and revalidates the list', () => {
    const body = action('src/app/(app)/users/actions.ts', 'createUserAction')
    expect(body).toContain("revalidatePath('/users')")
    const form = read('src/app/(app)/users/NewUserForm.tsx')
    expect(form).toContain('if (state.created) {')
  })

  it('Add payment opens the payment', () => {
    const body = action(
      'src/app/(app)/payments/actions.ts',
      'recordPaymentAction',
    )
    expect(body).toContain('redirect(`/payments/${outcome.paymentId}`)')
  })

  it('Add authority revalidates; the form opens the list (driven in the browser test)', () => {
    const body = action(
      'src/app/(app)/companies/actions.ts',
      'addCompanyAction',
    )
    expect(body).toContain("revalidatePath('/companies')")
  })
})

describe('every document upload control refreshes the page after the upload', () => {
  // Each: the upload, then `router.refresh()` after it in the same file.
  const UPLOADERS = [
    'src/app/(app)/_reference/DocumentControls.tsx',
    'src/app/(app)/_reference/ClaimPanels.tsx',
    'src/app/(app)/_reference/MaintenancePanel.tsx',
    'src/app/(app)/_reference/ViolationPanel.tsx',
    'src/app/(app)/_reference/DriverDocuments.tsx',
    'src/app/(app)/drivers/[id]/CdlReader.tsx',
    'src/app/(app)/drivers/[id]/DriverPhoto.tsx',
    'src/app/(app)/loads/[id]/LoadDocuments.tsx',
    'src/app/(app)/loads/[id]/PhotoFolders.tsx',
    'src/app/(portal)/portal/documents/CaptureUpload.tsx',
    'src/app/(app)/safety/MedicalCertUpload.tsx',
  ]

  for (const path of UPLOADERS) {
    it(path.replace('src/app/', ''), () => {
      const source = read(path)
      const upload = source.indexOf('uploadDocument(')
      expect(upload, 'uploads').toBeGreaterThanOrEqual(0)
      expect(source.indexOf('router.refresh()', upload)).toBeGreaterThan(upload)
    })
  }

  it('the list is every file that uploads, so a new one has to be added here', () => {
    // The intake's confirm steps, Add load and Add truck/trailer upload too;
    // they move the screen on by other means, each tested where named above.
    const elsewhere = [
      'src/app/(app)/safety/InspectionConfirm.tsx',
      'src/app/(app)/safety/RegistrationConfirm.tsx',
      'src/app/(app)/loads/new/CreateLoadForm.tsx',
      'src/components/forms/NewAssetForm.tsx',
    ]
    const found = execFileSync(
      'git',
      ['grep', '-l', '--untracked', 'uploadDocument(', '--', 'src/*.tsx'],
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .sort()
    expect(found).toEqual([...UPLOADERS, ...elsewhere].sort())
  })
})

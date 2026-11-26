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

// ---------------------------------------------------------------------------
// A SAVE SHOWS ITS RESULT BY ITSELF (TMS §0 rule 15, v11.59) — the three
// forms beside the Safety intake that the 2026-11-26 audit found needed a
// fix. Each: submit, then the screen moves on with no reload.
//
//   Add load            Save opens the new load (it used to leave the form).
//   Add authority       Save opens the list naming it (same).
//   Medical card, parked unread on a driver   the list refreshes.
//   A parked card turned and read on the driver's list   the list refreshes.
// ---------------------------------------------------------------------------

const refresh = vi.fn()
const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push, replace }),
}))

const uploadDocument = vi.fn()
vi.mock('@/lib/upload-client', () => ({
  uploadDocument: (...a: unknown[]) => uploadDocument(...a),
}))

const createLoadAction = vi.fn()
vi.mock('@/app/(app)/loads/new/actions', () => ({
  createLoadAction: (...a: unknown[]) => createLoadAction(...a),
}))
vi.mock('@/app/(app)/companies/actions', () => ({
  lookupCarrierAction: vi.fn(),
}))
vi.mock('@/app/(app)/safety/med-actions', () => ({
  fileMedicalCertAction: vi.fn(),
}))
// The rotate step asked for, then cancelled: that is what parks the card.
vi.mock('@/components/UprightCard', () => ({
  needsUprightStep: async () => true,
  UprightCard: (props: {
    onCancel: () => void
    onConfirm: (n: number) => void
  }) => (
    <div>
      <button type="button" onClick={props.onCancel}>
        cancel-upright
      </button>
      <button type="button" onClick={() => props.onConfirm(1)}>
        confirm-upright
      </button>
    </div>
  ),
}))
vi.mock('@/lib/rotate-and-read', () => ({
  READABLE_TYPES: new Set(['MEDICAL_CARD']),
  fetchDocumentFile: async () => ({
    ok: true,
    file: new File(['x'], 'card.jpg', { type: 'image/jpeg' }),
  }),
  storeRotatedAndRead: async () => ({ ok: true }),
}))

const { CreateLoadForm } = await import('@/app/(app)/loads/new/CreateLoadForm')
const { AddCompanyForm } = await import('@/app/(app)/companies/AddCompanyForm')
const { MedicalCertUpload } = await import(
  '@/app/(app)/safety/MedicalCertUpload'
)
const { DriverDocuments } = await import(
  '@/app/(app)/_reference/DriverDocuments'
)

/** Every label is its own key: the test reads keys, not translations. */
const keys = <T,>() =>
  new Proxy(
    {},
    { get: (_, key) => (typeof key === 'string' ? key : undefined) },
  ) as T

beforeEach(() => {
  refresh.mockClear()
  push.mockClear()
  replace.mockClear()
  uploadDocument.mockReset()
  createLoadAction.mockReset()
})
afterEach(() => cleanup())

function loadForm() {
  const view = render(
    <CreateLoadForm
      authorities={[{ value: 'c1', label: 'RAM' }]}
      defaultAuthority="c1"
      brokers={[]}
      recentCustomers={[]}
      trucks={[]}
      drivers={[]}
      places={[]}
      mayEnterRate={false}
      economics={null}
      labels={keys()}
    />,
  )
  return view.container.querySelector('form')!
}

describe('Add load opens the saved load', () => {
  it('with no rate con, at once', async () => {
    createLoadAction.mockResolvedValue({
      error: null,
      field: null,
      loadId: 'L1',
    })
    const form = loadForm()
    await act(async () => {
      fireEvent.submit(form)
    })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/loads/L1'))
  })

  it('with a rate con, once the file is on it', async () => {
    createLoadAction.mockResolvedValue({
      error: null,
      field: null,
      loadId: 'L2',
    })
    let finish: () => void = () => {}
    uploadDocument.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const form = loadForm()
    const input = form.querySelector<HTMLInputElement>('#rateCon')!
    fireEvent.change(input, {
      target: {
        files: [new File(['x'], 'rc.pdf', { type: 'application/pdf' })],
      },
    })
    await act(async () => {
      fireEvent.submit(form)
    })
    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(1))
    expect(push).not.toHaveBeenCalled()
    await act(async () => finish())
    await waitFor(() => expect(push).toHaveBeenCalledWith('/loads/L2'))
  })

  it('a failed attach stays, says so and links to the load', async () => {
    createLoadAction.mockResolvedValue({
      error: null,
      field: null,
      loadId: 'L3',
    })
    uploadDocument.mockRejectedValue(new Error('network'))
    const form = loadForm()
    fireEvent.change(form.querySelector<HTMLInputElement>('#rateCon')!, {
      target: {
        files: [new File(['x'], 'rc.pdf', { type: 'application/pdf' })],
      },
    })
    await act(async () => {
      fireEvent.submit(form)
    })
    const link = await screen.findByRole('link', { name: 'savedOpen' })
    expect(link.getAttribute('href')).toBe('/loads/L3')
    expect(push).not.toHaveBeenCalled()
  })
})

describe('Add authority opens the list naming it', () => {
  const addAuthority = (returnTo: string | null) => {
    const action = vi.fn(async () => ({
      error: null,
      field: null,
      companyId: 'co9',
    }))
    const view = render(
      <AddCompanyForm
        action={action as never}
        returnTo={returnTo}
        labels={keys()}
        fmcsa={keys()}
      />,
    )
    return view.container.querySelector('form')!
  }
  it('a plain Add opens /companies?saved=<id>', async () => {
    const form = addAuthority(null)
    await act(async () => {
      fireEvent.submit(form)
    })
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/companies?saved=co9'),
    )
  })
})

describe('the driver page shows a parked or re-read card without a reload', () => {
  it('a medical card parked unread refreshes the page', async () => {
    uploadDocument.mockResolvedValue({ documentId: 'd1' })
    const view = render(
      <MedicalCertUpload
        driverId="dr1"
        driverLabel="Ali Test"
        labels={keys()}
      />,
    )
    const input =
      view.container.querySelector<HTMLInputElement>('input[type="file"]')!
    await act(async () => {
      fireEvent.change(input, {
        target: {
          files: [new File(['x'], 'card.jpg', { type: 'image/jpeg' })],
        },
      })
    })
    await act(async () => {
      fireEvent.click(await screen.findByText('cancel-upright'))
    })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(uploadDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ unread: 'NEEDS_ROTATION', entityId: 'dr1' }),
    )
  })

  it('a parked card turned and read refreshes the list', async () => {
    render(
      <DriverDocuments
        documents={[
          {
            id: 'doc1',
            filename: 'card.jpg',
            type: 'MEDICAL_CARD',
            needsRotation: true,
            expiresAt: null,
            superseded: false,
            uploadedAt: null,
          },
        ]}
        driverId="dr1"
        mayRead
        mayUpload={false}
        kinds={[]}
        kindLabels={{}}
        labels={keys()}
      />,
    )
    await act(async () => {
      fireEvent.click(
        await screen.findByRole('button', { name: 'rotateAndRead' }),
      )
    })
    await act(async () => {
      fireEvent.click(await screen.findByText('confirm-upright'))
    })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })
})

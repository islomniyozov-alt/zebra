/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'

// ---------------------------------------------------------------------------
// THE LOAD HEADER'S ACTIONS (TMS §7.14 part 7, v11.60).
//
//   Create invoice · Edit load · ⋮ → Duplicate load, Undo, Cancel load (red,
//   last). Undo names what it would take back, or why it cannot and is
//   disabled. Edit load is Add load's own form, prefilled, posting to its own
//   action, and Save opens the load.
// ---------------------------------------------------------------------------

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/lib/upload-client', () => ({ uploadDocument: vi.fn() }))
vi.mock('@/app/(app)/loads/new/actions', () => ({
  createLoadAction: vi.fn(),
}))

const { LoadActions } = await import('@/app/(app)/loads/[id]/LoadActions')
const { CreateLoadForm } = await import('@/app/(app)/loads/new/CreateLoadForm')

afterEach(() => {
  cleanup()
  push.mockClear()
})

const labels = {
  markDelivered: 'Mark delivered',
  cancel: 'Cancel',
  cancelTitle: 'Cancel this load?',
  cancelBody: 'Nothing is deleted.',
  reason: 'Reason',
  confirmCancel: 'Cancel load',
  uncancel: 'Reinstate load',
  close: 'Cancel',
  menu: 'Load actions',
  duplicate: 'Duplicate load',
  undo: 'Undo',
}
type Detail = { error: string | null; notice: string | null }
const noop = async (): Promise<Detail> => ({ error: null, notice: null })

function menu(
  undo: { enabled: boolean; detail: string },
  isCancelled = false,
  action = noop,
) {
  render(
    <LoadActions
      layout="menu"
      isCancelled={isCancelled}
      canDeliver
      markDelivered={noop}
      cancel={noop}
      uncancel={async () => {}}
      duplicate={noop}
      undo={{ action, ...undo }}
      labels={labels}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Load actions' }))
  return screen.getAllByRole('menuitem')
}

describe('the ⋮ menu', () => {
  it('reads Duplicate load, Undo, Cancel load — red, and last', () => {
    const items = menu({ enabled: true, detail: 'field edit' })
    expect(items.map((item) => item.firstChild?.textContent)).toEqual([
      'Duplicate load',
      'Undo',
      'Cancel load',
    ])
    expect(items[2]!.className).toContain('text-danger')
    expect(items[0]!.className).not.toContain('text-danger')
    expect(items[1]!.className).not.toContain('text-danger')
  })

  it('Undo names what it would take back, and posts', async () => {
    const action = vi.fn(noop)
    const items = menu({ enabled: true, detail: 'status move' }, false, action)
    const undo = items[1] as HTMLButtonElement
    expect(undo.disabled).toBe(false)
    expect(undo.textContent).toContain('status move')
    await act(async () => {
      fireEvent.click(undo)
    })
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
  })

  it('Undo refused says why, in the item, and is disabled', () => {
    const items = menu({
      enabled: false,
      detail: 'The last change was made by someone else',
    })
    const undo = items[1] as HTMLButtonElement
    expect(undo.disabled).toBe(true)
    expect(undo.textContent).toContain('someone else')
  })

  it('a refused Undo shows its sentence beside the menu', async () => {
    const action = vi.fn(async () => ({
      error: 'Changed again since — nothing undone',
      notice: null,
    }))
    const items = menu({ enabled: true, detail: 'field edit' }, false, action)
    await act(async () => {
      fireEvent.click(items[1]!)
    })
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Changed again since — nothing undone',
    )
  })

  it('a cancelled load keeps Duplicate and Undo, and has no Cancel', () => {
    const items = menu({ enabled: true, detail: 'status move' }, true)
    expect(items.map((item) => item.firstChild?.textContent)).toEqual([
      'Duplicate load',
      'Undo',
    ])
    expect(screen.getByRole('button', { name: 'Reinstate load' })).toBeTruthy()
  })
})

describe('the header', () => {
  const page = readFileSync('src/app/(app)/loads/[id]/page.tsx', 'utf8')

  it('puts Edit load after Create invoice and before the ⋮', () => {
    const invoice = page.indexOf("t('invoices.create')")
    const edit = page.indexOf("t('loads.editLoad')")
    const menuAt = page.indexOf("{actionsFor('menu')}")
    expect(invoice).toBeGreaterThan(0)
    expect(edit).toBeGreaterThan(invoice)
    expect(menuAt).toBeGreaterThan(edit)
    expect(page).toContain('href={`/loads/${id}/edit`}')
  })

  it('offers Duplicate only to a role that may create a load', () => {
    expect(page).toMatch(
      /mayCreate\s*\?\s*\{\s*duplicate: duplicateLoadAction\.bind\(null, id\)/,
    )
  })
})

const keys = <T,>() =>
  new Proxy(
    {},
    { get: (_, key) => (typeof key === 'string' ? key : undefined) },
  ) as T

describe('Edit load is Add load’s form, prefilled', () => {
  function editForm(action = vi.fn()) {
    const view = render(
      <CreateLoadForm
        editing={{
          loadId: 'L7',
          action,
          broker: 'RAM Broker',
          truckId: 't2',
          driverId: '',
          stops: [
            {
              id: 'st1',
              place: 'Springfield, OH',
              type: 'PICKUP',
              date: '2026-11-22',
              from: '17:00',
              to: '',
            },
            {
              id: 'st2',
              place: 'Menomonie, WI',
              type: 'DELIVERY',
              date: '2026-11-21',
              from: '02:31',
              to: '23:58',
            },
          ],
          bol: 'B-1',
          po: '',
          reference: '2005041810',
          miles: '640',
          rate: '1978.44',
        }}
        authorities={[{ value: 'c1', label: 'RAM' }]}
        defaultAuthority="c1"
        brokers={[]}
        recentCustomers={[]}
        trucks={[
          { value: 't1', label: '101' },
          { value: 't2', label: '102' },
        ]}
        drivers={[]}
        places={[]}
        mayEnterRate
        economics={null}
        labels={keys()}
      />,
    )
    return view.container.querySelector('form')!
  }

  it('shows the load’s values, stop ids hidden, no rate-con offer and no file', () => {
    const form = editForm()
    const value = (name: string) =>
      (form.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value
    expect(value('broker')).toBe('RAM Broker')
    expect(value('truckId')).toBe('t2')
    expect(value('stops[0].id')).toBe('st1')
    expect(value('stops[1].id')).toBe('st2')
    expect(value('stops[1].place')).toBe('Menomonie, WI')
    expect(value('stops[1].to')).toBe('23:58')
    expect(value('reference')).toBe('2005041810')
    expect(value('rate')).toBe('1978.44')
    expect(value('miles')).toBe('640')
    expect(form.querySelector('input[type="file"]')).toBeNull()
    expect(
      form.querySelector('[name="companyId"]')?.hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByRole('link', { name: 'cancel' }).getAttribute('href'),
    ).toBe('/loads/L7')
  })

  it('Save posts to the edit action and opens the load', async () => {
    const action = vi.fn(async () => ({
      error: null,
      field: null,
      loadId: 'L7',
    }))
    const form = editForm(action)
    await act(async () => {
      fireEvent.submit(form)
    })
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/loads/L7'))
  })
})

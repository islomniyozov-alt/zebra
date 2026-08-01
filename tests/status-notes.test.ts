import { describe, expect, it } from 'vitest'
import { isMessageKey, translator, type MessageKey } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// A status-event note is one of two things and they are rendered differently.
//
//   OURS      — "status.note.assigned", written by the status engine. Chrome.
//               It belongs in the reader's language, and until Step 7 it was
//               stored as English prose and stayed English in the Russian and
//               Farsi timelines (§16 flag 14).
//   A HUMAN'S — "Broker cancelled, no truck available." Evidence. It is shown
//               exactly as typed, in whatever language it was typed in, and
//               translating it would be putting words in someone's mouth on a
//               screen that gets read out in disputes.
//
// The membership test is the whole distinction, so it is the thing to test.
// ---------------------------------------------------------------------------

const SYSTEM_NOTES: MessageKey[] = [
  'status.note.podConfirmed',
  'status.note.assigned',
  'status.note.unassigned',
]

describe('the notes the engine writes', () => {
  it.each(SYSTEM_NOTES)('%s is a real key in every locale', (key) => {
    expect(isMessageKey(key)).toBe(true)
    for (const locale of ['en', 'ru', 'fa'] as const) {
      const rendered = translator(locale)(key)
      expect(rendered.length).toBeGreaterThan(0)
    }
  })

  it('reads differently in each locale, which is the point', () => {
    const en = translator('en')('status.note.assigned')
    const ru = translator('ru')('status.note.assigned')
    expect(ru).not.toBe(en)
  })
})

describe('the notes a person writes', () => {
  it.each([
    'Broker cancelled, no truck available.',
    'Отменено брокером.',
    'status.note',
    'status.note.somethingRemoved',
    '',
  ])('%s is not translated', (typed) => {
    expect(isMessageKey(typed)).toBe(false)
  })

  it('does not translate a note stored before Step 7', () => {
    // Rows written by earlier steps hold English prose. They fail the test and
    // are therefore shown as stored — which is the correct answer for a note
    // nobody can retranslate after the fact.
    expect(isMessageKey('POD document confirmed')).toBe(false)
    expect(isMessageKey('Truck and driver assigned')).toBe(false)
  })
})

describe('the test is not accidentally true', () => {
  it('would notice a key that had been renamed away', () => {
    // Standing rule 12: a negative check proves nothing unless the positive
    // one passes beside it. `status.note.assigned` is a key and
    // `status.note.assignedd` is not, and both assertions run here.
    expect(isMessageKey('status.note.assigned')).toBe(true)
    expect(isMessageKey('status.note.assignedd')).toBe(false)
  })

  it('is not fooled by a property from the prototype chain', () => {
    // `Object.hasOwn`, not `in`. `'toString' in en` is true and would have
    // made every note whose text is "toString" render as a function.
    expect(isMessageKey('toString')).toBe(false)
    expect(isMessageKey('constructor')).toBe(false)
  })
})

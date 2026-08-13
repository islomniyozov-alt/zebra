'use client'

import { useState } from 'react'
import { RecordForm, type FieldSpec } from '@/components/forms/RecordForm'
import { FmcsaLookup } from '@/components/forms/FmcsaLookup'
import type { FmcsaAnswer, FmcsaLabels } from '@/components/forms/fmcsa-labels'
import { createBrokerAction, lookupBrokerAction } from '../actions'
import type { BrokerPrefill } from '../actions'

// The new-broker form, with the register attached.
//
// A CLIENT WRAPPER RATHER THAN A BIGGER `RecordForm`. The lookup needs state —
// what the register said, which fields it filled — and three other reference
// forms share `RecordForm` and need none of it. The shared component gained
// two optional props (`prefill`, `header`) and nothing else; everything that
// only this screen does lives here.
//
// THE NUMBERS ARE READ OUT OF THE LIVE FORM, not held in state. The MC and DOT
// boxes are `RecordForm`'s own uncontrolled inputs, so the lookup asks the DOM
// what is in them at the moment the button is pressed. That keeps this
// component from being a second, partial copy of the form's values — the bug
// where a lookup uses a number the person has since corrected.

export function NewBrokerForm({
  fields,
  labels,
  fmcsa,
}: {
  fields: readonly FieldSpec[]
  labels: { save: string; cancel: string }
  fmcsa: FmcsaLabels
}) {
  const [answer, setAnswer] = useState<FmcsaAnswer<BrokerPrefill>>({
    error: null,
    found: null,
  })

  const run = async () => {
    // `FormData` rather than reaching for elements by name: it reads whatever
    // the form would actually submit, which is the same answer the save button
    // gets, and it does not care whether a control is an input or a select.
    const form = document.querySelector('form')
    const data = form ? new FormData(form) : new FormData()
    const value = (name: string) => String(data.get(name) ?? '')

    setAnswer(
      await lookupBrokerAction({
        dot: value('dotNumber'),
        mc: value('mcNumber'),
        type: value('type') || 'BROKER',
      }),
    )
  }

  return (
    <RecordForm
      fields={fields}
      values={{ type: 'BROKER', status: 'ACTIVE', paymentTermsDays: '30' }}
      action={createBrokerAction}
      cancelHref="/brokers"
      labels={labels}
      prefill={answer.found?.prefill}
      prefillMark={fmcsa.from}
      header={
        <FmcsaLookup
          labels={fmcsa}
          found={answer.found}
          error={answer.error}
          onRun={run}
        />
      }
    />
  )
}

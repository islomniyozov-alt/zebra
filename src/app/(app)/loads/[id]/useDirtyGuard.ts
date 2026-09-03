'use client'

import { useEffect } from 'react'

// ---------------------------------------------------------------------------
// A TYPED VALUE IS NEVER DISCARDED SILENTLY.
//
// The inline editors on this screen commit on blur and on Enter, which covers
// every way a person finishes with a field — clicking elsewhere, tabbing on,
// pressing Enter. It does not cover the page going away underneath them: a tab
// closed mid-typing, a back button, a refresh. Blur does not reliably fire on
// unload, so the value is gone and nothing said so.
//
// THAT IS THE EXACT DEFECT THE INLINE PATTERN WAS MEANT TO REMOVE. Replacing a
// Save button with a field that quietly loses work is worse than the button,
// because the button at least looked like something you had to press.
//
// SO THE BROWSER'S OWN PROMPT COVERS THE GAP, and only that gap. It is armed
// only while a field genuinely holds an uncommitted edit, so a dispatcher who
// has changed nothing never sees it. The wording belongs to the browser —
// `returnValue` is ignored by every current engine — which is fine: the
// prompt's job is to stop the navigation long enough to notice, not to explain.
// ---------------------------------------------------------------------------

export function useDirtyGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Set for engines that still read it. Modern ones show their own text.
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
}

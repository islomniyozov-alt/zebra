// The shape the saved-views form's `useActionState` starts in. Kept out of
// ./view-actions.ts for the reason recorded in ../dispatch/assign-state.ts: a
// "use server" file may export async functions and nothing else.

export interface ViewState {
  error: string | null
}

export const VIEW_INITIAL: ViewState = { error: null }

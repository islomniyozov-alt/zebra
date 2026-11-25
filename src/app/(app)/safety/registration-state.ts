import type { MessageKey } from '@/lib/i18n'

/** The intake's cab-card confirm step, between the form and its action. */
export interface RegistrationFileState {
  error: MessageKey | null
  createdId: string | null
  /** What was typed, handed back on a refusal (§0 rule 14). */
  typed: {
    /** The select's `truck:<id>` or `trailer:<id>`. */
    unit: string
    registrationExpiresAt: string
    registrationIssuedAt: string
  } | null
}

export const REGISTRATION_FILE_INITIAL: RegistrationFileState = {
  error: null,
  createdId: null,
  typed: null,
}

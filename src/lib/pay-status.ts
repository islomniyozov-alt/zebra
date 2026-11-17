import type {
  SettlementBatchStatus,
  SettlementStatus,
} from '@/generated/prisma/client'
import type { MessageKey } from './i18n'
import type { StatusTone } from './status'

// ---------------------------------------------------------------------------
// THE OFFICE'S WORDS FOR PAY STATUSES, FROM ONE PLACE (§6.2.10 part 7, v11.24;
// owner's brief and rulings 2026-11-17, DRIVER-PAY-BRIEF.md §5).
//
//   statement   DRAFT → Unposted · APPROVED → Posted · PAID → Paid · VOID → Void
//   batch       DRAFT → Unposted · PARTIAL → Partial posted
//               FINAL → Posted   · PAID → Paid
//
// Datatruck's words, which are Uktam's. NOTHING IN THE SCHEMA IS RENAMED: the
// enums stay what the engine and `deriveBatchStatus` speak, and this is the
// one place the screens turn them into words. Three pages each kept their own
// `Record` until now, and one of them keyed statements by the batch's labels.
//
// ── TYPED BY THE ENUM, SO A NEW STATUS CANNOT RENDER BLANK ───────────────
//
// `Record<SettlementStatus, …>` fails to compile when the schema grows a value
// this map has not been told about, and `tests/pay-status.test.ts` walks every
// value of both enums from the generated client. The empty badge the old
// template-key cast (`as MessageKey`) produced is the bug this replaces.
//
// A string that is not a known status — a stored value from a future schema
// read through raw SQL — gets `null`, and the caller prints the raw value
// rather than a confident wrong word.
// ---------------------------------------------------------------------------

export interface PayWord {
  label: MessageKey
  tone: StatusTone
}

export const STATEMENT_WORDS: Record<SettlementStatus, PayWord> = {
  DRAFT: { label: 'payStatus.unposted', tone: 'neutral' },
  APPROVED: { label: 'payStatus.posted', tone: 'progress' },
  PAID: { label: 'payStatus.paid', tone: 'success' },
  VOID: { label: 'payStatus.void', tone: 'muted' },
}

export const BATCH_WORDS: Record<SettlementBatchStatus, PayWord> = {
  DRAFT: { label: 'payStatus.unposted', tone: 'neutral' },
  // §6.2.10 part 3: a batch half posted is a batch somebody is in the middle
  // of, so it wears the attention tone (§3.3).
  PARTIAL: { label: 'payStatus.partial', tone: 'warning' },
  FINAL: { label: 'payStatus.posted', tone: 'progress' },
  PAID: { label: 'payStatus.paid', tone: 'success' },
}

const has = <T extends object>(
  map: T,
  key: string,
): key is Extract<keyof T, string> =>
  Object.prototype.hasOwnProperty.call(map, key)

/** A statement's word and tone, or null for a value this map does not know. */
export function statementWord(status: string): PayWord | null {
  return has(STATEMENT_WORDS, status) ? STATEMENT_WORDS[status] : null
}

/** A batch's word and tone, or null for a value this map does not know. */
export function batchWord(status: string): PayWord | null {
  return has(BATCH_WORDS, status) ? BATCH_WORDS[status] : null
}

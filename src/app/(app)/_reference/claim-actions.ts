'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import {
  addClaimNote,
  addClaimParty,
  moveClaim,
  openClaim,
  removeClaimParty,
} from '@/lib/claims'
import { MoneyFormatError, parseMoneyToCents } from '@/lib/money'
import { normalizeTypedDate, utcMidnight } from '@/lib/typed-date'
import { CLAIM_INITIAL, type ClaimState } from './claim-state'
import type {
  ClaimPartyRole,
  ClaimStatus,
  ClaimType,
} from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

// §2.5: OWNER/ADMIN/MANAGER write, ACCOUNTING reads. Every action here asks
// for `claim:create` or `claim:update`; permissions.ts decides who holds them.

const OPEN_ERRORS: Record<string, MessageKey> = {
  no_authority: 'claims.error.noAuthority',
  load_not_found: 'claims.error.loadNotFound',
  bad_amount: 'claims.error.badAmount',
  no_description: 'claims.error.noDescription',
}

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

/** A typed amount as integer cents, or `undefined` if it was left blank. */
function optionalCents(value: string): number | null | undefined {
  if (value === '') return null
  try {
    return parseMoneyToCents(value)
  } catch (error) {
    if (error instanceof MoneyFormatError) return undefined
    throw error
  }
}

export async function openClaimAction(
  _previous: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const incidentTyped = text(formData, 'incidentAt')
  const incident =
    incidentTyped === '' ? null : normalizeTypedDate(incidentTyped)
  if (incidentTyped !== '' && !incident) {
    return { error: 'claims.error.badAmount' }
  }

  const amount = optionalCents(text(formData, 'amountClaimed'))
  if (amount === undefined) return { error: 'claims.error.badAmount' }

  const outcome = await withCurrentOrg('create', 'claim', (tx, session) =>
    openClaim(tx, {
      companyId: text(formData, 'companyId'),
      type: text(formData, 'type') as ClaimType,
      loadId: text(formData, 'loadId') || null,
      claimNumber: text(formData, 'claimNumber'),
      claimantName: text(formData, 'claimantName'),
      incidentAt: incident ? utcMidnight(incident) : null,
      amountClaimedCents: amount,
      description: text(formData, 'description'),
      userId: session.userId,
    }),
  )

  if (!outcome.ok) {
    return { error: OPEN_ERRORS[outcome.reason] ?? 'claims.error.noAuthority' }
  }

  revalidatePath('/safety/claims')
  // Straight to the claim: the parties and the paperwork go on next, and
  // landing back on the list means finding the row you just made.
  redirect(`/safety/claims/${outcome.claimId}`)
}

export async function moveClaimAction(
  claimId: string,
  _previous: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const paid = optionalCents(text(formData, 'amountPaid'))
  if (paid === undefined) return { error: 'claims.error.badAmount' }

  const outcome = await withCurrentOrg('update', 'claim', (tx, session) =>
    moveClaim(tx, {
      claimId,
      to: text(formData, 'to') as ClaimStatus,
      note: text(formData, 'note'),
      resolution: text(formData, 'resolution'),
      amountPaidCents: paid,
      userId: session.userId,
    }),
  )

  if (outcome.result === 'not_found') return { error: 'claims.error.notFound' }
  if (outcome.result === 'refused') return { error: 'claims.error.refused' }

  revalidatePath(`/safety/claims/${claimId}`)
  revalidatePath('/safety/claims')
  return CLAIM_INITIAL
}

export async function addClaimNoteAction(
  claimId: string,
  _previous: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const ok = await withCurrentOrg('update', 'claim', (tx, session) =>
    addClaimNote(tx, claimId, text(formData, 'body'), session.userId),
  )
  if (!ok) return { error: 'claims.error.notFound' }

  revalidatePath(`/safety/claims/${claimId}`)
  return CLAIM_INITIAL
}

export async function addClaimPartyAction(
  claimId: string,
  _previous: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const outcome = await withCurrentOrg('update', 'claim', (tx) =>
    addClaimParty(tx, {
      claimId,
      role: text(formData, 'role') as ClaimPartyRole,
      name: text(formData, 'name'),
      phone: text(formData, 'phone'),
      email: text(formData, 'email'),
      reference: text(formData, 'reference'),
      notes: text(formData, 'notes'),
    }),
  )
  if (!outcome.ok) return { error: 'claims.parties.error' }

  revalidatePath(`/safety/claims/${claimId}`)
  return CLAIM_INITIAL
}

export async function removeClaimPartyAction(
  claimId: string,
  partyId: string,
): Promise<void> {
  await withCurrentOrg('update', 'claim', (tx) => removeClaimParty(tx, partyId))
  revalidatePath(`/safety/claims/${claimId}`)
}

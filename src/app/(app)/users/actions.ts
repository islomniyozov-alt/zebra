'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { createUser, setUserActive } from '@/lib/users'
import { CREATE_USER_INITIAL, type CreateUserState } from './user-state'
import type { MessageKey } from '@/lib/i18n'
import type { Role } from '@/generated/prisma/client'

// The users screen's two writes. Both go through `withCurrentOrg`, so both are
// permission-checked and attributed; the tenancy reasoning that makes them
// safe lives in src/lib/users.ts, next to the queries it constrains.

const CREATE_ERRORS: Record<string, MessageKey> = {
  name_required: 'users.error.nameRequired',
  email_required: 'users.error.emailRequired',
  already_a_member: 'users.error.alreadyMember',
  email_unavailable: 'users.error.emailUnavailable',
  role_not_grantable: 'users.error.roleNotGrantable',
  company_not_in_org: 'users.error.companyNotInOrg',
}

export async function createUserAction(
  _previous: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const name = String(formData.get('name') ?? '')
  const email = String(formData.get('email') ?? '')
  const role = String(formData.get('role') ?? '') as Role
  const companyIds = formData
    .getAll('companyIds')
    .map((value) => String(value))
    .filter((value) => value !== '')

  const outcome = await withCurrentOrg('create', 'user', (tx, session) =>
    createUser(tx, session.organizationId, session.role, {
      name,
      email,
      role,
      companyIds,
    }),
  )

  if (!outcome.ok) {
    return {
      error: CREATE_ERRORS[outcome.reason] ?? 'ref.error.required',
      created: null,
    }
  }

  revalidatePath('/users')
  return {
    ...CREATE_USER_INITIAL,
    // The one and only time this value exists outside the creating request.
    created: {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      temporaryPassword: outcome.temporaryPassword,
    },
  }
}

export async function setUserActiveAction(
  userId: string,
  isActive: boolean,
): Promise<void> {
  await withCurrentOrg('update', 'user', (tx, session) =>
    setUserActive(tx, session.organizationId, session.userId, userId, isActive),
  )
  revalidatePath('/users')
}

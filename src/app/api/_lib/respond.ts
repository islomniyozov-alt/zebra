import { NextResponse } from 'next/server'
import { ForbiddenError, UnauthenticatedError } from '@/lib/auth-context'

// Shared HTTP shapes. Under `_lib`, so Next does not route it.
//
// One rule throughout: an error body says what the caller may know and not one
// thing more. "No such document" and "that document belongs to someone else"
// are the same 404, because the difference is exactly the fact worth hiding.

export interface ApiFailure {
  error: string
  message: string
}

export function apiError(
  status: number,
  error: string,
  message: string,
): NextResponse<ApiFailure> {
  return NextResponse.json({ error, message }, { status })
}

export type JsonResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse<ApiFailure> }

export async function readJson<T>(request: Request): Promise<JsonResult<T>> {
  try {
    const value = (await request.json()) as T
    if (typeof value !== 'object' || value === null) {
      return {
        ok: false,
        response: apiError(400, 'invalid_body', 'Expected a JSON object.'),
      }
    }
    return { ok: true, value }
  } catch {
    return {
      ok: false,
      response: apiError(400, 'invalid_body', 'Expected a JSON object.'),
    }
  }
}

/**
 * Turn the auth-context errors into responses.
 *
 * 401 means "no session"; 403 means "a session that may not do this". Keeping
 * them distinct matters — the login screen needs to know which one it is
 * looking at, and a 403 that pretends to be a 401 sends users round a
 * redirect loop.
 */
export function authFailureResponse(
  error: unknown,
): NextResponse<ApiFailure> | null {
  if (error instanceof UnauthenticatedError) {
    return apiError(401, 'unauthenticated', 'Sign in first.')
  }
  if (error instanceof ForbiddenError) {
    return apiError(403, 'forbidden', 'Your role does not permit this.')
  }
  return null
}

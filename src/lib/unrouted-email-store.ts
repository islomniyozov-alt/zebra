import 'server-only'
import { createPrismaClient } from './db'
import { putObject, r2ConfigFromEnv } from './r2'
import type { UnroutedStore } from './unrouted-email'

// ---------------------------------------------------------------------------
// THE SECOND DATABASE HANDLE THAT IS NOT TENANT-SCOPED, AFTER `auth-db.ts`.
//
// A row in `UnroutedEmail` is there BECAUSE the question "which organization
// claims this address?" was asked and answered no. There is no tenant to scope
// to, so `withOrg` has nothing it could be given. The exception lives in this
// one file with this one comment, exactly as `auth-db.ts` prescribes, and the
// lint rule banning `createPrismaClient` under `src/app` stays absolute.
//
// SEPARATE FROM `unrouted-email.ts` ON PURPOSE. The decision — what to write,
// what to retry, what may be answered 202 — is testable logic and lives there.
// This file is the part that opens sockets, and it is `server-only` so nothing
// in a client bundle can reach it.
// ---------------------------------------------------------------------------

/** The real store. Not tenant-scoped, for the reason at the top of this file. */
export function liveUnroutedStore(): UnroutedStore {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set.')
  // Still zebra_app — `createPrismaClient` refuses anything else. Being outside
  // row-level security is a property of this table, not a licence to connect
  // as the owner.
  const db = createPrismaClient(connectionString)

  const select = { id: true, messageId: true, rawR2Key: true } as const

  return {
    find: (messageId) =>
      db.unroutedEmail.findUnique({ where: { messageId }, select }),

    create: (input) =>
      db.unroutedEmail.create({
        data: {
          messageId: input.messageId,
          fromAddress: input.from,
          toAddress: input.to,
          subject: input.subject?.slice(0, 500) ?? null,
          // Kept even though the `.eml` usually holds it. R2 can fail, and a
          // row with no readable trace of the message would satisfy the letter
          // of "it exists" while losing what it said.
          bodyText: input.text?.slice(0, 100_000) ?? null,
          rawBytes: input.rawBytes ?? null,
        },
        select,
      }),

    attachOriginal: (id, rawR2Key, rawBytes) =>
      db.unroutedEmail.update({
        where: { id },
        data: { rawR2Key, rawBytes },
        select,
      }),

    putOriginal: async (id, raw) => {
      // No organization in the prefix, because there is no organization. The
      // key says what this is instead.
      const key = `unrouted/${id}/message.eml`
      await putObject(
        r2ConfigFromEnv(),
        key,
        bytesOfBase64(raw),
        'message/rfc822',
      )
      return key
    },
  }
}

/** Base64 to bytes, without Buffer — this runs on workerd. */
function bytesOfBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

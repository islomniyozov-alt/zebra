// ---------------------------------------------------------------------------
// MAIL NOBODY CLAIMS IS STILL MAIL THAT ARRIVED.
//
// `/api/inbound-email` answers 202 when no organization claims the recipient,
// and that stays: a 4xx makes Cloudflare retry a message that can never route,
// and a bounce tells a stranger which addresses exist. Both were ruled on and
// both still hold.
//
// BUT 202 IS AN ACKNOWLEDGEMENT. The sending server marks the message
// delivered and stops. Until this file, that acknowledgement was untrue — the
// message was discarded with a `console.warn`, so "delivered" and "exists
// nowhere" were simultaneously true, which is the one thing a mail path must
// never allow. The 202 is now EARNED: it is returned after the message is
// somewhere, and never before.
//
// NOTHING HERE IS TENANT-SCOPED, AND IT CANNOT BE. A message is in this path
// BECAUSE the question "whose is this?" was asked and answered no, so there is
// no organization to scope to and `withOrg` has nothing it could be given.
// That exception is defended in `unrouted-email-store.ts` and in the exact
// list in `tests/structure.test.ts`.
//
// THE DATABASE HANDLE IS NOT IN THIS FILE. `unrouted-email-store.ts` holds it
// behind `server-only`; this file holds the decisions and imports nothing that
// touches a socket. That is what lets every branch below be forced in a test
// with no database and no bucket — including the branches that only happen
// when R2 is down, which are the ones worth proving.
//
// KEYED ON THE MESSAGE-ID, NOT A CONTENT HASH. Measured rather than assumed:
// one message redelivered three times grew by a byte between attempts as the
// sender rewrote a trace header (brief flag 58). Hashing the raw `.eml` would
// have recorded the same message twice, and only ever on a retry — the day the
// mail path is already having a bad time.
// ---------------------------------------------------------------------------

/** What the endpoint knows about a message it cannot route. */
export interface UnroutedInput {
  messageId: string
  from: string
  to: string
  subject?: string | null
  text?: string | null
  /** The whole `.eml`, base64. Null when it was too large to carry. */
  raw?: string | null
  rawBytes?: number | null
}

export interface UnroutedRow {
  id: string
  messageId: string
  rawR2Key: string | null
}

/**
 * The two things keeping a message requires, as a seam.
 *
 * Injected rather than imported so `tests/unrouted-email.test.ts` can watch
 * every branch — including the ones that only happen when R2 is down — without
 * a database or a bucket. The failure this whole file exists to prevent is a
 * silent one, and a silent failure needs a test that can force it.
 */
export interface UnroutedStore {
  find(messageId: string): Promise<UnroutedRow | null>
  create(input: UnroutedInput): Promise<UnroutedRow>
  attachOriginal(
    id: string,
    rawR2Key: string,
    rawBytes: number | null,
  ): Promise<UnroutedRow>
  /** Writes the `.eml` and returns its key. */
  putOriginal(id: string, raw: string): Promise<string>
}

/**
 * Record a message no tenant claims, and say where it went.
 *
 * THROWS IF THE ROW CANNOT BE WRITTEN, on purpose. The caller must turn that
 * into a 5xx so the mail worker throws and the sending server keeps the
 * message. Answering 202 after failing to record it would be the original bug
 * wearing a new coat.
 *
 * DOES NOT THROW IF R2 FAILS. By then the row exists, so the invariant this
 * file defends — that a delivered message exists somewhere — is already
 * satisfied, and refusing the message would ask a stranger's mail server to
 * redeliver something we have already kept. The missing original is logged and
 * `rawR2Key` stays null, which is exactly what "no original stored" looks like.
 *
 * REDELIVERY IS A NO-OP THAT HEALS. A second copy finds the existing row and
 * creates nothing; but if that row never got its original — R2 was down the
 * first time — the retry is used to try again. Nothing else in the row is
 * rewritten: the first copy is the one that arrived.
 */
export async function keepUnrouted(
  input: UnroutedInput,
  store: UnroutedStore,
  log: (message: string) => void = console.error,
): Promise<UnroutedRow> {
  const existing = await store.find(input.messageId)
  const row = existing ?? (await store.create(input))

  if (row.rawR2Key !== null || !input.raw) return row

  try {
    const key = await store.putOriginal(row.id, input.raw)
    return await store.attachOriginal(row.id, key, input.rawBytes ?? null)
  } catch (error) {
    log(
      `[zebra.inbound] kept ${row.id} but could not store its original: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return row
  }
}

// ---------------------------------------------------------------------------
// PASSWORD HASHING — PBKDF2 over WebCrypto
//
// Nothing native. bcrypt is a C++ addon and @node-rs/argon2 is a Rust one;
// neither exists on workerd, and both work perfectly in `next dev`, which is
// how that discovery normally happens at deploy time.
//
// WebCrypto's PBKDF2 is available in both runtimes and needs no dependency and
// no WASM. Measured in workerd (tests/workers/password.test.ts): 600,000
// iterations of PBKDF2-HMAC-SHA256 costs roughly 0.7s of CPU. That is a lot
// for one request and the right amount for this one — logins are rare, and
// rate limiting bounds how often an attacker can make us pay it.
//
// ENCODED FORM, one self-describing string:
//
//   pbkdf2$sha256$600000$<salt base64url>$<derived key base64url>
//
// The parameters travel with the hash, so raising the iteration count later
// does not invalidate existing passwords: old hashes keep verifying against
// the parameters they were made with, and `needsRehash` says which ones to
// upgrade the next time their owner logs in successfully.
// ---------------------------------------------------------------------------

const ALGORITHM = 'pbkdf2'
const DIGEST = 'sha256'
const WEBCRYPTO_HASH = 'SHA-256'

/** OWASP's current floor for PBKDF2-HMAC-SHA256. */
export const DEFAULT_ITERATIONS = 600_000

const SALT_BYTES = 16
const DERIVED_BITS = 256

const encoder = new TextEncoder()

/**
 * Backed by a plain ArrayBuffer, not a SharedArrayBuffer. WebCrypto will not
 * accept the latter, and since TypeScript 5.7 `Uint8Array` alone no longer
 * promises which it is.
 */
type Bytes = Uint8Array<ArrayBuffer>

function toBase64Url(bytes: Bytes): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Bytes {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function derive(
  password: string,
  salt: Bytes,
  iterations: number,
): Promise<Bytes> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: WEBCRYPTO_HASH, salt, iterations },
    key,
    DERIVED_BITS,
  )
  return new Uint8Array(bits)
}

/**
 * Compare without leaking where two byte strings first differ.
 *
 * `a === b` on the encoded hashes would return early on the first mismatched
 * character, and the time it took to do so is a measurement of how much of the
 * hash an attacker guessed correctly.
 */
function timingSafeEqual(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!
  return difference === 0
}

export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const derived = await derive(password, salt, iterations)
  return [
    ALGORITHM,
    DIGEST,
    iterations,
    toBase64Url(salt),
    toBase64Url(derived),
  ].join('$')
}

/**
 * Whether `password` produced `encoded`.
 *
 * Returns false rather than throwing on a malformed hash: a corrupt row in the
 * database is a failed login, not a 500 that tells the caller their account is
 * interesting.
 */
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parsed = parse(encoded)
  if (!parsed) return false

  const derived = await derive(password, parsed.salt, parsed.iterations)
  return timingSafeEqual(derived, parsed.hash)
}

interface ParsedHash {
  iterations: number
  salt: Bytes
  hash: Bytes
}

function parse(encoded: string): ParsedHash | null {
  const parts = encoded.split('$')
  if (parts.length !== 5) return null

  const [algorithm, digest, iterationsRaw, saltRaw, hashRaw] = parts
  if (algorithm !== ALGORITHM || digest !== DIGEST) return null

  const iterations = Number(iterationsRaw)
  if (!Number.isInteger(iterations) || iterations < 1) return null

  try {
    return {
      iterations,
      salt: fromBase64Url(saltRaw!),
      hash: fromBase64Url(hashRaw!),
    }
  } catch {
    return null
  }
}

/**
 * Whether a stored hash was made with weaker parameters than we now use.
 *
 * Call after a successful verify — that is the only moment the plaintext is in
 * hand, and so the only moment a rehash is possible.
 */
export function needsRehash(
  encoded: string,
  iterations: number = DEFAULT_ITERATIONS,
): boolean {
  const parsed = parse(encoded)
  return parsed === null || parsed.iterations < iterations
}

/**
 * A hash of a value nobody knows, for the login path to verify against when
 * the email matched no user.
 *
 * Without it, "no such user" returns in a millisecond and "wrong password"
 * returns in seven hundred, and the difference is a working list of which
 * email addresses hold accounts.
 */
export async function dummyHash(): Promise<string> {
  return hashPassword(toBase64Url(crypto.getRandomValues(new Uint8Array(32))))
}

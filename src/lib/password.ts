import { argon2id } from '@noble/hashes/argon2.js'

// ---------------------------------------------------------------------------
// PASSWORD HASHING — argon2id, pure JavaScript
//
// Three runtimes' worth of dead ends are recorded here so nobody walks back
// into one:
//
//   * bcrypt is a C++ addon and @node-rs/argon2 is a Rust one. Neither exists
//     on workerd. Both work perfectly in `next dev`, which is how that gets
//     discovered at deploy time.
//   * PBKDF2 over WebCrypto works in both runtimes, but deployed Workers cap
//     it at 100,000 iterations — below OWASP's 600k floor for SHA-256. Phase 1
//     claimed 600k was "measured in workerd"; it was measured in the vitest
//     workers pool, which does not enforce the cap. The deployed runtime does.
//   * hash-wasm decodes its module from base64 and calls
//     `WebAssembly.compile` at runtime. workerd answers "Wasm code generation
//     disallowed by embedder" — the same refusal that forced a second Prisma
//     client in Phase 1. Verified, not assumed: see the report for Step 1.
//
// What is left is a pure-JS implementation, and @noble/hashes is the audited
// one. It costs about half a second in workerd for OWASP's m=19456 profile,
// which is the same order as the PBKDF2 it replaces and a great deal more
// resistant to the hardware an attacker would bring.
//
// ENCODED FORM — the PHC string format, so the parameters travel with the
// hash and a future tuning does not invalidate anything already stored:
//
//   $argon2id$v=19$m=19456,t=2,p=1$<salt b64>$<hash b64>
//
// Legacy `pbkdf2$sha256$<n>$<salt>$<hash>` strings still VERIFY, and
// `needsRehash` reports them as stale, so every existing password upgrades
// itself the next time its owner logs in successfully.
// ---------------------------------------------------------------------------

/**
 * OWASP's second recommended argon2id profile (m=19 MiB, t=2, p=1).
 *
 * Memory is the parameter that costs an attacker their GPU advantage, so it is
 * the one to spend on. 19 MiB per concurrent login leaves comfortable room
 * under a Worker isolate's 128 MB alongside Next and Prisma; the 46 MiB
 * profile does not, and buys little — measured, the two are 640ms and 511ms.
 */
export const ARGON2_PARAMS = {
  /** Memory cost, in KiB. */
  m: 19456,
  /** Time cost — passes over memory. */
  t: 2,
  /** Lanes. One, because workerd gives us no threads to spend them on. */
  p: 1,
} as const

const ARGON2_VERSION = 19
const DERIVED_BYTES = 32
const SALT_BYTES = 16

/** Legacy only. Nothing creates a PBKDF2 hash any more; these still verify. */
const LEGACY_ALGORITHM = 'pbkdf2'
const LEGACY_DIGEST = 'sha256'
const LEGACY_WEBCRYPTO_HASH = 'SHA-256'

const encoder = new TextEncoder()

/**
 * Backed by a plain ArrayBuffer, not a SharedArrayBuffer. WebCrypto will not
 * accept the latter, and since TypeScript 5.7 `Uint8Array` alone no longer
 * promises which it is.
 */
type Bytes = Uint8Array<ArrayBuffer>

// --- encoding ---------------------------------------------------------------
//
// PHC uses standard base64 with the padding stripped — NOT base64url. Getting
// this wrong produces hashes that verify here and nowhere else, which is the
// kind of bug that only shows up the day you migrate off this file.

function toB64(bytes: Bytes): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=+$/, '')
}

function fromB64(value: string): Bytes {
  const binary = atob(value.padEnd(Math.ceil(value.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function toBase64Url(bytes: Bytes): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_')
}

function fromBase64Url(value: string): Bytes {
  return fromB64(value.replace(/-/g, '+').replace(/_/g, '/'))
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

// --- argon2id ---------------------------------------------------------------

export interface Argon2Params {
  m: number
  t: number
  p: number
}

function deriveArgon2(
  password: string,
  salt: Bytes,
  params: Argon2Params,
): Bytes {
  return argon2id(password.normalize('NFKC'), salt, {
    ...params,
    dkLen: DERIVED_BYTES,
  }) as Bytes
}

export async function hashPassword(
  password: string,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const derived = deriveArgon2(password, salt, params)
  return [
    '',
    'argon2id',
    `v=${ARGON2_VERSION}`,
    `m=${params.m},t=${params.t},p=${params.p}`,
    toB64(salt),
    toB64(derived),
  ].join('$')
}

// --- parsing ----------------------------------------------------------------

type Parsed =
  | { kind: 'argon2id'; params: Argon2Params; salt: Bytes; hash: Bytes }
  | { kind: 'pbkdf2'; iterations: number; salt: Bytes; hash: Bytes }

function parse(encoded: string): Parsed | null {
  return encoded.startsWith('$argon2id$')
    ? parseArgon2(encoded)
    : parseLegacy(encoded)
}

function parseArgon2(encoded: string): Parsed | null {
  // A leading '$' means split() yields an empty first element. Six parts.
  const parts = encoded.split('$')
  if (parts.length !== 6) return null

  const [, id, version, paramList, saltRaw, hashRaw] = parts
  if (id !== 'argon2id') return null
  if (version !== `v=${ARGON2_VERSION}`) return null

  const params: Record<string, number> = {}
  for (const pair of paramList!.split(',')) {
    const [key, value] = pair.split('=')
    if (!key || value === undefined) return null
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1) return null
    params[key] = parsed
  }
  const { m, t, p } = params
  if (m === undefined || t === undefined || p === undefined) return null

  try {
    return {
      kind: 'argon2id',
      params: { m, t, p },
      salt: fromB64(saltRaw!),
      hash: fromB64(hashRaw!),
    }
  } catch {
    return null
  }
}

function parseLegacy(encoded: string): Parsed | null {
  const parts = encoded.split('$')
  if (parts.length !== 5) return null

  const [algorithm, digest, iterationsRaw, saltRaw, hashRaw] = parts
  if (algorithm !== LEGACY_ALGORITHM || digest !== LEGACY_DIGEST) return null

  const iterations = Number(iterationsRaw)
  if (!Number.isInteger(iterations) || iterations < 1) return null

  try {
    return {
      kind: 'pbkdf2',
      iterations,
      salt: fromBase64Url(saltRaw!),
      hash: fromBase64Url(hashRaw!),
    }
  } catch {
    return null
  }
}

async function deriveLegacy(
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
    { name: 'PBKDF2', hash: LEGACY_WEBCRYPTO_HASH, salt, iterations },
    key,
    DERIVED_BYTES * 8,
  )
  return new Uint8Array(bits)
}

// --- the two things callers use ---------------------------------------------

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

  const derived =
    parsed.kind === 'argon2id'
      ? deriveArgon2(password, parsed.salt, parsed.params)
      : await deriveLegacy(password, parsed.salt, parsed.iterations)

  return timingSafeEqual(derived, parsed.hash)
}

/**
 * Whether a stored hash was made with weaker parameters than we now use.
 *
 * Every PBKDF2 hash qualifies, which is what makes the migration a rolling one
 * rather than a forced reset: the old hash verifies, and is replaced in the
 * same request.
 *
 * Call after a successful verify — that is the only moment the plaintext is in
 * hand, and so the only moment a rehash is possible.
 */
export function needsRehash(
  encoded: string,
  params: Argon2Params = ARGON2_PARAMS,
): boolean {
  const parsed = parse(encoded)
  if (parsed === null) return true
  if (parsed.kind === 'pbkdf2') return true
  return (
    parsed.params.m < params.m ||
    parsed.params.t < params.t ||
    parsed.params.p < params.p
  )
}

/**
 * A hash of a value nobody knows, for the login path to verify against when
 * the email matched no user.
 *
 * Without it, "no such user" returns in a millisecond and "wrong password"
 * returns in five hundred, and the difference is a working list of which email
 * addresses hold accounts.
 */
export async function dummyHash(): Promise<string> {
  return hashPassword(toBase64Url(crypto.getRandomValues(new Uint8Array(32))))
}

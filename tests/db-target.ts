// ---------------------------------------------------------------------------
// WHICH DATABASE THE SUITE IS ABOUT TO WRITE TO, AND WHETHER THAT IS ALLOWED.
//
// THE GUARD THAT DID NOT FIRE. `tests/setup.ts` refused to run when
// `NEON_BRANCH === 'production'`, and on the day it mattered it said nothing —
// because `NEON_BRANCH` is a LABEL. Nothing enforces it, nothing derives it
// from the connection, and a terminal can carry a production
// `DIRECT_DATABASE_URL` with the label unset or stale and the guard will wave
// it through. It was checking a sticker on the box.
//
// THE SHAPE OF THE INCIDENT IS THE REAL LESSON. `deploy:prod` was run in a
// ritual terminal where `DIRECT_DATABASE_URL` pointed at production while
// `DATABASE_URL` still came from `.env` and pointed at dev. The suite then ran
// SPLIT-BRAINED:
//
//   fixtures  → `retryingClient(DIRECT_DATABASE_URL)` → production
//   the app   → `prisma` in src/lib/db.ts → `DATABASE_URL` → dev
//
// which is exactly the reported failure: organizations missing their own rows,
// foreign-key violations on `organizationId`, reset tokens read back null. The
// rows were being written to one database and looked for in another.
//
// So the check that would have caught it is not about a label at all: THE TWO
// URLS MUST NAME THE SAME ENDPOINT. That is true of every legitimate
// configuration and false of every way this can go wrong, including ways
// nobody has thought of yet.
// ---------------------------------------------------------------------------

export interface DbTarget {
  DATABASE_URL?: string | undefined
  DIRECT_DATABASE_URL?: string | undefined
  NEON_BRANCH?: string | undefined
}

/**
 * A Neon hostname with the pooler suffix folded away.
 *
 * `ep-little-lake-aydu7faj-pooler.c-5.…` and `ep-little-lake-aydu7faj.c-5.…`
 * are the pooled and direct doors of ONE endpoint, and the suite legitimately
 * uses one of each. Everything after that first label must match exactly.
 */
export function endpointOf(url: string): string {
  const { hostname } = new URL(url)
  const [first, ...rest] = hostname.split('.')
  return [(first ?? '').replace(/-pooler$/, ''), ...rest].join('.')
}

export type TargetRefusal =
  | { ok: true; endpoint: string }
  | { ok: false; reason: 'missing'; message: string }
  | { ok: false; reason: 'unparseable'; message: string }
  | { ok: false; reason: 'split_brain'; message: string }
  | { ok: false; reason: 'production_label'; message: string }

/**
 * May the integration suite write here?
 *
 * Pure, so it can be tested rather than believed — the previous guard was one
 * `if` nobody had ever watched fail.
 */
export function checkDbTarget(env: DbTarget): TargetRefusal {
  const pooled = env.DATABASE_URL
  const direct = env.DIRECT_DATABASE_URL

  if (!pooled || !direct) {
    return {
      ok: false,
      reason: 'missing',
      message:
        'Tests need DATABASE_URL and DIRECT_DATABASE_URL. Copy .env.example to .env.',
    }
  }

  let pooledEndpoint: string
  let directEndpoint: string
  try {
    pooledEndpoint = endpointOf(pooled)
    directEndpoint = endpointOf(direct)
  } catch {
    return {
      ok: false,
      reason: 'unparseable',
      message: 'DATABASE_URL or DIRECT_DATABASE_URL is not a URL.',
    }
  }

  // THE CHECK THAT WOULD HAVE CAUGHT THE INCIDENT, and it comes first because
  // it is the one that does not depend on anybody labelling anything.
  if (pooledEndpoint !== directEndpoint) {
    return {
      ok: false,
      reason: 'split_brain',
      message:
        'DATABASE_URL and DIRECT_DATABASE_URL name DIFFERENT endpoints:\n' +
        `  DATABASE_URL        -> ${pooledEndpoint}\n` +
        `  DIRECT_DATABASE_URL -> ${directEndpoint}\n` +
        'The fixtures would write to one and the application read the other. ' +
        'This is what a leftover shell variable looks like.',
    }
  }

  // Kept as well, not instead. The label is worthless on its own and still
  // worth honouring when somebody has set it honestly.
  if ((env.NEON_BRANCH ?? '').trim().toLowerCase() === 'production') {
    return {
      ok: false,
      reason: 'production_label',
      message: 'NEON_BRANCH says production. Refusing to run tests here.',
    }
  }

  return { ok: true, endpoint: pooledEndpoint }
}

/** The same, as the throw `tests/setup.ts` needs. */
export function assertSafeDbTarget(env: DbTarget): string {
  const outcome = checkDbTarget(env)
  if (!outcome.ok) {
    throw new Error(
      `Refusing to run the integration suite.\n${outcome.message}`,
    )
  }
  return outcome.endpoint
}

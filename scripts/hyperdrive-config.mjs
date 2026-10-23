// ---------------------------------------------------------------------------
// THE HYPERDRIVE CONFIG, READ BACK FROM CLOUDFLARE (§6.10, 2026-10-23).
//
// The binding's connection string carries Hyperdrive's own generated user at a
// `*.hyperdrive.local` host; it cannot say which role the origin uses or
// whether query caching is off. Only the config Cloudflare holds can — and
// both answers matter: an owner origin bypasses row-level security, and a
// cached read under RLS is a cross-tenant read. So the sweep reads the dev
// config back before it sweeps, and the deploy reads the target's config back
// before it uploads, and each refuses on any answer but `zebra_app` with
// `caching.disabled: true`. One module, so the two cannot drift.
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** JSONC as wrangler reads it: line comments and trailing commas removed. */
export function parseWranglerConfig(jsonc) {
  const stripped = jsonc
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n')
    .replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(stripped)
}

/**
 * The id bound as HYPERDRIVE for a target: the top-level block for `dev`,
 * `env.production.hyperdrive` for `production` — bindings do not inherit, so
 * the two are looked up separately and never fall back to each other.
 */
export function boundHyperdriveId(jsonc, target = 'dev') {
  const config = parseWranglerConfig(jsonc)
  const block =
    target === 'production'
      ? (config.env?.production?.hyperdrive ?? [])
      : (config.hyperdrive ?? [])
  const entry = block.find((h) => h.binding === 'HYPERDRIVE')
  return entry?.id ?? null
}

/**
 * The verdict over a `wrangler hyperdrive get` answer. Pure, for the tests.
 * No answer at all is a refusal, not a pass.
 */
export function hyperdriveVerdict(id, config) {
  const originUser = config?.origin?.user ?? null
  const originHost = config?.origin?.host ?? null
  const cachingDisabled = config?.caching?.disabled === true
  const reasons = []
  if (originUser !== 'zebra_app')
    reasons.push(`origin user is ${originUser ?? 'unknown'}, not zebra_app`)
  if (!cachingDisabled) reasons.push('query caching is not disabled')
  return {
    id,
    originUser,
    originHost,
    cachingDisabled,
    ok: reasons.length === 0,
    reason: reasons.join('; ') || null,
  }
}

/** One line for a log: what Cloudflare said about the bound config. */
export function describeReadBack(target, verdict) {
  return verdict.ok
    ? `hyperdrive (${target}) ${verdict.id}: origin user ${verdict.originUser} at ${verdict.originHost}, caching disabled ${verdict.cachingDisabled}. OK.`
    : `HYPERDRIVE (${target}) ${verdict.id} REFUSED: ${verdict.reason}. NOT OK.`
}

/**
 * Ask Cloudflare for the config a target binds; null when nothing is bound.
 * `cwd` holds wrangler.jsonc (the repository root).
 */
export function readBackHyperdrive(target = 'dev', cwd = process.cwd()) {
  const id = boundHyperdriveId(
    readFileSync(join(cwd, 'wrangler.jsonc'), 'utf8'),
    target,
  )
  if (!id) return null
  const wrangler = fileURLToPath(
    new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
  )
  const result = spawnSync(
    process.execPath,
    [wrangler, 'hyperdrive', 'get', id],
    {
      encoding: 'utf8',
    },
  )
  const text = `${result.stdout}\n${result.stderr}`.replace(
    /\x1b\[[0-9;]*m/g,
    '',
  )
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return hyperdriveVerdict(id, null)
  try {
    return hyperdriveVerdict(id, JSON.parse(text.slice(start, end + 1)))
  } catch {
    return hyperdriveVerdict(id, null)
  }
}

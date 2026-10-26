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
 * @param {string} id
 * @param {{ origin?: { user?: string; host?: string }; caching?: { disabled?: boolean } } | null} config
 * @param {string | null} [noAnswer] what wrangler said when it said no JSON
 */
export function hyperdriveVerdict(id, config, noAnswer = null) {
  const originUser = config?.origin?.user ?? null
  const originHost = config?.origin?.host ?? null
  const cachingDisabled = config?.caching?.disabled === true
  const reasons = []
  // NO ANSWER IS ITS OWN REASON. On 2026-10-26 CI's dev deploy refused with
  // "origin user is unknown, not zebra_app; query caching is not disabled"
  // when wrangler had returned no config at all — the deploy token could not
  // read Hyperdrive — and the message blamed the config. Say what wrangler
  // said instead, so the next reader sees the cause and not a symptom.
  if (!config)
    reasons.push(
      `Cloudflare returned no config${noAnswer ? ` — wrangler said: ${noAnswer}` : ''}`,
    )
  else {
    if (originUser !== 'zebra_app')
      reasons.push(`origin user is ${originUser ?? 'unknown'}, not zebra_app`)
    if (!cachingDisabled) reasons.push('query caching is not disabled')
  }
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
  if (start < 0 || end < start)
    return hyperdriveVerdict(id, null, wranglerSaid(text, result.status))
  try {
    return hyperdriveVerdict(id, JSON.parse(text.slice(start, end + 1)))
  } catch {
    return hyperdriveVerdict(id, null, wranglerSaid(text, result.status))
  }
}

/**
 * What wrangler said when it did not say JSON. The ERROR lines if there are
 * any, else the last three non-empty lines — never the "Logs were written to"
 * footer alone, which is what the first version quoted on 2026-10-26 and
 * which says nothing. Capped; an error line carries no secret.
 * @param {string} text wrangler's stdout and stderr, colours stripped
 * @param {number | null} status its exit code
 */
export function wranglerSaid(text, status) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^🪵|Logs were written to/.test(line))
  const errors = lines.filter((line) => /error|✘|\[code:/i.test(line))
  const chosen = (errors.length ? errors : lines.slice(-3)).join(' | ')
  return chosen.slice(0, 400) || `exit ${status ?? 'null'}, no output`
}

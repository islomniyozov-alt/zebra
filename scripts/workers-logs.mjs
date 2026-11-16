#!/usr/bin/env node
// ---------------------------------------------------------------------------
// WORKERS LOGS, PERSISTED — read by ray and by day, not tailed (owner's
// ruling 2026-11-15, GAPS 44). A tail sees what arrives while it runs and
// never says what a 1102 or a stalled sign-in cost; the persisted logs keep
// the runtime's own outcome, wall and CPU for every invocation they hold.
//
//   node --env-file=.env scripts/workers-logs.mjs rays <service> <fromISO> <toISO> <ray>…
//   node --env-file=.env scripts/workers-logs.mjs days <service> <n>
//
// Needs CLOUDFLARE_OBSERVABILITY_TOKEN (Workers Observability: Read) and
// R2_ACCOUNT_ID, the account. WITHOUT THE TOKEN THE READING IS "UNREADABLE",
// by name — never an empty result, because no events is what a clean day
// looks like too. `days` asks one UTC day at a time: a week-wide window lets
// adaptive sampling thin the events (3 sign-in lines where the day had 4),
// and a sampled answer says so (`abr`).
//
// MEMORY. The runtime's event carries an outcome (`exceededMemory`,
// `exceededCpu`) and wall and CPU milliseconds; whether it carries a memory
// figure is read off the event, not assumed — any `$workers` key beyond the
// known ones is kept as `extra`, and `memory` is null when there is none.
// ---------------------------------------------------------------------------
import { fileURLToPath } from 'node:url'

export const API = 'https://api.cloudflare.com/client/v4'
export const DAY_MS = 86_400_000

/** The token and account, or the reason the logs cannot be read. */
export function observabilityConfig(env) {
  const token = env.CLOUDFLARE_OBSERVABILITY_TOKEN
  const account = env.R2_ACCOUNT_ID
  if (!token)
    return {
      unreadable:
        'CLOUDFLARE_OBSERVABILITY_TOKEN is not in .env (Workers Observability: Read)',
    }
  if (!account) return { unreadable: 'R2_ACCOUNT_ID is not in .env' }
  return { token, account }
}

const KNOWN = new Set([
  'event',
  'outcome',
  'wallTimeMs',
  'cpuTimeMs',
  'scriptName',
  'scriptVersion',
  'eventType',
  'executionModel',
  'truncated',
  'requestId',
])

/** One persisted invocation event, as the fields this reading needs. */
export function invocationOf(event) {
  const w = event?.$workers ?? {}
  const request = w.event?.request ?? {}
  let path = null
  try {
    path = request.url ? new URL(request.url).pathname : null
  } catch {
    path = null
  }
  const extra = Object.fromEntries(
    Object.entries(w).filter(([key]) => !KNOWN.has(key)),
  )
  const memoryKey = Object.keys(extra).find((key) => /memory/i.test(key))
  return {
    ray: event?.$metadata?.rayId ?? null,
    at: event?.timestamp
      ? new Date(Number(event.timestamp)).toISOString()
      : null,
    method: request.method ?? null,
    path,
    status: w.event?.response?.status ?? null,
    outcome: w.outcome ?? null,
    wallMs: w.wallTimeMs ?? null,
    cpuMs: w.cpuTimeMs ?? null,
    memory: memoryKey ? extra[memoryKey] : null,
    extra,
  }
}

/**
 * The ray as the persisted logs hold it. A response's `cf-ray` header ends in
 * the colo (`a5b10b7b58e9a9b4-IAD`) and `$metadata.rayId` does not — asked
 * with the suffix, the logs answered nothing for a ray they held (first run,
 * 2026-11-16).
 */
export const rayIdOf = (ray) => String(ray).replace(/-[A-Z]{3}$/, '')

/** The limit an invocation hit, by the runtime's own outcome, or null. */
export const limitNamed = (invocation) =>
  /^exceeded/i.test(String(invocation?.outcome ?? ''))
    ? String(invocation.outcome)
    : null

/** One line for a ray's reading — the limit by name, or what was read. */
export function rayLine(ray, invocations, unreadable) {
  if (unreadable) return `${ray}: UNREADABLE — ${unreadable}`
  if (invocations.length === 0)
    return `${ray}: UNREADABLE — no persisted invocation for this ray`
  return invocations
    .map(
      (i) =>
        `${ray}: ${i.method ?? '?'} ${i.path ?? '?'} status ${i.status ?? '-'} outcome ${i.outcome ?? '-'}${limitNamed(i) ? ` (LIMIT: ${limitNamed(i)})` : ''} wall ${i.wallMs ?? '-'} ms cpu ${i.cpuMs ?? '-'} ms memory ${i.memory ?? 'not in the event'}`,
    )
    .join('\n')
}

/**
 * Per-day tallies of the limit outcomes, and the routes they fell on, from
 * invocations already read. `days` are UTC day starts (ms).
 */
export function tallyDays(days, invocations) {
  return days.map((start) => {
    const mine = invocations.filter((i) => {
      const t = Date.parse(i.at ?? '')
      return t >= start && t < start + DAY_MS
    })
    const byOutcome = {}
    const routes = {}
    for (const i of mine) {
      const limit = limitNamed(i)
      if (!limit) continue
      byOutcome[limit] = (byOutcome[limit] ?? 0) + 1
      const key = `${limit} ${i.path ?? '?'}`
      routes[key] = (routes[key] ?? 0) + 1
    }
    return {
      day: new Date(start).toISOString().slice(0, 10),
      byOutcome,
      routes,
    }
  })
}

async function query(config, body) {
  const response = await fetch(
    `${API}/accounts/${config.account}/workers/observability/telemetry/query`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )
  const json = await response.json().catch(() => null)
  if (!response.ok || !json?.success)
    throw new Error(
      `telemetry query ${response.status}: ${JSON.stringify(json?.errors ?? json).slice(0, 400)}`,
    )
  return json.result
}

const eventsOf = (result) => result?.events?.events ?? result?.events ?? []
const service = (name) => ({
  key: '$metadata.service',
  operation: 'eq',
  value: name,
  type: 'string',
})
const invocationsOnly = {
  key: '$metadata.type',
  operation: 'eq',
  value: 'cf-worker-event',
  type: 'string',
}

/**
 * Every persisted invocation for each ray, as `{ ray, invocations }`, or
 * `{ unreadable }` when the logs cannot be asked. Never throws.
 */
export async function readRays(env, name, rays, from, to) {
  const config = observabilityConfig(env)
  if (config.unreadable) return { unreadable: config.unreadable }
  try {
    const out = []
    for (const ray of rays) {
      const result = await query(config, {
        queryId: 'ray',
        timeframe: { from, to },
        parameters: {
          datasets: ['cloudflare-workers'],
          filters: [
            service(name),
            invocationsOnly,
            {
              key: '$metadata.rayId',
              operation: 'eq',
              value: rayIdOf(ray),
              type: 'string',
            },
          ],
        },
        view: 'events',
        limit: 20,
      })
      out.push({ ray, invocations: eventsOf(result).map(invocationOf) })
    }
    return { rays: out }
  } catch (error) {
    return { unreadable: String(error?.message ?? error) }
  }
}

/** The last `n` UTC days' limit outcomes, one query per day. */
export async function readLimitDays(env, name, n, now = Date.now()) {
  const config = observabilityConfig(env)
  if (config.unreadable) return { unreadable: config.unreadable }
  const today = Math.floor(now / DAY_MS) * DAY_MS
  const days = Array.from({ length: n }, (_, k) => today - (n - 1 - k) * DAY_MS)
  try {
    const invocations = []
    const counts = []
    for (const start of days) {
      const timeframe = { from: start, to: Math.min(now, start + DAY_MS) }
      const totals = await query(config, {
        queryId: 'limit-days-outcome',
        timeframe,
        parameters: {
          datasets: ['cloudflare-workers'],
          filters: [service(name), invocationsOnly],
          calculations: [{ operator: 'count' }],
          groupBys: [{ type: 'string', value: '$workers.outcome' }],
        },
        view: 'calculations',
        limit: 50,
      })
      counts.push(
        Object.fromEntries(
          (totals?.calculations?.[0]?.aggregates ?? []).map((a) => [
            a.groupKey ?? '(none)',
            a.count,
          ]),
        ),
      )
      // The events of each limit outcome the day's counts actually hold, one
      // `eq` query apiece — the API answered 400 to an `in` filter on the
      // outcome (first run, 2026-11-16).
      const limits = Object.keys(counts.at(-1)).filter((outcome) =>
        /^exceeded/i.test(outcome),
      )
      for (const outcome of limits) {
        const limited = await query(config, {
          queryId: 'limit-days-events',
          timeframe,
          parameters: {
            datasets: ['cloudflare-workers'],
            filters: [
              service(name),
              invocationsOnly,
              {
                key: '$workers.outcome',
                operation: 'eq',
                value: outcome,
                type: 'string',
              },
            ],
          },
          view: 'events',
          limit: 1000,
        })
        invocations.push(...eventsOf(limited).map(invocationOf))
      }
    }
    return {
      days: tallyDays(days, invocations).map((day, k) => ({
        ...day,
        outcomes: counts[k],
      })),
    }
  } catch (error) {
    return { unreadable: String(error?.message ?? error) }
  }
}

async function main() {
  const [mode, name, ...rest] = process.argv.slice(2)
  if (mode === 'rays') {
    const [from, to, ...rays] = rest
    const read = await readRays(
      process.env,
      name,
      rays,
      Date.parse(from),
      Date.parse(to),
    )
    if (read.unreadable) {
      console.log(`PERSISTED LOGS UNREADABLE — ${read.unreadable}. NOT OK.`)
      return 1
    }
    for (const { ray, invocations } of read.rays)
      console.log(rayLine(ray, invocations))
    return 0
  }
  if (mode === 'days') {
    const read = await readLimitDays(process.env, name, Number(rest[0] ?? 7))
    if (read.unreadable) {
      console.log(`PERSISTED LOGS UNREADABLE — ${read.unreadable}. NOT OK.`)
      return 1
    }
    for (const day of read.days) {
      console.log(
        `${day.day}  outcomes ${JSON.stringify(day.outcomes)}  limits ${JSON.stringify(day.byOutcome)}`,
      )
      for (const [route, count] of Object.entries(day.routes))
        console.log(`    ${count} × ${route}`)
    }
    return 0
  }
  throw new Error(`workers-logs: unknown mode ${mode} (rays | days)`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`workers-logs: ${error.message} — NOT OK`)
      process.exit(1)
    },
  )
}

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  rayKey,
  rayOf,
  takeJsonObjects,
  trimEvent,
  workerNameFor,
} from '../scripts/worker-tail.mjs'
import {
  BODY_BYTES,
  detailPath,
  isServerError,
  serverErrorRecord,
} from '../scripts/sweep.mjs'

// ---------------------------------------------------------------------------
// A SERVER ERROR IS EVIDENCE (TMS-DESIGN-SYSTEM.md §6.8, owner's ruling
// 2026-10-11). On a sweep, a 500 is recorded with its ray, role, the first
// 2 KB of its body and the Worker's log for that ray, in the verdict file.
// These hold the parts that can be held without a worker: the tail's stream
// parsing, what of an event goes on disk, the record's shape, and the wrapper
// folding the record into the verdict.
// ---------------------------------------------------------------------------

const event = (ray: string, extra: Record<string, unknown> = {}) => ({
  outcome: 'exception',
  eventTimestamp: 1791747344767,
  exceptions: [{ name: 'Error', message: 'unable to start a transaction' }],
  logs: [{ level: 'error', message: ['⨯', 'Error: boom'] }],
  event: {
    request: {
      url: 'https://zebra-dev.example.workers.dev/loads',
      headers: { 'cf-ray': ray, cookie: 'zebra_session=SECRET' },
    },
    response: { status: 500 },
  },
  ...extra,
})

describe('the tail’s stream', () => {
  it('splits pretty-printed objects, across chunk boundaries', () => {
    const text = `${JSON.stringify(event('a1'), null, 4)}\n${JSON.stringify(event('b2'), null, 4)}`
    const cut = text.length - 40
    const first = takeJsonObjects(text.slice(0, cut))
    expect(first.objects.map(rayOf)).toEqual(['a1'])
    const second = takeJsonObjects(first.rest + text.slice(cut))
    expect(second.objects.map(rayOf)).toEqual(['b2'])
    expect(second.rest).toBe('')
  })

  it('is not fooled by braces or escaped quotes inside a log line', () => {
    const tricky = event('c3', {
      logs: [{ level: 'log', message: ['a "}{" brace \\" and {more}'] }],
    })
    const { objects } = takeJsonObjects(JSON.stringify(tricky, null, 2))
    expect(objects).toHaveLength(1)
    expect(objects[0].logs[0].message[0]).toBe('a "}{" brace \\" and {more}')
  })

  it('matches a response’s ray, colo and all, to the event’s', () => {
    expect(rayKey('a4904f48bc301f5c-DYU')).toBe('a4904f48bc301f5c')
    expect(rayOf(event('a4904f48bc301f5c'))).toBe(
      rayKey('a4904f48bc301f5c-DYU'),
    )
  })

  it('keeps the outcome, the exceptions and the logs — never the headers', () => {
    const kept = trimEvent(event('d4'))
    expect(kept).toEqual({
      outcome: 'exception',
      status: 500,
      at: new Date(1791747344767).toISOString(),
      exceptions: [{ name: 'Error', message: 'unable to start a transaction' }],
      logs: [{ level: 'error', message: '⨯ Error: boom' }],
    })
    expect(JSON.stringify(kept)).not.toContain('SECRET')
  })

  it('tails a workers.dev origin and nothing else', () => {
    expect(workerNameFor('https://zebra-dev.tajikcargollc.workers.dev')).toBe(
      'zebra-dev',
    )
    expect(workerNameFor('http://localhost:3000')).toBeNull()
  })
})

describe('the record', () => {
  it('is the server’s failures, whatever the status line says', () => {
    expect(isServerError('SERVER ERROR')).toBe(true)
    expect(isServerError('ERROR BOUNDARY')).toBe(true)
    expect(isServerError('ok')).toBe(false)
    expect(isServerError('CLIENT ERROR (404)')).toBe(false)
  })

  it('carries role, route, ray and the first 2 KB of the body', () => {
    const row = serverErrorRecord({
      role: 'dispatcher',
      route: '/loads',
      path: '/loads',
      status: 500,
      verdict: 'SERVER ERROR',
      ray: 'a4904f48bc301f5c-DYU',
      body: 'x'.repeat(5000),
    })
    expect(BODY_BYTES).toBe(2048)
    expect(row).toMatchObject({
      role: 'dispatcher',
      route: '/loads',
      status: 500,
      ray: 'a4904f48bc301f5c-DYU',
    })
    expect(row.body).toHaveLength(2048)
  })

  it('goes where the wrapper says, or to a fixed file run bare', () => {
    expect(detailPath({ RUN_STATUS_DETAIL: 'x/y.json' })).toBe('x/y.json')
    expect(detailPath({})).toMatch(/sweep-server-errors\.json$/)
  })
})

describe('the wrapper folds the record into the verdict file', () => {
  it('as `detail`, and `--check` prints each server error', () => {
    const name = 'worker-tail-test'
    // A FILE, NOT `node -e`: on Windows the wrapper spawns through a shell,
    // which would split an inline script at its spaces.
    const child = join(tmpdir(), `${name}-${process.pid}.cjs`)
    writeFileSync(
      child,
      `require('fs').writeFileSync(process.env.RUN_STATUS_DETAIL, JSON.stringify({serverErrors:[{role:'dispatcher',route:'/loads',status:500,ray:'r1',workerNote:'no tail event for this ray within 30 s'}]})); process.exit(1)`,
    )
    try {
      spawnSync(
        process.execPath,
        // `node` by name for the same reason: `process.execPath` has a space.
        ['scripts/run-status.mjs', name, '--', 'node', child],
        { encoding: 'utf8' },
      )
      const status = JSON.parse(
        readFileSync(`.run-status/${name}.json`, 'utf8'),
      )
      expect(status.exitCode).toBe(1)
      expect(status.detail.serverErrors[0]).toMatchObject({
        role: 'dispatcher',
        route: '/loads',
        ray: 'r1',
      })
      const check = spawnSync(
        process.execPath,
        ['scripts/run-status.mjs', '--check', name],
        { encoding: 'utf8' },
      )
      expect(check.stdout).toContain(
        'dispatcher /loads 500 ray r1 — no tail event for this ray within 30 s',
      )
      expect(check.stdout).toContain('FAILED. NOT OK.')
    } finally {
      for (const file of [
        `.run-status/${name}.json`,
        `.run-status/${name}.detail.json`,
        child,
      ])
        if (existsSync(file)) rmSync(file)
    }
  })
})

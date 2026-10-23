// ---------------------------------------------------------------------------
// THE WORKER BUNDLE FITS THE PLAN, WITH ROOM (owner's ruling, 2026-10-23).
//
// Cloudflare refuses a Worker larger than the plan's compressed limit, and it
// refuses at upload — the last step of a deploy, after the gate and the build.
// This account is on Workers Paid: production at fdc7fcc uploaded 5,962.79 KiB
// gzip, which the Free plan's 3 MB would not have accepted. Paid's limit is
// 10 MB compressed, read here conservatively as 10,000,000 bytes, and the
// budget is that minus 10%. DORMANT CODE COUNTS: the pg adapter and its
// Workers shim ship in production's bundle although production never selects
// them (§6.10, GAPS 36), and the cap does not care what runs.
//
//   node scripts/bundle-size.mjs [--env production]
//
// runs `wrangler deploy --dry-run` against the built `.open-next` and exits 1
// above the budget. `scripts/deploy.mjs` calls `measure` between the build
// and the upload, so a bundle over budget never reaches Cloudflare.
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Workers Paid: 10 MB compressed, as bytes. */
export const WORKERS_LIMIT_BYTES = 10_000_000
/** The limit minus 10%: the size a deploy refuses above. */
export const BUNDLE_BUDGET_BYTES = Math.floor(WORKERS_LIMIT_BYTES * 0.9)

/** The gzip size wrangler reports, in bytes, or null if it reported none. */
export function gzipBytesFrom(output) {
  const match = String(output)
    .replace(/\x1b\[[0-9;]*m/g, '')
    .match(/Total Upload:\s*[\d.]+\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/)
  return match ? Math.round(Number(match[1]) * 1024) : null
}

/** The verdict, as a line a log keeps and a reader can check. */
export function verdict(bytes, budget = BUNDLE_BUDGET_BYTES) {
  if (bytes === null)
    return {
      ok: false,
      line: 'BUNDLE SIZE UNKNOWN — wrangler reported no gzip size. NOT OK.',
    }
  const kib = (bytes / 1024).toFixed(2)
  const share = ((bytes / budget) * 100).toFixed(0)
  return bytes <= budget
    ? {
        ok: true,
        line: `bundle ${kib} KiB gzip — ${share}% of the ${(budget / 1024).toFixed(0)} KiB budget (Workers limit ${WORKERS_LIMIT_BYTES.toLocaleString('en-US')} bytes minus 10%). OK.`,
      }
    : {
        ok: false,
        line: `BUNDLE ${kib} KiB GZIP IS OVER THE ${(budget / 1024).toFixed(0)} KiB BUDGET (Workers limit minus 10%). NOT OK.`,
      }
}

/** Dry-run the built bundle through wrangler and return its gzip bytes. */
export function measure({ production = false } = {}) {
  const wrangler = fileURLToPath(
    new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
  )
  const outdir = mkdtempSync(join(tmpdir(), 'zebra-dry-'))
  try {
    const result = spawnSync(
      process.execPath,
      [
        wrangler,
        'deploy',
        '--dry-run',
        '--outdir',
        outdir,
        ...(production ? ['--env', 'production'] : []),
      ],
      { encoding: 'utf8' },
    )
    return gzipBytesFrom(`${result.stdout}\n${result.stderr}`)
  } finally {
    rmSync(outdir, { recursive: true, force: true })
  }
}

if (
  process.argv[1]?.endsWith(`scripts${sep}bundle-size.mjs`) ||
  process.argv[1]?.endsWith('scripts/bundle-size.mjs')
) {
  const { ok, line } = verdict(
    measure({ production: process.argv.includes('production') }),
  )
  console.log(line)
  process.exit(ok ? 0 : 1)
}

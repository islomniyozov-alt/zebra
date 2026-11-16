// ---------------------------------------------------------------------------
// ONE PRISMA CLIENT IN THE BUNDLE, AND ONE QUERY COMPILER (owner's ruling
// 2026-11-16, GAPS 36 / 44).
//
//   node scripts/prisma-copies.mjs      (after `opennextjs-cloudflare build`)
//
// At `bed6b3a` OpenNext's esbuild metafile held the generated client FIVE
// times — Turbopack compiled it into every chunk group that imported it — and
// the 3.68 MB query-compiler `.wasm` twice. `next.config.ts` now resolves it
// as the server external `@zebra/prisma-workerd`, which esbuild bundles once.
// This reads the built bundle and counts, so a change that brings the copies
// back is refused at deploy rather than found by a sweep's memory ceiling.
//
// WHAT IS COUNTED. A copy is a metafile input whose text carries the inline
// schema — every generated client embeds `schema.prisma` whole, and its first
// heading is the marker. A query compiler is a distinct `.wasm` the bundle
// imports. Both read from the artefact, not from the config that is supposed
// to produce them. An input that cannot be read is refused, not skipped:
// unreadable is not one.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The first heading of `prisma/schema.prisma`, embedded in every client. */
export const SCHEMA_MARK = 'TRUCKING TMS'
export const META = join(
  '.open-next',
  'server-functions',
  'default',
  'handler.mjs.meta.json',
)

/**
 * The count from a metafile and a reader of its inputs' text.
 * @param {{ outputs: Record<string, { inputs: Record<string, unknown>, imports: { path: string }[] }> }} meta
 * @param {(path: string) => string | null} read  null when unreadable
 */
export function countCopies(meta, read) {
  const outputs = Object.values(meta?.outputs ?? {})
  if (outputs.length !== 1)
    return { unreadable: `expected one output, found ${outputs.length}` }
  const [out] = outputs
  const holders = []
  const unreadable = []
  for (const path of Object.keys(out.inputs ?? {})) {
    // An esbuild plugin's virtual module (`namespace:path`) has no file: its
    // text is the plugin's, not an input anyone wrote. A drive letter is not
    // a namespace.
    if (/^[a-z][a-z-]+:/.test(path)) continue
    const text = read(path)
    if (text === null) unreadable.push(path)
    else if (text.includes(SCHEMA_MARK)) holders.push(path)
  }
  if (unreadable.length > 0)
    return {
      unreadable: `${unreadable.length} input(s) unreadable, first ${unreadable[0]}`,
    }
  const wasm = [
    ...new Set(
      (out.imports ?? [])
        .map((entry) => entry.path)
        .filter((path) => /\.wasm(\?module)?$/.test(path))
        .map((path) => path.replace(/\?module$/, '')),
    ),
  ]
  return { copies: holders.length, holders, wasm }
}

/** The verdict line, and whether the deploy may go on. */
export function copiesVerdict(count) {
  if (count.unreadable)
    return {
      ok: false,
      line: `PRISMA CLIENT COPIES UNREADABLE — ${count.unreadable}. NOT OK.`,
    }
  const ok = count.copies === 1 && count.wasm.length === 1
  return {
    ok,
    line: `prisma client: ${count.copies} copy(ies), ${count.wasm.length} query compiler(s) in the bundle — ${ok ? 'OK' : `NOT OK, one of each expected (${count.holders.join(', ') || 'none'})`}.`,
  }
}

/** The built bundle's count, read from disk. */
export function measureCopies(root = process.cwd()) {
  let meta
  try {
    meta = JSON.parse(readFileSync(join(root, META), 'utf8'))
  } catch (error) {
    return { unreadable: `${META}: ${error.message}` }
  }
  return countCopies(meta, (path) => {
    try {
      return readFileSync(join(root, path), 'utf8')
    } catch {
      return null
    }
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { ok, line } = copiesVerdict(measureCopies())
  console.log(line)
  process.exit(ok ? 0 : 1)
}

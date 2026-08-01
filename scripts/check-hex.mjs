import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// "No hex colour outside the token block" (§3, and a Phase 1 acceptance
// criterion). The token block is src/app/globals.css, and it is the only file
// permitted to contain one.
//
// Matches #rgb, #rrggbb and #rrggbbaa, and deliberately not a bare 3-8 char
// hex — `#z1` spacing tokens and cuid fragments would drown the signal.

const ROOT = 'src'
// The token block, plus the one file that cannot reach it: an email does not
// load globals.css, so `var(--color-ink)` there resolves to nothing. The
// exemption is by exact path and the file explains itself at the top.
const ALLOWED = new Set(['src/app/globals.css', 'src/lib/reset-email.ts'])
const SKIP = new Set(['generated'])
const HEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g

const offences = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full)
      continue
    }
    if (!/\.(ts|tsx|css|js|jsx|mjs)$/.test(entry)) continue

    const rel = relative('.', full).split(sep).join('/')
    if (ALLOWED.has(rel)) continue

    readFileSync(full, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const match of line.matchAll(HEX)) {
          offences.push(
            `${rel}:${index + 1}  ${match[0]}  ${line.trim().slice(0, 80)}`,
          )
        }
      })
  }
}

walk(ROOT)

if (offences.length > 0) {
  console.error('Hex colours outside the token block:\n')
  for (const offence of offences) console.error('  ' + offence)
  console.error(
    `\n${offences.length} found. Add a token to src/app/globals.css instead.`,
  )
  process.exit(1)
}

console.log('No hex colours outside src/app/globals.css.')

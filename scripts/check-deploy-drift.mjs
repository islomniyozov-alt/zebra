import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  classify,
  isMissingCredentials,
  looksLikeCommit,
  unreadableRefusal,
} from './deploy-drift-rules.mjs'

/** Wrangler's own entry, so nothing has to find a `.cmd`. A file path rather
 * than a package specifier — see the note in scripts/integration-gate.mjs. */
const WRANGLER_ENTRY = fileURLToPath(
  new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
)

// ---------------------------------------------------------------------------
// WHERE EACH WORKER STANDS AGAINST THIS COMMIT.
//
// A version id tells you a deploy happened. It does not tell you what is in
// it, and it certainly does not tell you that PRODUCTION is a commit behind
// while dev is current — which is how the Telegram share action came to pass
// every check, every screenshot and a live check, on the worker that carries
// no freight.
//
// `scripts/deploy.mjs` stamps the short commit on the version with
// `--message`. This reads it back for both workers and says the three things
// worth knowing: what is deployed, whether it matches HEAD, and — the part
// that matters — whether the commits in between touched `src/`.
//
// INFORMATIONAL, AND IT EXITS 0 EVEN WHEN IT SHOUTS. It runs inside
// `npm run check`, which runs constantly during development, where being
// ahead of production is the normal state of the world rather than a fault. A
// gate that fails on the normal state is a gate people learn to skip. It is
// loud when production trails a src/ change and quiet otherwise, and the
// loudness is the whole mechanism.
//
// ── BUT IT IS NOT QUIET ABOUT BEING UNABLE TO LOOK ───────────────────────
//
// THIS PARAGRAPH USED TO SAY the opposite: "quiet about NETWORK failure. No
// Cloudflare, no answer, no opinion — `npm run check` must work on a plane."
// That is overturned by the owner's ruling of 2026-09-18, and this is what
// bought it. On that day the check printed
//
//     dev         could not be read
//     production  could not be read
//     production  artifact   not reached (fetch failed)
//
// and exited 0, two minutes after a production deploy. Nothing was wrong with
// either worker; this machine could not reach Cloudflare. But an exit code of
// 0 from a drift check is read as "no drift" by every reader there is — a
// person skimming, `npm run check`, and CI — and NOTHING in that output stops
// it being read that way.
//
// That is the `cmd | tail` failure for the fifth time in this repository: a
// status that belongs to something other than the question asked. "I could
// not look" and "I looked and it is fine" are different answers, and only one
// of them may exit 0.
//
// So unreadability is now fatal and named, while DRIFT remains informational.
// Those are not in tension: being ahead of production is the normal state of
// development and gating on it produces a gate people learn to skip, whereas
// being unable to read production is never normal and never a thing to carry
// on past. The plane is the price, and it is the right price — a check that
// answers when it cannot see is worth less than no check.
// ---------------------------------------------------------------------------

const ENVIRONMENTS = [
  { label: 'dev', worker: 'zebra-dev', args: [] },
  {
    label: 'production',
    worker: 'zebra',
    args: ['--env', 'production'],
    // ---------------------------------------------------------------------
    // THE HOST IS THE APP. `zebratms.com` is the MAIL domain — Cloudflare
    // Email Routing for loads@zebratms.com — and serves no application. Four
    // probes died against it on 2026-08-20 before anybody checked, so it is
    // written down here rather than remembered.
    // ---------------------------------------------------------------------
    origin: 'https://zebra.tajikcargollc.workers.dev',
    // A route the running build must have, and one it must not. The control
    // is not decoration: without it a host that answers 200 to everything —
    // a parked page, a captive portal, a misrouted proxy — would read as a
    // healthy deploy.
    probePath: '/loads/import/trips',
    controlPath: '/loads/import/this-route-does-not-exist',
  },
]

/**
 * Ask the RUNNING deployment whether it is the build we think it is.
 *
 * WHY THIS EXISTS: everything above reads a LABEL. `deploy.mjs` stamps the
 * short commit with `--message`, and this file has said since it was written
 * that "a version id tells you a deploy happened; it does not tell you what is
 * in it". That caveat stood because nobody had the host. Now it is here, so
 * the check can look at the artifact instead of the sticker.
 *
 * NON-FATAL AND LOUD, deliberately. An unreachable host is a network fact, not
 * a wrong deploy, and a check that treats them the same becomes untrustworthy
 * in the other direction — people stop believing its alarms. So: silence when
 * it agrees, a shout when the artifact contradicts the label, and a quieter
 * note when it simply could not ask.
 */
async function probeArtifact(environment) {
  if (!environment.origin) return null

  const ask = async (path) => {
    const response = await fetch(`${environment.origin}${path}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    })
    return response.status
  }

  try {
    const [live, control] = await Promise.all([
      ask(environment.probePath),
      ask(environment.controlPath),
    ])
    return { live, control }
  } catch (error) {
    return { unreachable: String(error?.message ?? error) }
  }
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const wrangler = (args) => {
  // NODE ON WRANGLER'S OWN ENTRY. `shell: true` existed only to find `npx` on
  // Windows and it printed DEP0190 on every run; naming `npx.cmd` instead does
  // not work either, because Node refuses to spawn `.cmd` without a shell
  // (the 2024 argument-injection fix). Both dead ends were tried — the second
  // one silently turned this check into "could not be read" until the output
  // was actually looked at.
  const out = execFileSync(
    process.execPath,
    [WRANGLER_ENTRY, ...args, '--json'],
    // Wrangler writes its banner to stderr; only stdout is parsed. stderr is
    // CAPTURED rather than discarded, though — it used to be `'ignore'`, which
    // meant a failure arrived as a bare "Command failed: node …" with the one
    // sentence explaining why thrown away. Telling "no credentials configured"
    // apart from "the network is down" is the whole of the exemption below,
    // and it cannot be done from a message that was never kept.
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  return JSON.parse(out)
}

const head = git('rev-parse', '--short', 'HEAD')
console.log(`HEAD is ${head}`)

let productionTrailsSource = false
let artifactDisagrees = false

/**
 * Everything this run could not read, and why.
 *
 * Collected rather than thrown, so one unreachable worker does not hide the
 * other's answer: the report is still printed in full, and the exit code at
 * the bottom is what refuses.
 */
const unreadable = []

for (const environment of ENVIRONMENTS) {
  let deployedMessage = null
  let versionId = null
  /** Set when the serving version is a config edit rather than a deploy. */
  let configAtop = null

  try {
    // The DEPLOYED version, not merely the most recently uploaded one — an
    // upload that was never promoted is not what anybody is serving.
    const deployments = wrangler(['deployments', 'list', ...environment.args])

    // ORDER COMES FROM `deployments`, AND ONLY FROM THERE. `versions list`
    // returns no `created_on` at all, so sorting it compares "undefined" with
    // itself and leaves whatever order wrangler happened to return — which is
    // NOT newest-first: d09f001 (21:28) comes back after a230e61 (16:28).
    // Deployments do carry the timestamp, and carry the message too.
    const ordered = [...deployments].sort((a, b) =>
      String(b.created_on).localeCompare(String(a.created_on)),
    )
    const newest = ordered[0]
    versionId = newest?.versions?.[0]?.version_id ?? null

    const messageOf = (d) => d?.annotations?.['workers/message'] ?? null
    deployedMessage = messageOf(newest)

    if (!deployedMessage) {
      // Older deploys stamped the version rather than the deployment.
      const versions = wrangler(['versions', 'list', ...environment.args])
      deployedMessage =
        versions.find((candidate) => candidate.id === versionId)?.annotations?.[
          'workers/message'
        ] ?? null
    }

    // A SECRET EDITED IN THE DASHBOARD CREATES A DEPLOYMENT, and it serves.
    // Observed on production 2026-08-16: its message is absent entirely — not
    // merely a non-commit string. Either way nobody deployed it from a commit,
    // and the CODE running is the code of the last one somebody did.
    //
    // WITHOUT THIS THE CHECK GOES QUIET. An unresolvable message returns
    // `unstamped` or `unknown-commit`, both of which are silent, so a config
    // edit would hide a production that is behind on src/ — for as long as
    // nobody deploys again, which is exactly the window after somebody has
    // been fixing secrets by hand.
    if (!looksLikeCommit(deployedMessage)) {
      const realDeploy = ordered.find((d) => looksLikeCommit(messageOf(d)))
      configAtop = realDeploy ? messageOf(realDeploy) : null
      deployedMessage = configAtop
    }
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr : ''
    const message = error instanceof Error ? error.message : String(error)

    // THE ONE EXEMPTION, and it is configuration rather than breakage: CI
    // scopes CLOUDFLARE_API_TOKEN to the deploy step, so the gate has never
    // been able to read either worker. Not a verdict, and worded so it cannot
    // be mistaken for one — see `isMissingCredentials` for why this is the
    // only thing exempt and everything else fails closed.
    if (isMissingCredentials(`${stderr}\n${message}`)) {
      console.log(
        `  ${environment.label.padEnd(11)} not checked — no Cloudflare credentials here`,
      )
      continue
    }

    // NAMED, NOT COUNTED. The banner at the bottom repeats these, because the
    // line that says why is fifty lines above the exit code that refuses.
    // Wrangler colours its own stderr, and the escape codes came through into
    // the banner as `[33m▲ [43;33m[...`. A refusal nobody can read is most of
    // the way back to a refusal nobody notices.
    const why = (stderr.trim() || message)
      // eslint-disable-next-line no-control-regex
      .replace(/\[[0-9;]*m/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    unreadable.push({
      what: `${environment.label} version`,
      why: why.slice(0, 160),
    })
    console.log(`  ${environment.label.padEnd(11)} could not be read`)
    continue
  }

  const shortVersion = versionId ? versionId.slice(0, 8) : '(unknown)'

  if (!deployedMessage) {
    // Deployed before this stamping existed, or by something other than
    // scripts/deploy.mjs, or a config version with no deploy under it at all.
    // Not a fault, just unanswerable.
    console.log(
      `  ${environment.label.padEnd(11)} ${shortVersion}  commit unknown (deployed without a message)`,
    )
    continue
  }

  // Said before the verdict, because it changes what the verdict is ABOUT.
  // Said instead of the bare SHA, because it changes what the line is ABOUT:
  // this version was not deployed from a commit, and the commit named is the
  // code it is serving.
  const stamp = configAtop
    ? `config version atop the last real deploy ${configAtop}`
    : deployedMessage

  const commit = deployedMessage.replace('+dirty', '')
  const isKnownCommit = (() => {
    try {
      git('cat-file', '-e', `${commit}^{commit}`)
      return true
    } catch {
      return false
    }
  })()

  const changedSourceFiles = isKnownCommit
    ? git('diff', '--name-only', `${commit}..HEAD`, '--', 'src/')
        .split('\n')
        .filter(Boolean)
    : []

  const verdict = classify({
    label: environment.label,
    deployedMessage,
    head,
    isKnownCommit,
    changedSourceFiles,
  })
  const prefix = `  ${environment.label.padEnd(11)} ${shortVersion}  ${stamp}`

  if (verdict.state === 'current') {
    console.log(`${prefix} — matches HEAD`)
    continue
  }
  if (verdict.state === 'unknown-commit') {
    console.log(`${prefix} — not a commit in this clone`)
    continue
  }

  const behind = git('rev-list', '--count', `${commit}..HEAD`)
  console.log(
    `${prefix} — ${behind} commit(s) behind HEAD` +
      (changedSourceFiles.length > 0
        ? `, ${changedSourceFiles.length} file(s) under src/`
        : ', none under src/'),
  )

  if (verdict.loud) {
    productionTrailsSource = true
    for (const file of changedSourceFiles.slice(0, 8))
      console.log(`                  ${file}`)
    if (changedSourceFiles.length > 8)
      console.log(
        `                  ... and ${changedSourceFiles.length - 8} more`,
      )
  }
}

// ---------------------------------------------------------------------------
// AND NOW ASK THE RUNNING BUILD, not the label on it.
//
// After the loop rather than inside it: that loop exits through four different
// `continue`s, and a probe placed among them would run for some verdicts and
// not others — which is the sort of coverage gap that reads as "the probe
// agreed" when the probe never ran.
// ---------------------------------------------------------------------------
for (const environment of ENVIRONMENTS) {
  if (!environment.origin) continue
  const probe = await probeArtifact(environment)
  if (!probe) continue

  const where = `  ${environment.label.padEnd(11)} artifact`

  if (probe.unreachable) {
    // THIS USED TO SAY "NOT A FAILURE. A laptop on a plane, a DNS hiccup and a
    // wrong deploy are three different things, and only one of them is this
    // check's business." It is still true that they are three different
    // things. What was wrong was the conclusion: telling them apart is the
    // READER's business, and the reader cannot, because an exit code of 0
    // says the same word for "fine" as for "I never got an answer". Owner's
    // ruling, 2026-09-18 — see the header.
    unreadable.push({
      what: `${environment.label} artifact probe`,
      why: probe.unreachable,
    })
    console.log(`${where}   not reached (${probe.unreachable})`)
    continue
  }

  const { live, control } = probe
  const routeServed = live >= 200 && live < 400
  const controlRefused = control === 404

  if (routeServed && controlRefused) {
    console.log(
      `${where}   serving ${environment.probePath} (${live}), control 404 — the build has this route`,
    )
    continue
  }

  artifactDisagrees = true
  console.log(`${where}   DISAGREES WITH THE LABEL ABOVE`)
  console.log(
    `                  ${environment.probePath} -> ${live}, control -> ${control}`,
  )
  console.log(
    controlRefused
      ? '                  the deployed commit claims this route and the host does not serve it'
      : '                  the control did not 404, so the 200 above proves nothing',
  )
}

// ---------------------------------------------------------------------------
// AND WHAT THIS FILE STILL CANNOT TELL YOU.
//
// Everything above measures an INPUT: the version message `deploy.mjs` stamped,
// and whether a route answers 200. Neither is the response a dispatcher reads.
// On 2026-09-04 both were green while the screen rendered markup deleted ten
// commits earlier — see flag 93.
//
// `npm run verify:response` logs in and reads the body. It is not run from here
// because it needs credentials and a browser, and a check that cannot run
// unattended has no business inside `npm run check`. Printing the pointer costs
// one line and closes the gap between what this says and what it is read as.
// ---------------------------------------------------------------------------
console.log('')
console.log(
  '  A version id says a deploy happened, not what is in it. To read what a',
)
console.log(
  '  deployed route actually RETURNS:  VERIFY_LOAD=<number> npm run verify:response',
)

if (artifactDisagrees) {
  console.log('')
  console.log('  ' + '='.repeat(70))
  console.log('  THE RUNNING BUILD DOES NOT MATCH WHAT THE DEPLOYMENT CLAIMS.')
  console.log(
    '  A version message is a sticker somebody wrote. The lines above',
  )
  console.log('  asked the host itself and got a different answer.')
  console.log('  ' + '='.repeat(70))
}

if (productionTrailsSource) {
  console.log(
    '\n  ' +
      '='.repeat(70) +
      '\n  PRODUCTION IS BEHIND, AND THE DIFFERENCE INCLUDES APPLICATION CODE.' +
      '\n  If you meant to ship it:  npm run deploy:prod' +
      '\n  ' +
      '='.repeat(70),
  )
}

// ── THE ONE THING THIS REFUSES ON: NOT HAVING LOOKED ────────────────────
//
// Drift still exits 0 — being ahead of production is the normal state of
// development, and a gate that fails on the normal state is a gate people
// learn to skip. Being unable to READ production is not the normal state, and
// an exit code of 0 over it is indistinguishable from "no drift" to every
// reader there is. Owner's ruling, 2026-09-18.
const refusal = unreadableRefusal(unreadable)
for (const line of refusal.lines) console.log(line)

// Otherwise 0, even when it shouts. See the note at the top: it reports drift,
// it does not gate on it.
process.exit(refusal.exitCode)

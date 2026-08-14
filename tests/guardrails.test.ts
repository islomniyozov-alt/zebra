import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ESLint } from 'eslint'

// ---------------------------------------------------------------------------
// The guardrails that stop a route from looking correct while being wrong.
//
// Two of them exist, and this file tests the *enforcement*, not the config
// text — a lint rule nobody has watched fail is a lint rule that might be
// misconfigured. The type-level half (attribution being required) is enforced
// by `npm run typecheck` and needs no test; it cannot compile.
//
// Why the pair, rather than trusting review:
//
//   withCurrentOrg resolves the tenant, the permission check, and who is
//   acting. Reaching past it for withOrg gets you the first and silently
//   drops the other two — code that reads fine, commits fine, and attributes
//   the write to nobody. That is the same failure signature as the lazy
//   PrismaPromise bug: quiet, plausible, invisible until someone goes looking.
// ---------------------------------------------------------------------------

const eslint = new ESLint({ cwd: process.cwd() })

const lint = async (filePath: string, code: string) => {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false })
  return result?.messages ?? []
}

type LintMessage = Awaited<ReturnType<typeof lint>>[number]

const restricted = (messages: LintMessage[]) =>
  messages.filter((message) => message.ruleId === 'no-restricted-imports')

describe('routes cannot reach past withCurrentOrg', () => {
  it.each([
    [
      'withOrg',
      `import { withOrg } from '@/lib/tenancy'\nexport const x = withOrg`,
    ],
    [
      'runInOrg',
      `import { runInOrg } from '@/lib/tenancy'\nexport const x = runInOrg`,
    ],
    [
      'runAsUser',
      `import { runAsUser } from '@/lib/tenancy'\nexport const x = runAsUser`,
    ],
    ['prisma', `import { prisma } from '@/lib/db'\nexport const x = prisma`],
    [
      'createPrismaClient',
      `import { createPrismaClient } from '@/lib/db'\nexport const x = createPrismaClient`,
    ],
  ])('refuses %s under src/app', async (_name, code) => {
    const messages = await lint('src/app/loads/page.tsx', code)
    expect(restricted(messages)).toHaveLength(1)
    expect(restricted(messages)[0]).toBeDefined()
  })

  it('names the alternative in the error, so the fix is obvious', async () => {
    const messages = await lint(
      'src/app/loads/page.tsx',
      `import { withOrg } from '@/lib/tenancy'\nexport const x = withOrg`,
    )
    expect(restricted(messages)[0]?.message).toContain('withCurrentOrg')
  })

  it('catches a relative import too, not only the alias', async () => {
    const messages = await lint(
      'src/app/loads/page.tsx',
      `import { withOrg } from '../../lib/tenancy'\nexport const x = withOrg`,
    )
    expect(restricted(messages)).toHaveLength(1)
  })

  it('allows withCurrentOrg, which is the front door', async () => {
    const messages = await lint(
      'src/app/loads/page.tsx',
      `import { withCurrentOrg } from '@/lib/auth-context'\nexport const x = withCurrentOrg`,
    )
    expect(restricted(messages)).toEqual([])
  })

  it('leaves src/lib alone, where the primitives live', async () => {
    const messages = await lint(
      'src/lib/loads.ts',
      `import { withOrg } from '@/lib/tenancy'\nexport const x = withOrg`,
    )
    expect(restricted(messages)).toEqual([])
  })

  it('leaves tests alone', async () => {
    const messages = await lint(
      'tests/integration/something.test.ts',
      `import { runInOrg } from '@/lib/tenancy'\nexport const x = runInOrg`,
    )
    expect(restricted(messages)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// An asset's authority is a period, not a column.
//
// Same reasoning as above, one layer down: `Truck.companyId` and the open
// `AssetAssignment` are two representations of one fact and the schema does
// not make them agree, so a bare `update({ data: { companyId } })` moves an
// asset with no record that it moved. Every assertion below is paired with
// the shape it must NOT catch (standing rule 11) — a rule that fires on
// everything is as useless as one that fires on nothing.
// ---------------------------------------------------------------------------

const syntax = (messages: LintMessage[]) =>
  messages.filter((message) => message.ruleId === 'no-restricted-syntax')

describe("an asset's companyId cannot be written directly", () => {
  it.each([
    [
      'update',
      `export const move = async (tx: { truck: { update: (a: unknown) => unknown } }) =>
         tx.truck.update({ where: { id: 'x' }, data: { companyId: 'y' } })`,
    ],
    [
      'updateMany',
      `export const move = async (tx: { driver: { updateMany: (a: unknown) => unknown } }) =>
         tx.driver.updateMany({ where: { id: 'x' }, data: { companyId: 'y' } })`,
    ],
  ])('refuses a bare %s in a service', async (_name, code) => {
    expect(syntax(await lint('src/lib/somewhere.ts', code))).toHaveLength(1)
  })

  it('refuses it in a route too, not only in src/lib', async () => {
    const code = `export const move = async (tx: { trailer: { update: (a: unknown) => unknown } }) =>
      tx.trailer.update({ where: { id: 'x' }, data: { companyId: 'y' } })`
    expect(syntax(await lint('src/app/trucks/actions.ts', code))).toHaveLength(
      1,
    )
  })

  it('names transferAsset in the message, so the fix is obvious', async () => {
    const code = `export const move = async (tx: { truck: { update: (a: unknown) => unknown } }) =>
      tx.truck.update({ where: { id: 'x' }, data: { companyId: 'y' } })`
    const [message] = syntax(await lint('src/lib/somewhere.ts', code))
    expect(message?.message).toContain('transferAsset')
    expect(message?.message).toContain('period')
  })

  it('allows it in asset-transfer.ts, the one place it is honest', async () => {
    const code = `export const move = async (tx: { truck: { update: (a: unknown) => unknown } }) =>
      tx.truck.update({ where: { id: 'x' }, data: { companyId: 'y' } })`
    expect(syntax(await lint('src/lib/asset-transfer.ts', code))).toEqual([])
  })

  it('allows CREATING an asset with a companyId', async () => {
    // Creating an asset is not moving one. A rule that caught this would be a
    // rule everybody turns off.
    const code = `export const add = async (tx: { truck: { create: (a: unknown) => unknown } }) =>
      tx.truck.create({ data: { companyId: 'y', unitNumber: '101' } })`
    expect(syntax(await lint('src/lib/fleet.ts', code))).toEqual([])
  })

  it('allows updating an asset WITHOUT touching companyId', async () => {
    const code = `export const rename = async (tx: { truck: { update: (a: unknown) => unknown } }) =>
      tx.truck.update({ where: { id: 'x' }, data: { unitNumber: '102' } })`
    expect(syntax(await lint('src/lib/fleet.ts', code))).toEqual([])
  })
})

describe('the two gates, and which suite belongs in which', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>
  }
  const deployScript = readFileSync('scripts/deploy.mjs', 'utf8')

  // THE OWNER'S RULING, MADE UNFORGETTABLE. `npm run check` is what somebody
  // runs twenty times an afternoon; the moment it needs a database it stops
  // being that, and people stop running it.
  it('keeps `check` fast and database-free', () => {
    const check = packageJson.scripts['check'] ?? ''
    expect(check).toContain('test:check')
    expect(check).not.toContain('test:integration')

    const fast = packageJson.scripts['test:check'] ?? ''
    expect(fast).toContain('--project node')
    expect(fast).toContain('--project workers')
    expect(fast).not.toContain('integration')

    // And the integration project has exactly one launcher, which is what
    // makes a receipt describe the same run a deploy would have made.
    expect(packageJson.scripts['test:integration']).toContain(
      'scripts/integration-gate.mjs',
    )
  })

  // The other half. Flag 41 is why: four extraction tests were red for weeks
  // because the suite that exercises the shipped engine was in no gate at all,
  // and every gate anybody ran was green.
  it('makes the deploy refuse on a red integration suite', () => {
    // The launcher moved to scripts/integration-gate.mjs so that a run which
    // earns a receipt and a run which gates a deploy are the same run. The
    // RULING is unchanged and still asserted: deploy refuses on red.
    expect(deployScript).toContain('runIntegrationSuite()')
    expect(deployScript).toContain('the integration suite is red')
    // Before the build: a refusal that arrives after a thirty-second bundle is
    // one people learn to skip.
    expect(deployScript.indexOf('the integration suite is red')).toBeLessThan(
      deployScript.indexOf("run(['opennextjs-cloudflare', 'build'])"),
    )
  })

  // An escape hatch is fine; a silent one is not.
  it('and only lets it be skipped out loud', () => {
    expect(deployScript).toContain('--skip-integration')
    expect(deployScript).toContain('SKIPPING THE INTEGRATION SUITE')
  })
})

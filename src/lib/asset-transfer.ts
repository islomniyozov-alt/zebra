import type { TxClient } from './tenancy'
import { isUniqueViolation } from './reference'

// ---------------------------------------------------------------------------
// ASSET PERIODS — the only file allowed to write `companyId` on a truck,
// trailer or driver.
//
// That is enforced, not requested: `eslint.config.mjs` bans
// `update({ data: { companyId } })` everywhere else in the codebase, and this
// file is the single exemption. The rule exists because `Truck.companyId` and
// the open `AssetAssignment` are two representations of one fact and nothing
// in the schema makes them agree — flagged as Phase 2 §16.4. One line of
// `data: { companyId }` in a route or a service would desynchronise them
// silently, and the desynchronisation only surfaces months later when somebody
// asks under whose MC number a truck was running on the day of an accident.
//
// The backstop under the lint rule is `findAuthorityDrift`, which asks the
// database the same question and must return zero rows — the lint rule catches
// the code somebody writes, the drift check catches the row somebody writes by
// hand. A guardrail nobody has watched fail might be misconfigured (standing
// rule 8), so the drift check runs in `npm run check` (tests/integrity.test.ts),
// the lint rule has a test that watches it fire (tests/guardrails.test.ts), and
// the drift check has one that damages a row on purpose to confirm it notices
// (tests/integration/fleet.test.ts).
// ---------------------------------------------------------------------------

export type FleetKind = 'truck' | 'trailer' | 'driver'

export type AssetLink =
  | { truckId: string }
  | { trailerId: string }
  | { driverId: string }

export function linkFor(kind: FleetKind, id: string): AssetLink {
  if (kind === 'truck') return { truckId: id }
  if (kind === 'trailer') return { trailerId: id }
  return { driverId: id }
}

/**
 * Open the first assignment period, at the moment the asset is created.
 *
 * Found by the Step 2 walkthrough: without this, a truck added through the
 * interface had a `companyId` and NO period, so `currentAuthority` returned
 * null and the detail screen said "no open period recorded" for a truck that
 * plainly worked for somebody. §8 makes the open `AssetAssignment` the
 * authority of record for dispatch conflicts, and an asset that had never been
 * transferred would have no authority at all by that reading.
 *
 * The history has to start where the asset does.
 *
 * `effectiveFrom` DEFAULTS TO NOW AND THE MIGRATION SEEDS PASS A STATED DATE.
 * An asset created through the interface starts its history the moment
 * somebody adds it, which is true. A fleet imported from Datatruck did NOT
 * start working the afternoon the import ran, and dating 49 trucks by when a
 * script happened to execute makes "which authority ran unit 105 in August"
 * answer with the import date forever. Same reasoning as the driver pay
 * rules' fixed `effectiveFrom` — a stated date, not the seed-run date.
 */
export async function openFirstPeriod(
  tx: TxClient,
  organizationId: string,
  companyId: string,
  link: AssetLink,
  byUserId?: string | null,
  effectiveFrom?: Date,
): Promise<void> {
  await tx.assetAssignment.create({
    data: {
      organizationId,
      companyId,
      ...link,
      createdByUserId: byUserId ?? null,
      // Omitted rather than passed as undefined-or-now, so the schema's own
      // `@default(now())` stays the single answer for the interface path.
      ...(effectiveFrom ? { effectiveFrom } : {}),
    },
  })
}

/** Close whatever period is open, if one is. Idempotent. */
export async function closeOpenPeriod(
  tx: TxClient,
  kind: FleetKind,
  id: string,
  at: Date,
): Promise<void> {
  await tx.assetAssignment.updateMany({
    where: { ...linkFor(kind, id), effectiveTo: null },
    data: { effectiveTo: at },
  })
}

/** The authority an asset is currently working under, from the period log. */
export async function currentAuthority(
  tx: TxClient,
  kind: FleetKind,
  id: string,
): Promise<{ companyId: string; since: Date } | null> {
  const open = await tx.assetAssignment.findFirst({
    where: { ...linkFor(kind, id), effectiveTo: null },
    select: { companyId: true, effectiveFrom: true },
  })
  return open ? { companyId: open.companyId, since: open.effectiveFrom } : null
}

export type TransferFailure = 'not_found' | 'same_authority' | 'double_open'

export class TransferError extends Error {
  readonly code: TransferFailure
  constructor(code: TransferFailure) {
    super(code)
    this.name = 'TransferError'
    this.code = code
  }
}

export interface TransferResult {
  closedAssignmentId: string | null
  openedAssignmentId: string
  fromCompanyId: string
  toCompanyId: string
}

/**
 * Move a truck, trailer or driver to another operating authority.
 *
 * The whole reason `AssetAssignment` exists. An authority is not a property of
 * an asset that can simply be overwritten — it is a period with a beginning
 * and an end, because six months from now somebody has to answer "under whose
 * MC number was this truck running on the day of the accident", and the answer
 * has to be a row rather than a memory.
 *
 * So one transaction does three things, and none of them is optional:
 *
 *   1. closes the open period (`effectiveTo` = now);
 *   2. opens a new one under the target authority;
 *   3. moves the asset's own `companyId` to match.
 *
 * Step 3 is the one the lint rule protects. It is correct here and nowhere
 * else, because here it happens alongside 1 and 2.
 *
 * A double-open is refused by a partial unique index in Postgres, not by the
 * check above it. The check is for the message; the index is for the truth.
 */
export async function transferAsset(
  tx: TxClient,
  organizationId: string,
  kind: FleetKind,
  id: string,
  toCompanyId: string,
  options: { reason?: string | null; byUserId?: string | null } = {},
): Promise<TransferResult> {
  const asset =
    kind === 'truck'
      ? await tx.truck.findUnique({
          where: { id },
          select: { id: true, companyId: true, deletedAt: true },
        })
      : kind === 'trailer'
        ? await tx.trailer.findUnique({
            where: { id },
            select: { id: true, companyId: true, deletedAt: true },
          })
        : await tx.driver.findUnique({
            where: { id },
            select: { id: true, companyId: true, deletedAt: true },
          })

  if (!asset || asset.deletedAt) throw new TransferError('not_found')
  if (asset.companyId === toCompanyId) {
    // Not an error the database would catch, and worth refusing: a no-op
    // transfer that reported success would leave a closed period and an
    // identical open one, which reads as a real move to anyone auditing it.
    throw new TransferError('same_authority')
  }

  const at = new Date()
  const link = linkFor(kind, id)

  const open = await tx.assetAssignment.findFirst({
    where: { ...link, effectiveTo: null },
    select: { id: true },
  })

  if (open) {
    await tx.assetAssignment.update({
      where: { id: open.id },
      data: { effectiveTo: at },
    })
  }

  let opened
  try {
    opened = await tx.assetAssignment.create({
      data: {
        organizationId,
        companyId: toCompanyId,
        ...link,
        effectiveFrom: at,
        reason: options.reason ?? null,
        createdByUserId: options.byUserId ?? null,
      },
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new TransferError('double_open')
    throw error
  }

  // The one legitimate `companyId` write in the codebase. No inline disable
  // needed — this whole FILE is the exemption, which is the point: the rule
  // is off here because there is nothing else here.
  if (kind === 'truck') {
    await tx.truck.update({ where: { id }, data: { companyId: toCompanyId } })
  } else if (kind === 'trailer') {
    await tx.trailer.update({ where: { id }, data: { companyId: toCompanyId } })
  } else {
    await tx.driver.update({ where: { id }, data: { companyId: toCompanyId } })
  }

  return {
    closedAssignmentId: open?.id ?? null,
    openedAssignmentId: opened.id,
    fromCompanyId: asset.companyId,
    toCompanyId,
  }
}

export interface AuthorityDrift {
  kind: FleetKind
  assetId: string
  assetCompanyId: string
  openPeriodCompanyId: string | null
}

/**
 * Every asset whose own `companyId` disagrees with its open period.
 *
 * The backstop under the lint rule, and the answer to "how would we know". It
 * must return an empty array. Anything in it is an asset whose authority was
 * changed without writing history — which means the question this whole
 * mechanism exists to answer now has two different answers.
 *
 * Assets with no open period at all are drift too: since Step 3 every asset
 * gets one at creation, so a missing period means somebody wrote a row around
 * the service layer.
 */
export async function findAuthorityDrift(
  tx: TxClient,
): Promise<AuthorityDrift[]> {
  const drift: AuthorityDrift[] = []

  const kinds: Array<{
    kind: FleetKind
    rows: Array<{ id: string; companyId: string }>
  }> = [
    {
      kind: 'truck',
      rows: await tx.truck.findMany({
        // ── A TRUCK THAT LEFT THE FLEET IS NOT DRIFT ────────────────────
        //
        // The same narrowing inactive drivers got on 2026-09-09, and the same
        // argument: this check asks "which authority currently runs this
        // asset", and for a truck that was sold or taken out of service there
        // is no answer. The all-trucks import adds 53 of them, each with a
        // companyId and no open period — an OPEN period would be the lie that
        // made the check pass, claiming a sold truck currently runs for a
        // carrier.
        //
        // OUT_OF_SERVICE AND SOLD ONLY. A truck in MAINTENANCE is coming back
        // and still belongs to an authority; excluding it would hide real
        // drift on a live asset.
        where: {
          deletedAt: null,
          status: { notIn: ['OUT_OF_SERVICE', 'SOLD'] },
        },
        select: { id: true, companyId: true },
      }),
    },
    {
      kind: 'trailer',
      rows: await tx.trailer.findMany({
        where: { deletedAt: null },
        select: { id: true, companyId: true },
      }),
    },
    {
      kind: 'driver',
      rows: await tx.driver.findMany({
        // ── INACTIVE DRIVERS ARE NOT DRIFT ────────────────────────────────
        //
        // Added 2026-09-09 with the terminated-driver import. This check asks
        // "which authority currently runs this asset, and does the asset's own
        // column agree" — and for somebody who left the company in January the
        // question has no answer. An OPEN `AssetAssignment` for them would be
        // the lie that made the check pass: it would claim 69 people who no
        // longer work here currently drive for a carrier, and `currentAuthority`
        // would repeat it on every screen that asks.
        //
        // A CLOSED period would be the honest record and the export cannot
        // support one — it gives a hire date on 6 of 69 rows, so every other
        // period would start on a date this system invented.
        //
        // THE NARROWING IS REAL AND SO IS ITS COST: a live driver wrongly set
        // INACTIVE now hides its own drift. That is the trade, taken because
        // the alternative writes false history into the table whose entire job
        // is being true about the past.
        where: { deletedAt: null, status: { not: 'INACTIVE' } },
        select: { id: true, companyId: true },
      }),
    },
  ]

  // ── ONE QUERY FOR EVERY OPEN PERIOD, NOT ONE PER ASSET ──────────────────
  //
  // This used to call `currentAuthority` in the loop below, which is a query
  // per asset, serially, INSIDE a 5-second interactive transaction. That is
  // fine against the handful of demo rows it was written against and it stops
  // working at the size of the real fleet: seeding the 49 Datatruck trucks
  // took the run past the timeout, and the failure was not "drift found" but
  // `A query cannot be executed on an expired transaction` — a backstop that
  // reports an infrastructure error instead of an answer.
  //
  // THE CHECK IS UNCHANGED. Same assets, same comparison, same definition of
  // drift including "no open period at all"; only the fetching is different.
  // `currentAuthority` stays as it is — it is the right shape for one asset on
  // one screen, and this is the only caller that wanted all of them.
  const openPeriods = await tx.assetAssignment.findMany({
    where: { effectiveTo: null },
    select: { companyId: true, truckId: true, trailerId: true, driverId: true },
  })

  const openBy = new Map<string, string>()
  for (const period of openPeriods) {
    const id = period.truckId ?? period.trailerId ?? period.driverId
    if (id) openBy.set(id, period.companyId)
  }

  for (const { kind, rows } of kinds) {
    for (const row of rows) {
      const openCompanyId = openBy.get(row.id) ?? null
      if (openCompanyId !== row.companyId) {
        drift.push({
          kind,
          assetId: row.id,
          assetCompanyId: row.companyId,
          openPeriodCompanyId: openCompanyId,
        })
      }
    }
  }

  return drift
}

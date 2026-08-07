import type { DocumentType, Prisma } from '@/generated/prisma/client'
import { TARGETS, type TargetEntity } from './documents'
import type { AuthorizedSession, Resource } from './permissions'
import { can } from './permissions'
import type { CompanyScopeFilter, TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// THE DOCUMENTS BROWSER (Phase 4 §3 step 6).
//
// §2.7 assigned this screen to Phase 4 with an accurate description of what was
// missing: "the pipeline exists — upload, confirm, download, all on the load
// screen — and what is missing is the reading room over it."
//
// PERMISSION-AWARE, AND THAT IS THE WHOLE DIFFICULTY. Every other list in this
// application covers one kind of thing and asks one permission. This one covers
// eleven, and a settlement PDF sitting next to a rate confirmation is a
// dispatcher reading driver pay. So a row is only listed when the session may
// read THE THING IT HANGS OFF — decided by `permissions.ts` per entity, never
// inline, and applied as a WHERE clause rather than a filter over fetched rows
// so the counts and the page agree.
//
// The tenant is Postgres's business (RLS) and the authority is
// `companyScopeFilter`'s. This is the third wall and it is about KIND, not row.
// ---------------------------------------------------------------------------

/**
 * Which permission resource governs each place a document can hang.
 *
 * Keyed off `TARGETS` so the two lists cannot drift: a new attachment target
 * that nobody maps here fails the guard test rather than quietly becoming
 * visible to everyone.
 */
export const ENTITY_RESOURCE: Record<TargetEntity, Resource> = {
  load: 'load',
  truck: 'truck',
  trailer: 'trailer',
  driver: 'driver',
  customer: 'customer',
  invoice: 'invoice',
  // A settlement PDF is driver pay in a wrapper. Gated by the settlement
  // resource, which a DISPATCHER does not hold.
  settlement: 'settlement',
  expense: 'expense',
  fuelTransaction: 'fuel',
  maintenance: 'maintenance',
  complianceItem: 'compliance',
  inspection: 'inspection',
  claim: 'claim',
  dataQs: 'dataQs',
}

export const BROWSER_ENTITIES = Object.keys(ENTITY_RESOURCE) as TargetEntity[]

export interface BrowserRow {
  id: string
  companyId: string
  companyName: string
  filename: string
  type: DocumentType
  sizeBytes: number
  uploadedAt: Date
  uploadedByName: string | null
  /** Which kind of thing it hangs off, and a link to it. */
  entity: TargetEntity | null
  entityLabel: string | null
  entityHref: string | null
}

const SELECT = {
  id: true,
  companyId: true,
  filename: true,
  type: true,
  sizeBytes: true,
  uploadedAt: true,
  company: { select: { name: true } },
  uploadedBy: { select: { name: true } },
  load: { select: { id: true, loadNumber: true } },
  truck: { select: { id: true, unitNumber: true } },
  trailer: { select: { id: true, unitNumber: true } },
  driver: { select: { id: true, firstName: true, lastName: true } },
  customer: { select: { id: true, name: true } },
  invoice: { select: { id: true, invoiceNumber: true } },
  settlement: { select: { id: true, settlementNumber: true } },
  maintenance: { select: { id: true, servicedAt: true } },
  complianceItem: { select: { id: true, type: true } },
  inspection: { select: { id: true, inspectedAt: true, truckId: true } },
  claim: { select: { id: true, claimNumber: true } },
  dataQs: { select: { id: true, inspectionId: true } },
  expenseId: true,
  fuelTransactionId: true,
} satisfies Prisma.DocumentSelect

type Stored = Prisma.DocumentGetPayload<{ select: typeof SELECT }>

/** What a document hangs off, as a label and a link. */
function subjectOf(row: Stored): {
  entity: TargetEntity | null
  label: string | null
  href: string | null
} {
  if (row.load) {
    return {
      entity: 'load',
      label: row.load.loadNumber,
      href: `/loads/${row.load.id}`,
    }
  }
  if (row.truck) {
    return {
      entity: 'truck',
      label: row.truck.unitNumber,
      href: `/trucks/${row.truck.id}`,
    }
  }
  if (row.trailer) {
    return {
      entity: 'trailer',
      label: row.trailer.unitNumber,
      href: `/trailers/${row.trailer.id}`,
    }
  }
  if (row.driver) {
    return {
      entity: 'driver',
      label: `${row.driver.firstName} ${row.driver.lastName}`.trim(),
      href: `/drivers/${row.driver.id}`,
    }
  }
  if (row.customer) {
    return {
      entity: 'customer',
      label: row.customer.name,
      href: `/brokers/${row.customer.id}`,
    }
  }
  if (row.invoice) {
    return {
      entity: 'invoice',
      label: row.invoice.invoiceNumber,
      href: `/invoices/${row.invoice.id}`,
    }
  }
  if (row.settlement) {
    return {
      entity: 'settlement',
      label: row.settlement.settlementNumber,
      href: `/settlements/${row.settlement.id}`,
    }
  }
  if (row.maintenance) {
    // A work order has no screen of its own — it lives on its asset, and the
    // browser is honest about that rather than linking to a route that would
    // 404. Phase 5 can give it one.
    return {
      entity: 'maintenance',
      label: row.maintenance.servicedAt.toISOString().slice(0, 10),
      href: null,
    }
  }
  if (row.complianceItem) {
    return {
      entity: 'complianceItem',
      label: row.complianceItem.type,
      href: null,
    }
  }
  if (row.inspection) {
    return {
      entity: 'inspection',
      label: row.inspection.inspectedAt.toISOString().slice(0, 10),
      href: `/safety/inspections/${row.inspection.id}`,
    }
  }
  if (row.claim) {
    return {
      entity: 'claim',
      label: row.claim.claimNumber ?? '—',
      href: `/safety/claims/${row.claim.id}`,
    }
  }
  if (row.dataQs) {
    return {
      entity: 'dataQs',
      label: '—',
      href: `/safety/inspections/${row.dataQs.inspectionId}`,
    }
  }
  // Expense and fuel have no screens at all yet (§2.6 moved both to Phase 5),
  // so their documents are named by kind and link nowhere.
  if (row.expenseId) return { entity: 'expense', label: '—', href: null }
  if (row.fuelTransactionId) {
    return { entity: 'fuelTransaction', label: '—', href: null }
  }
  return { entity: null, label: null, href: null }
}

export function shapeDocuments(rows: readonly Stored[]): BrowserRow[] {
  return rows.map((row) => {
    const subject = subjectOf(row)
    return {
      id: row.id,
      companyId: row.companyId,
      companyName: row.company.name,
      filename: row.filename,
      type: row.type,
      sizeBytes: row.sizeBytes,
      uploadedAt: row.uploadedAt,
      uploadedByName: row.uploadedBy?.name ?? null,
      entity: subject.entity,
      entityLabel: subject.label,
      entityHref: subject.href,
    }
  })
}

/** The entity kinds this session may see documents for. */
export function readableEntities(
  session: AuthorizedSession | null | undefined,
): TargetEntity[] {
  return BROWSER_ENTITIES.filter((entity) =>
    can(session, 'read', ENTITY_RESOURCE[entity]),
  )
}

/**
 * The WHERE clause that hides what the role may not read.
 *
 * An OR over the columns of the entities they CAN read — so a document hanging
 * off something they cannot read is not in the result set at all, rather than
 * fetched and filtered. A row attached to nothing is excluded too: it belongs
 * to no screen, so no permission covers it.
 */
export function permissionWhere(
  session: AuthorizedSession | null | undefined,
): Prisma.DocumentWhereInput {
  const allowed = readableEntities(session)
  if (allowed.length === 0) {
    // A `where` that matches nothing, written explicitly. Returning `{}` here
    // would list everything, which is the failure mode this function exists to
    // prevent.
    return { id: { equals: '' } }
  }

  return {
    OR: allowed.map((entity) => ({
      [TARGETS[entity].column]: { not: null },
    })),
  }
}

/**
 * Which entity one document hangs off, for the download endpoint.
 *
 * THE LISTING AND THE DOWNLOAD MUST ASK THE SAME QUESTION. Hiding a settlement
 * PDF from the browser while `/api/documents/{id}/download-url` still mints a
 * URL for anyone holding `document:read` would be the CSS-hiding bug in a
 * different coat — a dispatcher with an id would read driver pay.
 *
 * Returns null when the document is not in this tenant (RLS removed it) or
 * hangs off nothing. Both are a 404 to the caller; the difference is not theirs
 * to learn.
 */
export async function entityOfDocument(
  tx: TxClient,
  id: string,
): Promise<TargetEntity | null> {
  const row = await tx.document.findFirst({
    where: { id, deletedAt: null },
    select: Object.fromEntries(
      BROWSER_ENTITIES.map((entity) => [TARGETS[entity].column, true]),
    ) as Prisma.DocumentSelect,
  })
  if (!row) return null

  const found = BROWSER_ENTITIES.find(
    (entity) =>
      (row as Record<string, unknown>)[TARGETS[entity].column] !== null,
  )
  return found ?? null
}

export interface BrowserQuery {
  type?: DocumentType
  entity?: TargetEntity
  /** ISO dates, inclusive. */
  from?: string
  to?: string
}

export async function browseDocuments(
  tx: TxClient,
  session: AuthorizedSession,
  scope: CompanyScopeFilter = {},
  query: BrowserQuery = {},
): Promise<BrowserRow[]> {
  // A filter the session may not use is not an error and not an empty list —
  // it is simply not applied, because the permission clause below already
  // excludes those rows and would produce the same answer either way.
  const allowed = readableEntities(session)
  const entity =
    query.entity && allowed.includes(query.entity) ? query.entity : undefined

  const rows = await tx.document.findMany({
    where: {
      ...scope,
      deletedAt: null,
      ...permissionWhere(session),
      ...(query.type ? { type: query.type } : {}),
      ...(entity ? { [TARGETS[entity].column]: { not: null } } : {}),
      ...(query.from || query.to
        ? {
            uploadedAt: {
              ...(query.from
                ? { gte: new Date(`${query.from}T00:00:00Z`) }
                : {}),
              // Inclusive of the whole day somebody typed, which is what "to
              // the 8th" means to a person and not what `lte: 2026-08-08T00:00`
              // means to Postgres.
              ...(query.to
                ? { lte: new Date(`${query.to}T23:59:59.999Z`) }
                : {}),
            },
          }
        : {}),
    },
    orderBy: { uploadedAt: 'desc' },
    take: 300,
    select: SELECT,
  })

  return shapeDocuments(rows)
}

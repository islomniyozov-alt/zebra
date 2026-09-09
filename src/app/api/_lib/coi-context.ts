import { withCurrentOrg } from '@/lib/auth-context'
import { readableVins, type CoiAuthority, type CoiTruck } from '@/lib/coi'
import { companyIdScopeFilter, companyScopeFilter } from '@/lib/tenancy'
import type { ExtractedCoi } from '@/lib/extraction/coi-shape'

// ---------------------------------------------------------------------------
// WHAT THE SUBJECT RULE NEEDS FROM THE DATABASE, LOADED ONCE.
//
// ── WHY THIS IS A SHARED FILE AND NOT A COPY IN EACH ROUTE ───────────────
//
// Two routes read certificates — `/api/coi/read` and `/api/compliance/read` —
// and both must ask the same question of the same rows. A second copy of "the
// authorities, plus the trucks matching these VINs" is a second definition of
// what the subject rule can see, and the two would diverge on the day one of
// them learns about soft-deleted trucks.
//
// ── LOADED AFTER THE READ, ON PURPOSE ────────────────────────────────────
//
// The truck lookup is BY THE VINs THE CERTIFICATE NAMED, so it cannot happen
// before the certificate is read. That is the right way round anyway: a
// certificate naming no vehicles costs no truck query, and one naming two
// costs a lookup of two — rather than every read dragging the fleet across the
// wire on the chance it might be an owner-operator's.
//
// EVERY QUERY IS TENANT-SCOPED THROUGH `withCurrentOrg`. The ids never come
// from the browser here — they come off the document — but the ROWS still have
// to be ones this caller may see, or a certificate would become a way to
// discover another organization's fleet by guessing VINs.
// ---------------------------------------------------------------------------

export interface CoiContext {
  authorities: CoiAuthority[]
  trucks: CoiTruck[]
}

export async function loadCoiContext(
  fields: ExtractedCoi,
): Promise<CoiContext> {
  const authorities = await withCurrentOrg('read', 'company', async (tx, ctx) =>
    tx.company.findMany({
      where: {
        // RETIRED AUTHORITIES ARE STILL AUTHORITIES HERE. A certificate for a
        // carrier that stopped hauling is history worth filing correctly, and
        // the alternative — falling through to "ask" — would put a live
        // carrier's name in front of somebody for a policy that is not theirs.
        ...companyIdScopeFilter(ctx.companyScopes),
      },
      select: { id: true, name: true, mcNumber: true, dotNumber: true },
      orderBy: { name: 'asc' },
    }),
  )

  const vins = readableVins(fields)
  if (vins.length === 0) return { authorities, trucks: [] }

  const trucks = await withCurrentOrg('read', 'truck', async (tx, ctx) =>
    tx.truck.findMany({
      where: {
        ...companyScopeFilter(ctx.companyScopes),
        deletedAt: null,
        vin: { in: vins, mode: 'insensitive' },
      },
      select: {
        id: true,
        unitNumber: true,
        vin: true,
        companyId: true,
        company: { select: { name: true } },
      },
    }),
  )

  return {
    authorities,
    trucks: trucks.map((row) => ({
      id: row.id,
      unitNumber: row.unitNumber,
      vin: row.vin,
      companyId: row.companyId,
      companyName: row.company.name,
    })),
  }
}

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldPath } from 'firebase-admin/firestore';
import { requireSuperAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';
import { mergeContactsWithUsers } from '@/lib/crm-merge';
import { isCrmTypeFilter, matchesCrmFilters } from '@/lib/crm-filter';
import { isNewsletterFilter } from '@/lib/newsletter-consent';
import {
  contactToCrmExportRecord,
  crmCsvStream,
  crmExportFilename,
  crmExportRowCap,
  exportTenantIdOf,
} from '@/lib/crm-export';
import { sortByString } from '@/utils/query-helpers';
import type { Contact } from '@/hooks/queries/useCRMQueries';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Same page size as `EXPORT_PAGE` in member-export.ts. Not the CRM's 1,000 cap. */
const EXPORT_PAGE = 400;

const TENANT_CHUNK = 100;

interface PagedDoc {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Every document in a collection, ordered by document id, in pages of
 * {@link EXPORT_PAGE}. An unordered or single-page read would silently drop
 * everyone past the first page — the list's ceiling, which this export exists
 * to not share.
 */
async function pageCollection(name: string): Promise<PagedDoc[]> {
  const rows: PagedDoc[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  const base = adminDb.collection(name).orderBy(FieldPath.documentId());
  for (;;) {
    const page = cursor ? base.startAfter(cursor).limit(EXPORT_PAGE) : base.limit(EXPORT_PAGE);
    const snap = await page.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      rows.push({ id: doc.id, data: (doc.data() ?? {}) as Record<string, unknown> });
    }
    if (snap.size < EXPORT_PAGE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

function isPlatformOwned(tenantId: unknown): boolean {
  return tenantId == null || tenantId === '' || tenantId === PLATFORM_TENANT_ID;
}

async function churchNames(tenantIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(tenantIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += TENANT_CHUNK) {
    const refs = unique.slice(i, i + TENANT_CHUNK).map(id => adminDb.collection('tenants').doc(id));
    const snaps = await adminDb.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() || {};
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (name) names.set(snap.id, name);
    }
  }
  return names;
}

function churchOf(tenantId: string | undefined, names: Map<string, string>): string {
  if (!tenantId) return '';
  const named = names.get(tenantId);
  if (named) return named;
  if (tenantId === PLATFORM_TENANT_ID) return 'Harvest';
  return '';
}

export async function GET(request: NextRequest) {
  const userOrErr = await requireSuperAdmin(request);
  if (userOrErr instanceof Response) return userOrErr;

  const newsletter = request.nextUrl.searchParams.get('newsletter');
  const type = request.nextUrl.searchParams.get('type');
  const q = request.nextUrl.searchParams.get('q') ?? '';

  if (!isNewsletterFilter(newsletter)) {
    return NextResponse.json(
      { error: 'newsletter must be one of all, in, out, unknown' },
      { status: 400 },
    );
  }
  if (!isCrmTypeFilter(type)) {
    return NextResponse.json(
      { error: 'type must be one of all, member, donor, both' },
      { status: 400 },
    );
  }

  try {
    const [userDocs, contactDocs] = await Promise.all([
      pageCollection('users'),
      pageCollection('contacts'),
    ]);

    const contactRows = contactDocs
      .filter(doc => isPlatformOwned(doc.data.tenantId))
      .map(doc => ({ id: doc.id, ...doc.data }) as Contact);

    const merged = mergeContactsWithUsers(
      contactRows,
      userDocs.map(doc => ({ id: doc.id, data: doc.data })),
      PLATFORM_TENANT_ID,
    );

    const filtered = sortByString(
      merged.filter(contact => matchesCrmFilters(contact, { search: q, type, newsletter })),
      'lastName',
      'asc',
    );

    const cap = crmExportRowCap();
    if (filtered.length > cap) {
      return NextResponse.json(
        {
          error: `This export matches ${filtered.length} people, which is over the limit of ${cap}. Narrow the newsletter, type or search filters and try again. No file was created.`,
        },
        { status: 413 },
      );
    }

    const names = await churchNames(filtered.map(exportTenantIdOf));
    const records = filtered.map(contact => contactToCrmExportRecord(contact, churchOf(exportTenantIdOf(contact), names)));
    const filename = crmExportFilename(newsletter);

    return new NextResponse(crmCsvStream(records), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[crm-export] failed to read contacts', err);
    return NextResponse.json(
      { error: 'Could not read contacts for the export. Nothing was downloaded.' },
      { status: 500 },
    );
  }
}

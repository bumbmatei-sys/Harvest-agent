/**
 * THE-331 · The record types an attach picker may offer, and how they load.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this module is pure ─────────────────────────────────────────────────
 *
 * The loaders used to live inline in `AdminCommunity.tsx`, inside the picker's
 * own `useEffect`. Two screens attach records — the community composer and
 * `UserMessages` — so the shapes and the four labels were on their way to
 * being duplicated. They live here instead: no JSX, no React, so the category
 * list and the recents rule can be asserted without mounting a surface.
 *
 * 🔴 THE FOUR TYPES AND THEIR LABELS ARE FROZEN. `campaigns` reads
 * "Fundraising" on screen and nowhere reads "Campaigns"; the founder named
 * these four and a fifth is not a widening this module may make quietly.
 *
 * ── A failed read is a FAILURE ──────────────────────────────────────────────
 *
 * ⚠️ The old loader answered a rejected Firestore query with `setItems([])`,
 * so a permission error and an empty church rendered the SAME sentence — "No
 * docs yet". A church with 400 contacts was told it had none. Every loader
 * here returns a discriminated `AttachLoad`, so the caller cannot render an
 * error as emptiness without ignoring a field it has to read to get the rows.
 */

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '@/firebase';

/** The four record types. Frozen: see the header. */
export const ATTACH_CATEGORY_IDS = ['docs', 'contacts', 'campaigns', 'forms'] as const;

export type AttachCategoryId = (typeof ATTACH_CATEGORY_IDS)[number];

/**
 * The label each category shows. 🔴 `campaigns` → "Fundraising" is deliberate
 * and is the one place the id and the label disagree.
 */
export const ATTACH_CATEGORY_LABELS: Readonly<Record<AttachCategoryId, string>> = Object.freeze({
  docs: 'Notes & Docs',
  contacts: 'Contacts',
  campaigns: 'Fundraising',
  forms: 'Forms',
});

/** The record type stored on an attachment, per category. */
export const ATTACH_RECORD_TYPES = Object.freeze({
  docs: 'doc',
  contacts: 'contact',
  campaigns: 'campaign',
  forms: 'form',
} as const);

export type AttachRecordType = (typeof ATTACH_RECORD_TYPES)[AttachCategoryId];

/**
 * One attachable record.
 *
 * 🔴 `category` rides on every row because ids are NOT unique across the four
 * collections: a doc and a contact may both be `abc123`. Anything that commits
 * a selection reads this field, never the bare id.
 */
export interface AttachRecord {
  category: AttachCategoryId;
  type: AttachRecordType;
  id: string;
  title: string;
  subtitle: string;
}

/**
 * How many recents a category offers before "Browse…".
 * The founder asked for "2 3 recent ones"; a category holding fewer shows
 * what it has, and one holding none shows an empty state rather than a gap.
 */
export const ATTACH_RECENTS_LIMIT = 3;

/** Discriminated so a failure cannot be read as an empty list. See header. */
export type AttachLoad =
  | { ok: true; records: AttachRecord[] }
  | { ok: false; error: unknown };

/**
 * Records live in flat collections scoped by a `tenantId` FIELD (matching
 * AdminDocs / AdminCRM / AdminFundraising) — not tenant subcollections. Query
 * by equality only, so no composite index is required. For the platform tenant
 * under a super admin, legacy null-tenant records are merged in.
 */
async function dualTenantDocs(
  collName: string,
  tenantId: string,
  includeNull: boolean,
  max: number,
): Promise<QueryDocumentSnapshot[]> {
  const primary = await getDocs(
    query(collection(db, collName), where('tenantId', '==', tenantId), limit(max)),
  );
  if (!includeNull) return primary.docs;
  const legacy = await getDocs(
    query(collection(db, collName), where('tenantId', '==', null), limit(max)),
  );
  const seen = new Set(primary.docs.map((d) => d.id));
  return [...primary.docs, ...legacy.docs.filter((d) => !seen.has(d.id))];
}

const millis = (v: unknown): number =>
  typeof (v as Timestamp | undefined)?.toMillis === 'function' ? (v as Timestamp).toMillis() : 0;

/**
 * Newest first. Every category is sorted by the same rule so "recent" means
 * one thing across the four flyouts; a category whose documents carry no
 * timestamp keeps its query order rather than being shuffled.
 */
function newestFirst<T extends { _sort: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b._sort - a._sort);
}

async function loadDocs(tenantId: string, includeNull: boolean): Promise<AttachRecord[]> {
  const [docsDocs, folderDocs] = await Promise.all([
    dualTenantDocs('docs', tenantId, includeNull, 50),
    dualTenantDocs('docFolders', tenantId, includeNull, 100),
  ]);
  const folderNames = new Map<string, string>();
  folderDocs.forEach((f) => folderNames.set(f.id, (f.data().name as string) || 'Folder'));
  const rows = docsDocs.map((d) => {
    const data = d.data();
    const folder = data.folderId ? folderNames.get(data.folderId as string) : null;
    const updated = (data.updatedAt as Timestamp | undefined)?.toDate?.();
    const subtitle =
      folder ||
      (updated ? updated.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Doc');
    return {
      category: 'docs' as const,
      type: 'doc' as const,
      id: d.id,
      title: (data.title as string) || 'Untitled',
      subtitle,
      _sort: millis(data.updatedAt),
    };
  });
  return newestFirst(rows).map(({ _sort: _ignored, ...r }) => r);
}

async function loadContacts(tenantId: string, includeNull: boolean): Promise<AttachRecord[]> {
  const contactDocs = await dualTenantDocs('contacts', tenantId, includeNull, 100);
  const typeLabel: Record<string, string> = {
    donor: 'Donor',
    member: 'Member',
    both: 'Donor & Member',
  };
  const rows = contactDocs.map((d) => {
    const data = d.data();
    const name = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown';
    const badge = typeLabel[data.type as string] || 'Contact';
    return {
      category: 'contacts' as const,
      type: 'contact' as const,
      id: d.id,
      title: name,
      subtitle: data.email ? `${badge} · ${data.email}` : badge,
      _sort: millis(data.createdAt),
    };
  });
  return newestFirst(rows).map(({ _sort: _ignored, ...r }) => r);
}

async function loadCampaigns(tenantId: string, includeNull: boolean): Promise<AttachRecord[]> {
  const campaignDocs = await dualTenantDocs('campaigns', tenantId, includeNull, 50);
  const rows = campaignDocs.map((d) => {
    const data = d.data();
    const raised = (data.raised as number) || 0;
    const goal = (data.goal as number) || 0;
    const money =
      goal > 0
        ? `$${raised.toLocaleString()} of $${goal.toLocaleString()}`
        : `$${raised.toLocaleString()} raised`;
    return {
      category: 'campaigns' as const,
      type: 'campaign' as const,
      id: d.id,
      title: (data.title as string) || 'Campaign',
      subtitle: `${money} · ${data.isActive ? 'Active' : 'Inactive'}`,
      _sort: millis(data.createdAt),
    };
  });
  return newestFirst(rows).map(({ _sort: _ignored, ...r }) => r);
}

/**
 * ⚠️ Forms live in the tenant SUBCOLLECTION (`tenants/{tenantId}/forms`), not a
 * flat tenantId-scoped collection — so `dualTenantDocs` does not apply. Only
 * forms that are publicly openable (`active !== false`) are offered.
 */
async function loadForms(tenantId: string): Promise<AttachRecord[]> {
  const snap = await getDocs(
    query(
      collection(db, 'tenants', tenantId, 'forms'),
      orderBy('createdAt', 'desc'),
      limit(50),
    ),
  );
  return snap.docs
    .filter((d) => d.data().active !== false)
    .map((d) => {
      const data = d.data();
      const count = (data.submissionCount as number) || 0;
      return {
        category: 'forms' as const,
        type: 'form' as const,
        id: d.id,
        title: (data.title as string) || 'Untitled Form',
        subtitle: `${count} ${count === 1 ? 'submission' : 'submissions'}`,
      };
    });
}

/** Loads ONE category. A rejected query answers `{ ok: false }`, never `[]`. */
export async function loadAttachCategory(
  category: AttachCategoryId,
  tenantId: string,
  includeNull: boolean,
): Promise<AttachLoad> {
  try {
    switch (category) {
      case 'docs':
        return { ok: true, records: await loadDocs(tenantId, includeNull) };
      case 'contacts':
        return { ok: true, records: await loadContacts(tenantId, includeNull) };
      case 'campaigns':
        return { ok: true, records: await loadCampaigns(tenantId, includeNull) };
      case 'forms':
        return { ok: true, records: await loadForms(tenantId) };
    }
  } catch (error) {
    return { ok: false, error };
  }
}

export type AttachLoadsByCategory = Readonly<Record<AttachCategoryId, AttachLoad>>;

/**
 * Loads all four. Each category settles INDEPENDENTLY: one collection a church
 * cannot read must not blank the other three, which is what a single
 * `Promise.all` over the four would do.
 */
export async function loadAllAttachCategories(
  tenantId: string,
  includeNull: boolean,
): Promise<AttachLoadsByCategory> {
  const entries = await Promise.all(
    ATTACH_CATEGORY_IDS.map(
      async (id) => [id, await loadAttachCategory(id, tenantId, includeNull)] as const,
    ),
  );
  return Object.fromEntries(entries) as AttachLoadsByCategory;
}

/** The first `ATTACH_RECENTS_LIMIT` rows — the flyout's recents. */
export function recentsOf(load: AttachLoad): AttachRecord[] {
  return load.ok ? load.records.slice(0, ATTACH_RECENTS_LIMIT) : [];
}

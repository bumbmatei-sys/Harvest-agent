import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb, adminAuth } from '@/lib/firebase-admin';

/**
 * DELETE /api/tenants/delete?id=<tenantId>[&dryRun=true]
 *
 * Server-side tenant deletion using the Firebase Admin SDK (bypasses Firestore
 * rules). Only super admins can delete tenants.
 *
 * ⚠️ DESTRUCTIVE & IRREVERSIBLE. Deleting a tenant cascades to:
 *   1. The tenant document + ALL of its subcollections (recursiveDelete).
 *   2. Every top-level collection that carries a `tenantId` field and holds
 *      tenant-owned content (see TENANT_COLLECTIONS below). recursiveDelete on
 *      the tenant doc does NOT reach these — they are SEPARATE top-level
 *      collections, not subcollections of the tenant doc — so each is
 *      query-and-deleted here (paginated + batched). Skipping them is what
 *      previously ORPHANED a tenant's users and content on deletion.
 *   3. The Firebase AUTH accounts of the tenant's users. Deleting only the
 *      `users/{uid}` Firestore doc leaves the Auth account intact — the person
 *      can still sign in (into a broken, doc-less state) and their email is
 *      permanently unusable for a new signup (Auth collision). So user deletion
 *      MUST also delete the Auth account.
 *
 * `dryRun=true` returns a per-collection count of what WOULD be deleted (plus the
 * list of user uids/emails) and deletes NOTHING — use it to preview before the
 * irreversible run.
 *
 * Partial-failure policy: there is NO rollback. If a step throws, it is recorded
 * in `errors` and the run continues; the response reports exactly what was
 * deleted. A run with any errors returns HTTP 500 (with the full summary body).
 */

/**
 * Top-level collections that carry a `tenantId` field and hold tenant-owned
 * content. `users` is handled separately (it also needs Auth-account deletion).
 *
 * `recursive: true` marks collections whose OWN documents have subcollections
 * (community_posts → comments, churches → announcements). Those must be removed
 * with recursiveDelete per matched doc, or the nested docs would themselves be
 * orphaned — the exact bug this route fixes.
 *
 * Deliberately EXCLUDED:
 *   - certificates: course-completion trust artifacts. Carry `tenantId`, but the
 *     founder chose to KEEP them as records rather than delete them with the
 *     tenant. (Their `read` rule requires the reader to be the cert's uid, so
 *     deleted users can't read them anyway — but they are retained on purpose.)
 *   - affiliate_commissions: payout records owned by the *referrer* (a different
 *     user's earnings); `tenantId` only names which subscription generated them.
 *   - donations: legacy/dead (create disabled); real donations live under
 *     tenants/{id}/invoices (removed by recursiveDelete on the tenant doc).
 *   - platform_inbox: support/feature/bug tickets owned by the platform owner;
 *     keyed on `fromTenantId`, never `tenantId`.
 *   - email_log / enterprise_leads / webhook_events / config: platform-global
 *     infra/audit data with no `tenantId` scoping.
 */
const TENANT_COLLECTIONS: { name: string; recursive?: boolean }[] = [
  { name: 'courses' },
  { name: 'blog_posts' },
  { name: 'community_posts', recursive: true },
  { name: 'prayer_requests' },
  { name: 'rag_sources' },
  { name: 'rag_chunks' },
  { name: 'contacts' },
  { name: 'contactActivities' },
  { name: 'docs' },
  { name: 'docFolders' },
  { name: 'authors' },
  { name: 'categories' },
  { name: 'campaigns' },
  { name: 'churches', recursive: true },
  { name: 'chat_usage' },
  { name: 'domains' },
  { name: 'ai_assistant_bindings' },
  { name: 'twilioNumbers' },
  { name: 'submissions' },
];

// Firestore WriteBatch caps at 500 writes — stay comfortably under it. This is
// also the query page size, so each page maps to exactly one batch commit and a
// large collection (e.g. thousands of rag_chunks) never lands in memory at once.
const BATCH_LIMIT = 400;
// Smaller page for recursive collections — each matched doc spawns its own
// recursiveDelete walk, so bound how many run concurrently.
const RECURSIVE_PAGE = 50;
// The platform tenant's id is used as the tenantId for super-admin/platform-wide
// content written on the apex. Cascade-deleting it would nuke platform data, so
// it is refused here. Matches PLATFORM_TENANT_ID in src/utils/tenant-scope.ts
// (read directly to avoid importing client-only firebase into this server route).
const PLATFORM_TENANT_ID = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID || 'harvest';

type DeleteError = { step: string; message: string };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Count matching docs without reading them all (aggregate query) — dry-run. */
async function countCollection(name: string, tenantId: string): Promise<number> {
  const agg = await adminDb.collection(name).where('tenantId', '==', tenantId).count().get();
  return agg.data().count;
}

/** List the tenant's users (uid + email) for the dry-run preview. */
async function listUsers(tenantId: string): Promise<{ uid: string; email: string | null }[]> {
  const snap = await adminDb.collection('users').where('tenantId', '==', tenantId).get();
  return snap.docs.map((d) => ({ uid: d.id, email: (d.data()?.email as string) ?? null }));
}

/**
 * Paginate `where('tenantId','==',tenantId)` and hard-delete via WriteBatch.
 * Re-queries the same filter after each commit: the just-deleted docs drop out,
 * so the next page is the next set, terminating when a page comes back empty.
 */
async function deleteCollection(name: string, tenantId: string): Promise<number> {
  const coll = adminDb.collection(name);
  let count = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await coll.where('tenantId', '==', tenantId).limit(BATCH_LIMIT).get();
    if (snap.empty) break;
    const batch = adminDb.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    count += snap.size;
    if (snap.size < BATCH_LIMIT) break;
  }
  return count;
}

/**
 * Like deleteCollection, but each matched doc is removed with recursiveDelete so
 * its OWN subcollections go with it (community_posts/comments,
 * churches/announcements) instead of being orphaned.
 */
async function deleteCollectionRecursive(name: string, tenantId: string): Promise<number> {
  const coll = adminDb.collection(name);
  let count = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await coll.where('tenantId', '==', tenantId).limit(RECURSIVE_PAGE).get();
    if (snap.empty) break;
    await Promise.all(snap.docs.map((d) => adminDb.recursiveDelete(d.ref)));
    count += snap.size;
    if (snap.size < RECURSIVE_PAGE) break;
  }
  return count;
}

/**
 * Delete the tenant's users: Firebase Auth accounts AND Firestore docs, paginated.
 * Auth is deleted first per page — a leftover Auth account (can still sign in,
 * email locked) is worse than a leftover Firestore doc. Per-uid Auth failures are
 * recorded and do not abort the run.
 */
async function deleteUsersAndAuth(
  tenantId: string,
  errors: DeleteError[],
): Promise<{ docCount: number; authDeleted: number }> {
  const usersColl = adminDb.collection('users');
  const canBatchAuth = typeof (adminAuth as { deleteUsers?: unknown }).deleteUsers === 'function';
  let docCount = 0;
  let authDeleted = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // BATCH_LIMIT (400) is under both the WriteBatch cap (500) and the
    // adminAuth.deleteUsers cap (1000), so one page = one auth call + one batch.
    const snap = await usersColl.where('tenantId', '==', tenantId).limit(BATCH_LIMIT).get();
    if (snap.empty) break;
    const uids = snap.docs.map((d) => d.id);

    try {
      if (canBatchAuth) {
        const res = await adminAuth.deleteUsers(uids);
        authDeleted += res.successCount ?? 0;
        for (const e of res.errors || []) {
          errors.push({ step: `auth:${uids[e.index] ?? '?'}`, message: e.error?.message || 'Auth delete failed' });
        }
      } else {
        for (const uid of uids) {
          try {
            await adminAuth.deleteUser(uid);
            authDeleted += 1;
          } catch (e) {
            errors.push({ step: `auth:${uid}`, message: errMsg(e) });
          }
        }
      }
    } catch (e) {
      // A wholesale Auth failure (e.g. network) — record it and stop the users
      // phase rather than looping forever on a page we can't clear.
      errors.push({ step: 'auth:batch', message: errMsg(e) });
      break;
    }

    const batch = adminDb.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    docCount += snap.size;
    if (snap.size < BATCH_LIMIT) break;
  }

  return { docCount, authDeleted };
}

export async function DELETE(request: NextRequest) {
  const userOrResponse = await requireAuth(request);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  // Super admin check (isSuperAdmin already includes email fallback from api-auth)
  if (!userOrResponse.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  const tenantId = request.nextUrl.searchParams.get('id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenant id' }, { status: 400 });
  }

  // Safety rail: never cascade-delete the platform tenant (super-admin/platform
  // content is stored under this tenantId). Configurable via PLATFORM_TENANT_ID.
  if (tenantId === PLATFORM_TENANT_ID) {
    return NextResponse.json(
      { error: `Refusing to delete the platform tenant ('${tenantId}').` },
      { status: 400 },
    );
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === 'true';

  try {
    const tenantRef = adminDb.collection('tenants').doc(tenantId);
    const tenantSnap = await tenantRef.get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const deleted: Record<string, number> = {};
    const errors: DeleteError[] = [];

    // ── DRY RUN: count everything, delete nothing ──────────────────────────────
    if (dryRun) {
      const userAccounts = await listUsers(tenantId);
      deleted.users = userAccounts.length;
      for (const { name } of TENANT_COLLECTIONS) {
        try {
          deleted[name] = await countCollection(name, tenantId);
        } catch (e) {
          deleted[name] = 0;
          errors.push({ step: `count:${name}`, message: errMsg(e) });
        }
      }
      return NextResponse.json({
        tenantId,
        dryRun: true,
        deleted,
        authDeleted: userAccounts.length,
        userAccounts,
        errors,
      });
    }

    // ── REAL DELETION ──────────────────────────────────────────────────────────
    // 1) Users + their Auth accounts first (the most irreversible step).
    let authDeleted = 0;
    try {
      const r = await deleteUsersAndAuth(tenantId, errors);
      deleted.users = r.docCount;
      authDeleted = r.authDeleted;
    } catch (e) {
      deleted.users = deleted.users ?? 0;
      errors.push({ step: 'delete:users', message: errMsg(e) });
    }

    // 2) Every other top-level tenant-owned collection.
    for (const { name, recursive } of TENANT_COLLECTIONS) {
      try {
        deleted[name] = recursive
          ? await deleteCollectionRecursive(name, tenantId)
          : await deleteCollection(name, tenantId);
      } catch (e) {
        deleted[name] = deleted[name] ?? 0;
        errors.push({ step: `delete:${name}`, message: errMsg(e) });
      }
    }

    // 3) The tenant doc + its subcollections last, so a mid-run crash leaves the
    //    tenant doc present (signalling "not fully deleted") and the run retryable.
    try {
      await adminDb.recursiveDelete(tenantRef);
    } catch (e) {
      errors.push({ step: 'delete:tenant', message: errMsg(e) });
    }

    return NextResponse.json(
      { tenantId, dryRun: false, deleted, authDeleted, errors },
      { status: errors.length > 0 ? 500 : 200 },
    );
  } catch (error) {
    console.error('Tenant delete error:', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}

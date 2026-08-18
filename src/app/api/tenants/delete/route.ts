import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { tenantPrivateRef } from '@/lib/tenant-private';
import {
  assertConcreteScope,
  emptyReport,
  type DeletionReport,
} from '@/lib/member-deletion';

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
 *   3. The tenant's MEMBERS — who are DETACHED, never deleted. See below.
 *
 * ⚠️ MEMBERS ARE PEOPLE, NOT TENANT DATA (THE-76). This route used to delete
 * every `users/{uid}` doc carrying the tenant's id AND the matching Firebase Auth
 * account. That is wrong on both halves:
 *
 *   • A member may belong to another church. Deleting their `users` doc because
 *     ONE of their churches was removed destroys a profile that is still in use
 *     somewhere else — along with their course progress, saved items and lesson
 *     notes, none of which are the deleted tenant's property.
 *   • Deleting their Auth account is worse still: it destroys a sign-in that
 *     nobody in this flow asked to remove, and locks their email out of ever
 *     being reused. A super admin removing a church has no mandate over the
 *     people inside it.
 *
 * So the members are DETACHED instead: `tenantId`, `role` and `permissions` are
 * cleared, which is exactly the state a member is in before they join a church.
 * They keep their account, their sign-in and their own data. A member who wants
 * their data gone deletes their own account through /api/account/delete, which
 * is the route that owns that decision and sweeps the ~24 collections it
 * touches.
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
  const agg = await adminDb
    .collection(name)
    .where('tenantId', '==', assertConcreteScope(tenantId, 'tenantId'))
    .count()
    .get();
  return agg.data().count;
}

/** List the tenant's users (uid + email) for the dry-run preview. */
async function listUsers(tenantId: string): Promise<{ uid: string; email: string | null }[]> {
  const snap = await adminDb
    .collection('users')
    .where('tenantId', '==', assertConcreteScope(tenantId, 'tenantId'))
    .get();
  return snap.docs.map((d) => ({ uid: d.id, email: (d.data()?.email as string) ?? null }));
}

/**
 * Paginate `where('tenantId','==',tenantId)` and hard-delete via WriteBatch.
 * Re-queries the same filter after each commit: the just-deleted docs drop out,
 * so the next page is the next set, terminating when a page comes back empty.
 */
async function deleteCollection(name: string, tenantId: string): Promise<number> {
  assertConcreteScope(tenantId, 'tenantId');
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
  assertConcreteScope(tenantId, 'tenantId');
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
 * DETACH the tenant's members: clear `tenantId`, `role` and `permissions`,
 * paginated and batched. Nothing is deleted — not the `users` doc, not the Auth
 * account.
 *
 * 🔴 THE ONE RULE THIS FUNCTION EXISTS TO ENFORCE: a member may belong to
 * another church. A super admin removing THIS church has no mandate to destroy
 * a person's profile or sign-in, so the strongest thing that may happen to them
 * is losing their membership of the tenant that is going away. Detached is
 * exactly the state a member is in before they join one, so the app already
 * handles it everywhere.
 *
 * Detaching also fixes what deletion was really for: the orphan. A user doc that
 * kept a dead `tenantId` stayed in the tenant's queries; clearing the field
 * takes them out of every one of them without touching the person.
 *
 * Members who WANT their data gone use /api/account/delete, which owns that
 * decision and sweeps the collections it covers.
 */
async function detachUsers(tenantId: string, errors: DeleteError[]): Promise<number> {
  assertConcreteScope(tenantId, 'tenantId');
  const usersColl = adminDb.collection('users');
  let detached = 0;
  let cursor: unknown = undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Cursor-paged, not re-query-paged: a detached doc no longer matches the
    // filter, so the next page IS the next set — but only after the commit
    // lands, and paging by the last doc keeps that ordering explicit.
    const base = usersColl.where('tenantId', '==', tenantId).limit(BATCH_LIMIT);
    const snap = await (cursor === undefined ? base : usersColl.where('tenantId', '==', tenantId).startAfter(cursor).limit(BATCH_LIMIT)).get();
    if (snap.empty) break;

    try {
      const batch = adminDb.batch();
      snap.docs.forEach((d) =>
        batch.update(d.ref, {
          tenantId: null,
          role: 'user',
          permissions: {},
          detachedFromTenantId: tenantId,
          detachedAt: new Date().toISOString(),
        }),
      );
      await batch.commit();
      detached += snap.size;
    } catch (e) {
      // Recorded and stopped rather than looping forever on a page that will not
      // clear. The members left attached still point at a tenant that is gone —
      // reported, never silent.
      errors.push({ step: 'detach:users', message: errMsg(e) });
      captureHandledError(e, { step: 'tenant-delete-detach-users', tenantId });
      break;
    }

    if (snap.size < BATCH_LIMIT) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  return detached;
}

/**
 * Fold the per-step counters into the shared partial-report shape, so a caller
 * reading either deletion route sees the same thing: what was cleared, what was
 * kept, and — named, never implied — what failed. Mirrors THE-29's SMS broadcast
 * report; `errors` is kept alongside it unchanged so existing callers still work.
 */
function buildReport(deleted: Record<string, number>, errors: DeleteError[]): DeletionReport {
  const report = emptyReport();
  for (const [name, n] of Object.entries(deleted)) {
    if (name === 'users') continue; // members are detached, not deleted
    report.cleared[name] = n;
  }
  report.retained['users'] =
    'Members are DETACHED (tenantId/role/permissions cleared), never deleted — a member may belong to another church.';
  report.retained['certificates'] = 'Course-completion records, retained on purpose.';
  report.retained['affiliate_commissions'] = "Payout records owned by the referrer, not by this tenant.";
  for (const e of errors) {
    report.failures.push({ collection: e.step, message: e.message });
  }
  if (report.failures.length > 0) {
    report.status = 'partial';
    report.error = `Tenant deletion was incomplete — ${report.failures.length} step(s) failed.`;
  }
  return report;
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
      // 0, and stays 0. Members are DETACHED, not deleted — `deleted` counts
      // deletions and would be lying if it claimed these. `detached` and
      // `userAccounts` say who is affected and how.
      deleted.users = 0;
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
        detached: userAccounts.length,
        // Members' Auth accounts are never touched by this route.
        authDeleted: 0,
        userAccounts,
        errors,
        report: buildReport(deleted, errors),
      });
    }

    // ── REAL DELETION ──────────────────────────────────────────────────────────
    // 1) Members first — DETACHED, never deleted. Done before the cascade so a
    //    run that dies partway has already taken them out of the dying tenant's
    //    queries rather than leaving them pointing at half a church.
    deleted.users = 0;
    let detached = 0;
    try {
      detached = await detachUsers(tenantId, errors);
    } catch (e) {
      errors.push({ step: 'detach:users', message: errMsg(e) });
      captureHandledError(e, { step: 'tenant-delete-users', tenantId });
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
        captureHandledError(e, { step: 'tenant-delete-collection', tenantId, ids: { collection: name } });
      }
    }

    // 3) The tenant doc + its subcollections last, so a mid-run crash leaves the
    //    tenant doc present (signalling "not fully deleted") and the run retryable.
    try {
      await adminDb.recursiveDelete(tenantRef);
    } catch (e) {
      errors.push({ step: 'delete:tenant', message: errMsg(e) });
      captureHandledError(e, { step: 'tenant-delete-tenant-doc', tenantId });
    }

    // The tenant_private mirror is a TOP-LEVEL doc (tenant_private/{id}), so the
    // recursiveDelete above never touches it — remove it explicitly.
    try {
      await tenantPrivateRef(tenantId).delete();
    } catch (e) {
      errors.push({ step: 'delete:tenant_private', message: errMsg(e) });
      captureHandledError(e, { step: 'tenant-delete-tenant-private', tenantId });
    }

    return NextResponse.json(
      {
        tenantId,
        dryRun: false,
        deleted,
        detached,
        // Members keep their sign-in — this route never deletes an Auth account.
        authDeleted: 0,
        errors,
        report: buildReport(deleted, errors),
      },
      { status: errors.length > 0 ? 500 : 200 },
    );
  } catch (error) {
    console.error('Tenant delete error:', error);
    // This route is irreversible and has no rollback by design, so every failure
    // above leaves a partially-deleted tenant. The per-step `errors` array only
    // reaches whoever's browser made the call; nothing persists it.
    captureHandledError(error, { step: 'tenant-delete', tenantId });
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * 🔴 THE-76 — DELETING A CHURCH MUST NOT DELETE THE PEOPLE IN IT.
 *
 * A tenant deletion removes the TENANT'S data. The members inside it are
 * separate people who may belong to another church, and a super admin removing
 * this one has no mandate over their profile or their sign-in. This route used
 * to delete both.
 *
 * ⚠️ THE ASSERTIONS THAT ENCODE THE DEFECT, each failing BY NAME:
 *   - 'deleting a church does not delete a member\'s user document' — restoring
 *     the users-doc delete fails THAT test.
 *   - 'a member cannot delete a church' — weakening the super-admin gate fails
 *     THAT test.
 *   - 'every delete query carries a concrete tenant id, never null' — the class
 *     that could destroy another church's data.
 *
 * ⚠️ THE REAL `requireAuth` RUNS, including its super-admin-by-email fallback.
 * Only Firestore and the token verification beneath it are mocked.
 */

const tree = await import('@/test/mocks/firestore-tree');

vi.mock('@/lib/firebase-admin', async () => {
  const m = await import('@/test/mocks/firestore-tree');
  return { adminDb: m.adminDb, adminAuth: m.adminAuth, getReceiptsBucket: m.getReceiptsBucket };
});
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));
// tenant_private is a separate top-level doc with its own accessor.
vi.mock('@/lib/tenant-private', async () => {
  const m = await import('@/test/mocks/firestore-tree');
  return { tenantPrivateRef: (id: string) => m.adminDb.collection('tenant_private').doc(id) };
});

const { DELETE } = await import('../delete/route');

const TENANT = 'grace';
const OTHER_TENANT = 'hope';
const MEMBER = 'member-1';
const DUAL_MEMBER = 'member-2';

function request(id?: string, dryRun = false): NextRequest {
  const params = new URLSearchParams();
  if (id) params.set('id', id);
  if (dryRun) params.set('dryRun', 'true');
  const qs = params.toString();
  return new NextRequest(
    new Request(`https://theharvest.app/api/tenants/delete${qs ? `?${qs}` : ''}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer tok' },
    }),
  );
}

const asSuperAdmin = () =>
  tree.mockVerifyIdToken.mockResolvedValue({ uid: 'owner', email: 'owner@theharvest.app', superAdmin: true });

/** A church admin of the very tenant being deleted — the closest a member gets. */
const asChurchAdmin = () =>
  tree.mockVerifyIdToken.mockResolvedValue({ uid: MEMBER, email: 'admin@grace.org', admin: true, tenantId: TENANT });

const asMember = () =>
  tree.mockVerifyIdToken.mockResolvedValue({ uid: MEMBER, email: 'member@grace.org', tenantId: TENANT });

function seed() {
  tree.__seed('tenants', [{ id: TENANT, name: 'Grace Chapel' }, { id: OTHER_TENANT, name: 'Hope Church' }]);
  tree.__seed('users', [
    { id: MEMBER, email: 'member@grace.org', displayName: 'Grace', tenantId: TENANT, role: 'user', completedLessons: ['l1'], savedItems: { 'blog:1': {} } },
    { id: DUAL_MEMBER, email: 'dual@grace.org', displayName: 'Sam', tenantId: TENANT, role: 'admin', permissions: { modifyChurches: true } },
    { id: 'outsider', email: 'out@hope.org', tenantId: OTHER_TENANT, role: 'user' },
  ]);
  tree.__seed('courses', [{ id: 'co-1', tenantId: TENANT }, { id: 'co-2', tenantId: OTHER_TENANT }]);
  tree.__seed('contacts', [{ id: 'c-1', tenantId: TENANT }, { id: 'c-2', tenantId: OTHER_TENANT }]);
  tree.__seed('community_posts', [{ id: 'p-1', tenantId: TENANT }]);
  tree.__seed('community_posts/p-1/comments', [{ id: 'cm-1', tenantId: TENANT }]);
  tree.__seed('tenant_private', [{ id: TENANT, adminEmails: ['admin@grace.org'] }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  tree.__reset();
  tree.commitShouldThrow.on = null;
  seed();
});

describe('deleting a church does not delete a member\'s user document', () => {
  it('🔴 every member\'s profile survives — they may belong to another church', async () => {
    asSuperAdmin();

    const res = await DELETE(request(TENANT));

    expect(res.status).toBe(200);
    expect(tree.__doc('users', MEMBER), 'the member\'s profile was deleted with the church').toBeDefined();
    expect(tree.__doc('users', DUAL_MEMBER)).toBeDefined();
  });

  it('🔴 no member\'s Firebase Auth account is deleted, so their sign-in and email survive', async () => {
    asSuperAdmin();

    const res = await DELETE(request(TENANT));

    expect(tree.mockDeleteUsers, 'a member\'s sign-in was destroyed by a tenant deletion').not.toHaveBeenCalled();
    expect(tree.mockDeleteUser).not.toHaveBeenCalled();
    expect((await res.json()).authDeleted).toBe(0);
  });

  it('keeps the member\'s own data on the profile — course progress and saved items are not the tenant\'s', async () => {
    asSuperAdmin();
    await DELETE(request(TENANT));
    expect(tree.__doc('users', MEMBER)).toMatchObject({
      email: 'member@grace.org', displayName: 'Grace', completedLessons: ['l1'],
    });
  });

  it('detaches them instead: tenantId, role and permissions cleared, which is the pre-join state', async () => {
    asSuperAdmin();

    const res = await DELETE(request(TENANT));

    expect(tree.__doc('users', MEMBER)).toMatchObject({ tenantId: null, role: 'user', permissions: {} });
    expect(tree.__doc('users', DUAL_MEMBER)).toMatchObject({ tenantId: null, role: 'user', permissions: {} });
    expect((await res.json()).detached).toBe(2);
  });

  it('detaching takes them out of the dead tenant\'s queries — the orphan the delete was really for', async () => {
    asSuperAdmin();
    await DELETE(request(TENANT));
    const stillAttached = tree
      .__docs('users')
      .filter(([, d]) => (d as { tenantId?: string }).tenantId === TENANT);
    expect(stillAttached).toEqual([]);
  });

  it('never touches a member of another church', async () => {
    asSuperAdmin();
    await DELETE(request(TENANT));
    expect(tree.__doc('users', 'outsider')).toMatchObject({ tenantId: OTHER_TENANT, role: 'user' });
  });

  it('reports members as retained-and-detached, not as deleted', async () => {
    asSuperAdmin();
    const body = await (await DELETE(request(TENANT))).json();
    expect(body.deleted.users).toBe(0);
    expect(body.report.retained.users).toMatch(/detached/i);
    expect(body.report.retained.users).toMatch(/another church/i);
  });

  it('the dry run previews a detach, not a deletion', async () => {
    asSuperAdmin();
    const body = await (await DELETE(request(TENANT, true))).json();
    expect(body.dryRun).toBe(true);
    expect(body.detached).toBe(2);
    expect(body.deleted.users).toBe(0);
    expect(body.authDeleted).toBe(0);
    // And nothing actually moved.
    expect(tree.__doc('users', MEMBER)).toMatchObject({ tenantId: TENANT });
    expect(tree.__doc('courses', 'co-1')).toBeDefined();
  });
});

describe('a member cannot delete a church', () => {
  it('🔴 403s an ordinary member of the tenant', async () => {
    asMember();

    const res = await DELETE(request(TENANT));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'Super admin access required' });
    expect(tree.__doc('tenants', TENANT), 'a member deleted a church').toBeDefined();
    expect(tree.__doc('courses', 'co-1')).toBeDefined();
  });

  it('🔴 403s a CHURCH ADMIN too — tenant admin is not platform owner', async () => {
    asChurchAdmin();

    const res = await DELETE(request(TENANT));

    expect(res.status).toBe(403);
    expect(tree.__doc('tenants', TENANT)).toBeDefined();
    expect(tree.__doc('users', MEMBER)).toMatchObject({ tenantId: TENANT });
  });

  it('401s an unauthenticated caller', async () => {
    tree.mockVerifyIdToken.mockRejectedValue(new Error('bad token'));

    const res = await DELETE(request(TENANT));

    expect(res.status).toBe(401);
    expect(tree.__doc('tenants', TENANT)).toBeDefined();
  });

  it('refuses before running a single query, not after', async () => {
    asMember();
    await DELETE(request(TENANT));
    expect(tree.recordedWheres).toEqual([]);
  });
});

describe('the tenant cascade still removes the church\'s own data', () => {
  it('clears tenant-owned collections and the tenant doc, sparing every other tenant', async () => {
    asSuperAdmin();

    const res = await DELETE(request(TENANT));

    expect(res.status).toBe(200);
    expect(tree.__doc('courses', 'co-1')).toBeUndefined();
    expect(tree.__doc('contacts', 'c-1')).toBeUndefined();
    expect(tree.__doc('tenants', TENANT)).toBeUndefined();
    expect(tree.__doc('tenant_private', TENANT)).toBeUndefined();
    // Another church is untouched.
    expect(tree.__doc('courses', 'co-2')).toBeDefined();
    expect(tree.__doc('contacts', 'c-2')).toBeDefined();
    expect(tree.__doc('tenants', OTHER_TENANT)).toBeDefined();
  });

  it('takes a post\'s comment subcollection with it rather than orphaning it', async () => {
    asSuperAdmin();
    await DELETE(request(TENANT));
    expect(tree.__count('community_posts/p-1/comments')).toBe(0);
  });
});

describe('every delete query carries a concrete tenant id, never null', () => {
  it('🔴 no query in a tenant deletion was built from a null, undefined or empty scope', async () => {
    asSuperAdmin();
    await DELETE(request(TENANT));
    expect(tree.recordedWheres.length).toBeGreaterThan(0);
    const bad = tree.recordedWheres.filter((w) => w.value === null || w.value === undefined || w.value === '');
    expect(bad, `queries built from a non-concrete scope: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it('🔴 every tenant-scoped query names the tenant being deleted and no other', async () => {
    asSuperAdmin();
    await DELETE(request(TENANT));
    for (const w of tree.recordedWheres.filter((w) => w.field === 'tenantId')) {
      expect(w.value).toBe(TENANT);
    }
  });

  it('400s a missing tenant id rather than running unscoped', async () => {
    asSuperAdmin();
    const res = await DELETE(request());
    expect(res.status).toBe(400);
    expect(tree.recordedWheres).toEqual([]);
    expect(tree.__doc('tenants', TENANT)).toBeDefined();
  });
});

describe('a partial failure reports which collections were cleared', () => {
  it('names the failed step and still reports what was cleared', async () => {
    asSuperAdmin();
    tree.commitShouldThrow.on = 'contacts';

    const res = await DELETE(request(TENANT));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.report.status).toBe('partial');
    expect(body.errors.some((e: { step: string }) => e.step === 'delete:contacts')).toBe(true);
    expect(body.deleted.courses).toBe(1);
  });

  it('a failed member detach is reported by name rather than leaving them silently attached', async () => {
    asSuperAdmin();
    tree.commitShouldThrow.on = 'users';

    const res = await DELETE(request(TENANT));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.detached).toBe(0);
    expect(body.errors.some((e: { step: string }) => e.step === 'detach:users')).toBe(true);
    expect(tree.__doc('users', MEMBER)).toMatchObject({ tenantId: TENANT });
  });
});

describe('deletion is idempotent — running it twice does not error', () => {
  it('the second run 404s on a tenant that is already gone, and changes nothing', async () => {
    asSuperAdmin();
    expect((await DELETE(request(TENANT))).status).toBe(200);

    const second = await DELETE(request(TENANT));

    expect(second.status).toBe(404);
    expect(tree.__doc('users', MEMBER)).toMatchObject({ tenantId: null });
    expect(tree.__doc('users', 'outsider')).toMatchObject({ tenantId: OTHER_TENANT });
  });

  it('a re-run after a partial failure completes the job without erroring', async () => {
    asSuperAdmin();
    tree.commitShouldThrow.on = 'contacts';
    expect((await DELETE(request(TENANT))).status).toBe(500);

    // The tenant doc survives a partial run by design, so the retry can find it.
    tree.__seed('tenants', [{ id: TENANT, name: 'Grace Chapel' }]);
    const second = await DELETE(request(TENANT));

    expect(second.status).toBe(200);
    expect(tree.__doc('contacts', 'c-1')).toBeUndefined();
  });
});

describe('a deletion larger than one Firestore batch is chunked', () => {
  it('🔴 detaches 2,000 members without a batch over the 500-operation cap', async () => {
    asSuperAdmin();
    tree.__seed(
      'users',
      Array.from({ length: 2000 }, (_, i) => ({ id: `bulk-${i}`, email: `m${i}@grace.org`, tenantId: TENANT })),
    );

    const res = await DELETE(request(TENANT));

    expect(res.status).toBe(200);
    expect((await res.json()).detached).toBe(2002);
    const sizes = tree.mockBatchCommit.mock.calls.map((c) => c[0] as number);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(400);
  });

  it('chunks a 2,000-document collection delete the same way', async () => {
    asSuperAdmin();
    tree.__seed('contacts', Array.from({ length: 2000 }, (_, i) => ({ id: `bulk-c-${i}`, tenantId: TENANT })));

    const res = await DELETE(request(TENANT));

    expect(res.status).toBe(200);
    expect((await res.json()).deleted.contacts).toBe(2001);
    expect(Math.max(...tree.mockBatchCommit.mock.calls.map((c) => c[0] as number))).toBeLessThanOrEqual(400);
  });
});

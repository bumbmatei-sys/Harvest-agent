import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST/DELETE /api/courses/adopt — server-side adoption.
 *
 * adoptedCourses is `allow write: if false` now, so this route is the ONLY way
 * an adoption record comes into existence. What that buys, and what these tests
 * therefore pin, is VALIDATION rather than a watertight cap:
 *
 *  • libraryCourseId always equals the doc id (the route writes it from the
 *    validated id, so the two cannot disagree).
 *  • The target really exists and is really published — a check no Firestore
 *    rule can make, since rules cannot read across into libraryCourses.
 *  • adoptedBy is the verified caller, not a self-reported field.
 *
 * The cap IS checked here, but a tenant's own courses are still created by a
 * direct client write to /courses. Adoption is enforced; creation is not.
 */

const h = vi.hoisted(() => ({
  requireTenantPermission: vi.fn(),
  capture: vi.fn(),
  // Firestore doubles
  adoptionDoc: { exists: false },
  libraryDoc: { exists: true, data: () => ({ status: 'published' }) as any },
  tenantDoc: { data: () => ({ plan: 'pro' }) as any },
  ownCount: 0,
  adoptedCount: 0,
  writes: [] as any[],
  deletes: [] as string[],
}));

vi.mock('@/lib/api-auth', () => ({ requireTenantPermission: h.requireTenantPermission }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: h.capture }));

vi.mock('@/lib/firebase-admin', () => {
  const adoptionRef = (path: string) => ({
    get: async () => h.adoptionDoc,
    set: async (data: unknown) => { h.writes.push({ path, data }); },
    delete: async () => { h.deletes.push(path); },
  });
  const adminDb = {
    collection: (name: string) => {
      if (name === 'tenants') {
        return {
          doc: (tenantId: string) => ({
            get: async () => h.tenantDoc,
            collection: (sub: string) => ({
              doc: (id: string) => adoptionRef(`tenants/${tenantId}/${sub}/${id}`),
              count: () => ({ get: async () => ({ data: () => ({ count: h.adoptedCount }) }) }),
            }),
          }),
        };
      }
      if (name === 'libraryCourses') {
        return { doc: () => ({ get: async () => h.libraryDoc }) };
      }
      if (name === 'courses') {
        return {
          where: () => ({ count: () => ({ get: async () => ({ data: () => ({ count: h.ownCount }) }) }) }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
  return { adminDb };
});

const { POST, DELETE } = await import('../adopt/route');

function req(body: unknown, method = 'POST'): NextRequest {
  return new NextRequest('https://example.com/api/courses/adopt', {
    method,
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const USER = { uid: 'admin-uid', email: 'a@test.com', tenantId: 'tenant-a', isAdmin: true, isSuperAdmin: false };
const GOOD = { tenantId: 'tenant-a', libraryCourseId: 'lib-1' };

beforeEach(() => {
  vi.clearAllMocks();
  h.requireTenantPermission.mockResolvedValue(USER);
  h.adoptionDoc = { exists: false };
  h.libraryDoc = { exists: true, data: () => ({ status: 'published' }) };
  h.tenantDoc = { data: () => ({ plan: 'pro' }) };
  h.ownCount = 0;
  h.adoptedCount = 0;
  h.writes = [];
  h.deletes = [];
});

describe('POST /api/courses/adopt', () => {
  describe('authorisation', () => {
    it('propagates the permission failure verbatim', async () => {
      h.requireTenantPermission.mockResolvedValue(
        NextResponse.json({ error: "Missing 'createCourses' permission" }, { status: 403 }),
      );
      const res = await POST(req(GOOD));
      expect(res.status).toBe(403);
      expect(h.writes).toHaveLength(0);
    });

    it('gates on createCourses for the tenant in the body — no new permission', async () => {
      await POST(req(GOOD));
      expect(h.requireTenantPermission).toHaveBeenCalledWith(expect.anything(), 'tenant-a', 'createCourses');
    });
  });

  describe('input validation', () => {
    it('rejects a missing tenantId', async () => {
      expect((await POST(req({ libraryCourseId: 'lib-1' }))).status).toBe(400);
    });

    it('rejects a missing libraryCourseId', async () => {
      expect((await POST(req({ tenantId: 'tenant-a' }))).status).toBe(400);
    });

    it('rejects a non-string id', async () => {
      expect((await POST(req({ tenantId: 'tenant-a', libraryCourseId: 42 }))).status).toBe(400);
    });

    it('rejects an id containing a path separator (subcollection escape)', async () => {
      const res = await POST(req({ tenantId: 'tenant-a', libraryCourseId: '../../users/victim' }));
      expect(res.status).toBe(400);
      expect(h.writes).toHaveLength(0);
    });
  });

  describe('the pointer must point somewhere real', () => {
    it('404s when the library course does not exist', async () => {
      h.libraryDoc = { exists: false, data: () => ({}) };
      const res = await POST(req(GOOD));
      expect(res.status).toBe(404);
      expect(h.writes).toHaveLength(0);
    });

    it('409s when the library course is an unpublished draft', async () => {
      h.libraryDoc = { exists: true, data: () => ({ status: 'draft' }) };
      const res = await POST(req(GOOD));
      expect(res.status).toBe(409);
      expect(h.writes).toHaveLength(0);
    });

    it('409s when the library course has no status at all', async () => {
      h.libraryDoc = { exists: true, data: () => ({}) };
      expect((await POST(req(GOOD))).status).toBe(409);
    });
  });

  describe('the plan cap, resolved server-side', () => {
    it('403s at the cap', async () => {
      h.tenantDoc = { data: () => ({ plan: 'plus' }) }; // 2
      h.ownCount = 1;
      h.adoptedCount = 1;
      const res = await POST(req(GOOD));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'course_limit_reached', maxCourses: 2 });
      expect(h.writes).toHaveLength(0);
    });

    it('counts own courses AND adoptions, not just one', async () => {
      h.tenantDoc = { data: () => ({ plan: 'plus' }) };
      h.ownCount = 2;
      h.adoptedCount = 0;
      expect((await POST(req(GOOD))).status).toBe(403);
    });

    it('allows the write under the cap', async () => {
      h.tenantDoc = { data: () => ({ plan: 'plus' }) };
      h.ownCount = 1;
      h.adoptedCount = 0;
      expect((await POST(req(GOOD))).status).toBe(200);
      expect(h.writes).toHaveLength(1);
    });

    it('treats -1 as unlimited and never counts', async () => {
      h.tenantDoc = { data: () => ({ plan: 'ultra' }) };
      h.ownCount = 500;
      h.adoptedCount = 500;
      expect((await POST(req(GOOD))).status).toBe(200);
    });

    it('fails closed to plus when the tenant doc carries no plan', async () => {
      h.tenantDoc = { data: () => ({}) };
      h.ownCount = 2;
      const res = await POST(req(GOOD));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ maxCourses: 2 });
    });

    it('ignores any plan the CLIENT claims — only the tenant doc is trusted', async () => {
      h.tenantDoc = { data: () => ({ plan: 'plus' }) };
      h.ownCount = 2;
      const res = await POST(req({ ...GOOD, plan: 'ultra', maxCourses: -1 }));
      expect(res.status).toBe(403);
    });
  });

  describe('the record written', () => {
    it('is a pointer with the verified caller as adoptedBy', async () => {
      await POST(req(GOOD));
      expect(h.writes).toHaveLength(1);
      expect(h.writes[0].path).toBe('tenants/tenant-a/adoptedCourses/lib-1');
      expect(h.writes[0].data.libraryCourseId).toBe('lib-1');
      expect(h.writes[0].data.adoptedBy).toBe('admin-uid');
      expect(typeof h.writes[0].data.adoptedAt).toBe('string');
    });

    it('carries NO course content', async () => {
      await POST(req(GOOD));
      for (const key of ['title', 'levels', 'description', 'thumbnail', 'authorIds']) {
        expect(key in h.writes[0].data).toBe(false);
      }
    });

    it('ignores a client-supplied adoptedBy — the uid comes from the token', async () => {
      await POST(req({ ...GOOD, adoptedBy: 'someone-else' }));
      expect(h.writes[0].data.adoptedBy).toBe('admin-uid');
    });

    it('writes libraryCourseId from the doc id, so the two can never disagree', async () => {
      await POST(req({ ...GOOD, libraryCourseId: 'lib-1' }));
      expect(h.writes[0].path.endsWith(`/${h.writes[0].data.libraryCourseId}`)).toBe(true);
    });
  });

  describe('idempotency', () => {
    it('succeeds without rewriting when already adopted', async () => {
      h.adoptionDoc = { exists: true };
      const res = await POST(req(GOOD));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ alreadyAdopted: true });
      expect(h.writes).toHaveLength(0);
    });

    it('does not 403 a re-confirm by a tenant already at its cap', async () => {
      h.adoptionDoc = { exists: true };
      h.tenantDoc = { data: () => ({ plan: 'plus' }) };
      h.ownCount = 2;
      h.adoptedCount = 2;
      expect((await POST(req(GOOD))).status).toBe(200);
    });
  });

  it('500s and reports to Sentry on an unexpected failure', async () => {
    h.requireTenantPermission.mockRejectedValue(new Error('boom'));
    const res = await POST(req(GOOD));
    expect(res.status).toBe(500);
    expect(h.capture).toHaveBeenCalled();
  });
});

describe('DELETE /api/courses/adopt', () => {
  it('requires the same permission', async () => {
    h.requireTenantPermission.mockResolvedValue(
      NextResponse.json({ error: 'Tenant admin access required' }, { status: 403 }),
    );
    const res = await DELETE(req(GOOD, 'DELETE'));
    expect(res.status).toBe(403);
    expect(h.deletes).toHaveLength(0);
  });

  it('deletes the pointer for the caller tenant', async () => {
    const res = await DELETE(req(GOOD, 'DELETE'));
    expect(res.status).toBe(200);
    expect(h.deletes).toEqual(['tenants/tenant-a/adoptedCourses/lib-1']);
  });

  it('is idempotent — removing something already gone still succeeds', async () => {
    h.adoptionDoc = { exists: false };
    expect((await DELETE(req(GOOD, 'DELETE'))).status).toBe(200);
  });

  it('validates ids the same way', async () => {
    const res = await DELETE(req({ tenantId: 'tenant-a', libraryCourseId: 'a/b' }, 'DELETE'));
    expect(res.status).toBe(400);
    expect(h.deletes).toHaveLength(0);
  });
});

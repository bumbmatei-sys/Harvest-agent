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
    set: async (data: unknown, opts?: unknown) => { h.writes.push({ path, data, opts }); },
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

const { POST, PATCH, DELETE } = await import('../adopt/route');

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

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — the adopting church's own two settings.
//
// The whole reason this is a route and not a rules change: adoptedCourses is
// `allow write: if false` (#247) and must stay that way. A rule permissive
// enough to let two booleans through is permissive enough to let a tenant
// rewrite libraryCourseId or adoptedBy, because rules cannot express "these two
// keys and no others" against an arbitrary merge. The allow-list below IS that
// expression, server-side, in one place. firestore.rules is untouched.
// ─────────────────────────────────────────────────────────────────────────────
const QUIZ_LESSON = {
  id: 'l1', title: 'L1', duration: '5', authorId: 'a', summary: '',
  quiz: [{ id: 'q1', q: 'Q?', options: [{ id: 'a', text: 'A', correct: true }] }],
};
const withQuizzes = {
  status: 'published',
  levels: [{ id: 'lv', title: 'L', sections: [{ id: 's', title: 'S', lessons: [QUIZ_LESSON] }] }],
};
const withoutQuizzes = {
  status: 'published',
  levels: [{ id: 'lv', title: 'L', sections: [{ id: 's', title: 'S', lessons: [{ id: 'l1', title: 'L1', duration: '5', authorId: 'a', summary: '' }] }] }],
};

describe('PATCH /api/courses/adopt — per-tenant overrides', () => {
  beforeEach(() => {
    // Adopted by default: the entitlement path is exercised explicitly below.
    h.adoptionDoc = { exists: true } as any;
    h.libraryDoc = { exists: true, data: () => withQuizzes };
  });

  describe('the allowed-keys boundary', () => {
    it('accepts issueCertificate', async () => {
      const res = await PATCH(req({ ...GOOD, issueCertificate: true }, 'PATCH'));
      expect(res.status).toBe(200);
      expect(h.writes[0].data).toEqual({ issueCertificate: true });
    });

    it('accepts requireQuiz', async () => {
      const res = await PATCH(req({ ...GOOD, requireQuiz: true }, 'PATCH'));
      expect(res.status).toBe(200);
      expect(h.writes[0].data).toEqual({ requireQuiz: true });
    });

    it('REJECTS any other key — the boundary that keeps the course platform-owned', async () => {
      // THE boundary test. Removing the allow-list makes this fail.
      const res = await PATCH(req({ ...GOOD, title: 'Our own title' }, 'PATCH'));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'field_not_overridable', rejected: ['title'] });
      expect(h.writes).toHaveLength(0);
    });

    it('rejects every content field a tenant might try to claim', async () => {
      for (const key of ['title', 'description', 'levels', 'thumbnail', 'authorIds', 'category', 'status']) {
        h.writes = [];
        // Paired with a VALID override so the request cannot be refused merely
        // for being empty — the rejection has to come from the allow-list.
        const res = await PATCH(req({ ...GOOD, issueCertificate: true, [key]: 'x' }, 'PATCH'));
        expect(res.status, `${key} must be refused`).toBe(400);
        expect((await res.json()).code, `${key} must be refused BY THE ALLOW-LIST`).toBe('field_not_overridable');
        expect(h.writes).toHaveLength(0);
      }
    });

    it('rejects adoption metadata a tenant must not rewrite', async () => {
      for (const key of ['adoptedBy', 'adoptedAt', 'libraryCourseId2', 'tenantId2']) {
        h.writes = [];
        const res = await PATCH(req({ ...GOOD, issueCertificate: true, [key]: 'forged' }, 'PATCH'));
        expect(res.status, `${key} must be refused`).toBe(400);
        expect((await res.json()).code, `${key} must be refused BY THE ALLOW-LIST`).toBe('field_not_overridable');
        expect(h.writes).toHaveLength(0);
      }
    });

    it('rejects rather than silently dropping — a caller must learn it failed', async () => {
      // A filter-based allow-list would answer 200 while ignoring the field, and
      // the admin would believe they had changed something.
      const res = await PATCH(req({ ...GOOD, issueCertificate: true, title: 'x' }, 'PATCH'));
      expect(res.status).toBe(400);
      expect(h.writes).toHaveLength(0);
    });

    it('names every rejected key, not just the first', async () => {
      const res = await PATCH(req({ ...GOOD, title: 'x', levels: [] }, 'PATCH'));
      expect((await res.json()).rejected).toEqual(['title', 'levels']);
    });

    it('rejects a non-boolean value for an allowed key', async () => {
      expect((await PATCH(req({ ...GOOD, requireQuiz: 'yes' }, 'PATCH'))).status).toBe(400);
      expect((await PATCH(req({ ...GOOD, issueCertificate: 1 }, 'PATCH'))).status).toBe(400);
      expect(h.writes).toHaveLength(0);
    });

    it('400s when no override is supplied at all', async () => {
      expect((await PATCH(req(GOOD, 'PATCH'))).status).toBe(400);
    });
  });

  describe('authorisation and entitlement', () => {
    it('requires the SAME createCourses permission — no new permission', async () => {
      await PATCH(req({ ...GOOD, issueCertificate: true }, 'PATCH'));
      expect(h.requireTenantPermission).toHaveBeenCalledWith(expect.anything(), 'tenant-a', 'createCourses');
    });

    it('propagates a permission failure verbatim', async () => {
      h.requireTenantPermission.mockResolvedValue(
        NextResponse.json({ error: "Missing 'createCourses' permission" }, { status: 403 }),
      );
      const res = await PATCH(req({ ...GOOD, issueCertificate: true }, 'PATCH'));
      expect(res.status).toBe(403);
      expect(h.writes).toHaveLength(0);
    });

    it('authorises BEFORE reporting anything about the body', async () => {
      // An unauthorised caller must not learn which keys the route would accept.
      h.requireTenantPermission.mockResolvedValue(
        NextResponse.json({ error: 'Tenant admin access required' }, { status: 403 }),
      );
      const res = await PATCH(req({ ...GOOD, title: 'probe' }, 'PATCH'));
      expect(res.status).toBe(403);
      expect(await res.json()).not.toMatchObject({ code: 'field_not_overridable' });
    });

    it('REFUSES an override for a course the tenant has not adopted', async () => {
      // Matches the entitlement model #248 established: the adoption record is
      // the proof the church actually holds this course.
      h.adoptionDoc = { exists: false } as any;
      const res = await PATCH(req({ ...GOOD, issueCertificate: true }, 'PATCH'));
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'not_adopted' });
      expect(h.writes).toHaveLength(0);
    });

    it('resolves the tenant server-side and never trusts a client plan', async () => {
      const res = await PATCH(req({ ...GOOD, issueCertificate: true, plan: 'ultra' }, 'PATCH'));
      // `plan` is not an allowed key, so it is refused outright rather than read.
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('field_not_overridable');
      expect(h.writes).toHaveLength(0);
    });

    it('validates ids the same way as POST/DELETE', async () => {
      expect((await PATCH(req({ tenantId: 'tenant-a', libraryCourseId: 'a/b', requireQuiz: true }, 'PATCH'))).status).toBe(400);
      expect((await PATCH(req({ libraryCourseId: 'lib-1', requireQuiz: true }, 'PATCH'))).status).toBe(400);
      expect(h.writes).toHaveLength(0);
    });
  });

  describe('requireQuiz on a course with no quizzes', () => {
    it('is REFUSED — the setting would have no effect at all', async () => {
      // Note precisely what this prevents in THIS codebase. It is NOT an
      // unreachable-completion dead end: verifyCourseCompletion only inspects
      // lessons that HAVE a quiz, and LessonView's gate is
      // `hasQuiz && requireQuiz`, so learners are never stranded. It is a LIE —
      // the admin turns the setting on, believes members must pass a quiz, and
      // nothing whatsoever changes.
      h.libraryDoc = { exists: true, data: () => withoutQuizzes };
      const res = await PATCH(req({ ...GOOD, requireQuiz: true }, 'PATCH'));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'course_has_no_quiz' });
      expect(h.writes).toHaveLength(0);
    });

    it('is allowed when at least one lesson carries a quiz', async () => {
      h.libraryDoc = { exists: true, data: () => withQuizzes };
      expect((await PATCH(req({ ...GOOD, requireQuiz: true }, 'PATCH'))).status).toBe(200);
    });

    it('treats an EMPTY quiz array as no quiz', async () => {
      h.libraryDoc = {
        exists: true,
        data: () => ({ status: 'published', levels: [{ id: 'lv', title: 'L', sections: [{ id: 's', title: 'S', lessons: [{ ...QUIZ_LESSON, quiz: [] }] }] }] }),
      };
      expect((await PATCH(req({ ...GOOD, requireQuiz: true }, 'PATCH'))).status).toBe(409);
    });

    it('turning requireQuiz OFF is always allowed, quizzes or not', async () => {
      h.libraryDoc = { exists: true, data: () => withoutQuizzes };
      const res = await PATCH(req({ ...GOOD, requireQuiz: false }, 'PATCH'));
      expect(res.status).toBe(200);
      expect(h.writes[0].data).toEqual({ requireQuiz: false });
    });

    it('does not consult the catalogue when only issueCertificate changes', async () => {
      // No reason to spend a read on a check that cannot apply.
      h.libraryDoc = { exists: false, data: () => ({}) };
      expect((await PATCH(req({ ...GOOD, issueCertificate: true }, 'PATCH'))).status).toBe(200);
    });
  });

  describe('what gets written', () => {
    it('merges, so one toggle never clears the other or the pointer', async () => {
      await PATCH(req({ ...GOOD, issueCertificate: true }, 'PATCH'));
      expect(h.writes[0].opts).toMatchObject({ merge: true });
      expect(h.writes[0].path).toBe('tenants/tenant-a/adoptedCourses/lib-1');
      expect('libraryCourseId' in h.writes[0].data).toBe(false);
      expect('adoptedBy' in h.writes[0].data).toBe(false);
    });

    it('writes ONLY the field supplied — an absent field stays absent', async () => {
      // This is what preserves "not chosen" as distinct from "chose false".
      await PATCH(req({ ...GOOD, requireQuiz: true }, 'PATCH'));
      expect(Object.keys(h.writes[0].data)).toEqual(['requireQuiz']);
    });

    it('writes both when both are supplied', async () => {
      await PATCH(req({ ...GOOD, requireQuiz: true, issueCertificate: false }, 'PATCH'));
      expect(h.writes[0].data).toEqual({ requireQuiz: true, issueCertificate: false });
    });

    it('stores false as an ACTIVE opt-out, not as an absent field', async () => {
      await PATCH(req({ ...GOOD, issueCertificate: false }, 'PATCH'));
      expect(h.writes[0].data).toEqual({ issueCertificate: false });
    });

    it('null clears the override back to the platform default', async () => {
      const res = await PATCH(req({ ...GOOD, issueCertificate: null }, 'PATCH'));
      expect(res.status).toBe(200);
      expect(h.writes[0].data).toEqual({ issueCertificate: null });
    });

    it('writes to the tenant in the body, so two churches cannot collide', async () => {
      h.requireTenantPermission.mockResolvedValue({ ...USER, tenantId: 'tenant-b' });
      await PATCH(req({ tenantId: 'tenant-b', libraryCourseId: 'lib-1', issueCertificate: true }, 'PATCH'));
      expect(h.writes[0].path).toBe('tenants/tenant-b/adoptedCourses/lib-1');
    });
  });

  it('400s on an invalid JSON body', async () => {
    const bad = new NextRequest('https://example.com/api/courses/adopt', {
      method: 'PATCH',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: 'not json',
    });
    expect((await PATCH(bad)).status).toBe(400);
  });

  it('500s and reports to Sentry on an unexpected failure', async () => {
    h.requireTenantPermission.mockRejectedValue(new Error('boom'));
    const res = await PATCH(req({ ...GOOD, issueCertificate: true }, 'PATCH'));
    expect(res.status).toBe(500);
    expect(h.capture).toHaveBeenCalled();
  });
});

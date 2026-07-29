import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { store, mockRequireAuth, mockFileSave, mockGetSignedUrl, mockCertSet } = vi.hoisted(() => ({
  store: {
    courses: new Map<string, any>(),
    users: new Map<string, any>(),
    authors: new Map<string, any>(),
    tenants: new Map<string, any>(),
    certificates: new Map<string, any>(),
    // THE-54: the platform catalogue and the per-tenant adoption records.
    // adoptedCourses is keyed `${tenantId}/${libraryCourseId}` since it is a
    // subcollection under tenants/{tenantId}.
    libraryCourses: new Map<string, any>(),
    libraryAuthors: new Map<string, any>(),
    adoptedCourses: new Map<string, any>(),
  } as Record<string, Map<string, any>>,
  mockRequireAuth: vi.fn(),
  mockFileSave: vi.fn(),
  mockGetSignedUrl: vi.fn(),
  mockCertSet: vi.fn(),
}));

// Tracks which uid the server actually read progress for (proves token-only identity).
const { readUserIds } = vi.hoisted(() => ({ readUserIds: [] as string[] }));

function docRef(coll: string, id: string): any {
  return {
    get: async () => {
      if (coll === 'users') readUserIds.push(id);
      return { exists: store[coll].has(id), id, data: () => store[coll].get(id) };
    },
    set: async (data: any, opts: any) => {
      if (coll === 'certificates') mockCertSet(id, data, opts);
      const prev = store[coll].get(id) || {};
      store[coll].set(id, opts?.merge ? { ...prev, ...data } : data);
    },
    // Subcollection support — tenants/{tenantId}/adoptedCourses/{courseId}.
    collection: (sub: string) => ({ doc: (subId: string) => docRef(sub, `${id}/${subId}`) }),
  };
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => ({ doc: (id: string) => docRef(name, id) }) },
  getReceiptsBucket: () => ({ file: (_p: string) => ({ save: mockFileSave, getSignedUrl: mockGetSignedUrl }) }),
}));
vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));
// Resolve any hostname to a PUBLIC IP so the SSRF guard admits ordinary logo
// hosts; the guard's private-range rejection is exercised with IP-literal URLs.
vi.mock('dns/promises', () => {
  const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
  return { lookup, default: { lookup } };
});

const { POST } = await import('../route');

// ── Fixtures ─────────────────────────────────────────────────────────────────
function lesson(id: string, withQuiz = false) {
  return {
    id, title: `Lesson ${id}`, duration: '10', summary: '', authorId: 'auth-1', youtubeUrl: '',
    ...(withQuiz ? { quiz: [{ id: `${id}-q`, q: 'Q?', options: [{ id: 'a', text: 'A', correct: true }] }] } : {}),
  };
}

function seedCourse(over?: any) {
  store.courses.set('course-1', {
    title: 'Foundations of Faith', tenantId: 'tenant-a', authorIds: ['auth-1'],
    issueCertificate: true, requireQuiz: false,
    levels: [{ id: 'lv1', title: 'L1', sections: [
      { id: 's1', title: 'A', lessons: [lesson('l1'), lesson('l2', true)] },
      { id: 's2', title: 'B', lessons: [lesson('l3')] },
    ] }],
    ...over,
  });
}
const ALL = ['l1', 'l2', 'l3'];
const passAttempt = { score: 1, total: 1, passed: true, answeredAt: '2026-01-01T00:00:00Z' };

function makeReq(body: any): NextRequest {
  return new NextRequest('https://grace.theharvest.app/api/certificate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  readUserIds.length = 0;
  for (const k of Object.keys(store)) store[k].clear();
  mockGetSignedUrl.mockResolvedValue(['https://signed.example/cert.pdf']);
  mockRequireAuth.mockResolvedValue({
    uid: 'learner-1', email: 'learner@example.com', tenantId: 'tenant-a', isAdmin: false, isSuperAdmin: false,
  });
  store.users.set('learner-1', { displayName: 'Grace Learner', completedLessons: ALL, quizAttempts: { l2: passAttempt } });
  store.authors.set('auth-1', { name: 'Pastor John' });
  store.tenants.set('tenant-a', { name: 'Grace Ministry', plan: 'plus', config: {} });
  seedCourse();
});

describe('POST /api/certificate — issuance for a genuinely-completed learner', () => {
  it('returns a signed URL, stores the PDF privately, and records the cert', async () => {
    const res = await POST(makeReq({ courseId: 'course-1' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toBe('https://signed.example/cert.pdf');
    expect(data.certificateId).toBe('learner-1_course-1');
    expect(data.courseTitle).toBe('Foundations of Faith');

    // PDF saved with the right content-type (private bucket).
    expect(mockFileSave).toHaveBeenCalledTimes(1);
    expect(mockFileSave.mock.calls[0][1]).toMatchObject({ metadata: { contentType: 'application/pdf' } });
    // Signed URL is short-lived + read-only (not a public path).
    expect(mockGetSignedUrl).toHaveBeenCalledWith(expect.objectContaining({ action: 'read', version: 'v4' }));

    // Cert record written under the deterministic id with server-read fields.
    expect(mockCertSet).toHaveBeenCalledTimes(1);
    const [id, record, opts] = mockCertSet.mock.calls[0];
    expect(id).toBe('learner-1_course-1');
    expect(opts).toMatchObject({ merge: true });
    expect(record).toMatchObject({ uid: 'learner-1', courseId: 'course-1', learnerName: 'Grace Learner', teacherName: 'Pastor John' });
  });
});

describe('POST /api/certificate — forgery paths all fail', () => {
  it('refuses (403) an incomplete learner and emits no PDF', async () => {
    store.users.set('learner-1', { displayName: 'Grace', completedLessons: ['l1', 'l2'] }); // missing l3
    const res = await POST(makeReq({ courseId: 'course-1' }));
    expect(res.status).toBe(403);
    expect(mockFileSave).not.toHaveBeenCalled();
    expect(mockCertSet).not.toHaveBeenCalled();
  });

  it('ignores a client-asserted "completed" claim in the body — verifies Firestore instead', async () => {
    store.users.set('learner-1', { completedLessons: [] });
    const res = await POST(makeReq({ courseId: 'course-1', completed: true, completedLessons: ALL }));
    expect(res.status).toBe(403);
    expect(mockFileSave).not.toHaveBeenCalled();
  });

  it('with requireQuiz, an un-passed quiz lesson is refused (403)', async () => {
    seedCourse({ requireQuiz: true });
    store.users.set('learner-1', { completedLessons: ALL, quizAttempts: { l2: { score: 0, total: 1, passed: false, answeredAt: 'x' } } });
    const res = await POST(makeReq({ courseId: 'course-1' }));
    expect(res.status).toBe(403);
  });

  it('with requireQuiz, a lying passed:true (failing score) is still refused — the bar is recomputed', async () => {
    seedCourse({ requireQuiz: true });
    store.users.set('learner-1', { completedLessons: ALL, quizAttempts: { l2: { score: 0, total: 1, passed: true, answeredAt: 'x' } } });
    const res = await POST(makeReq({ courseId: 'course-1' }));
    expect(res.status).toBe(403);
  });

  it('IGNORES a client-supplied userId — identity comes only from the token', async () => {
    // The attacker HAS completed nothing; the victim (token uid) HAS completed.
    store.users.set('attacker', { completedLessons: [] });
    const res = await POST(makeReq({ courseId: 'course-1', userId: 'attacker', uid: 'attacker' }));
    expect(res.status).toBe(200); // uses token uid 'learner-1' (completed), not body 'attacker'
    // The server only ever read the token uid's progress doc.
    expect(readUserIds).toContain('learner-1');
    expect(readUserIds).not.toContain('attacker');
    const [id] = mockCertSet.mock.calls[0];
    expect(id).toBe('learner-1_course-1');
  });

  it('refuses (403) when the course does not issue certificates', async () => {
    seedCourse({ issueCertificate: false });
    const res = await POST(makeReq({ courseId: 'course-1' }));
    expect(res.status).toBe(403);
    expect(mockFileSave).not.toHaveBeenCalled();
  });

  it('refuses (403) a course belonging to another tenant', async () => {
    seedCourse({ tenantId: 'tenant-b' });
    const res = await POST(makeReq({ courseId: 'course-1' }));
    expect(res.status).toBe(403);
  });

  it('404s for a missing course', async () => {
    store.courses.clear();
    const res = await POST(makeReq({ courseId: 'nope' }));
    expect(res.status).toBe(404);
  });

  it('401s when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(makeReq({ courseId: 'course-1' }));
    expect(res.status).toBe(401);
  });

  it('400s when courseId is missing', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/certificate — idempotency', () => {
  it('re-request returns the SAME cert id, number, and issue date (no new mint)', async () => {
    const first = await POST(makeReq({ courseId: 'course-1' }));
    const a = await first.json();
    const firstIssued = a.issuedAt;
    const firstNumber = a.certificateNumber;

    // Second request — cert record now exists in the store.
    const second = await POST(makeReq({ courseId: 'course-1' }));
    const b = await second.json();
    expect(b.certificateId).toBe(a.certificateId);
    expect(b.certificateNumber).toBe(firstNumber);
    expect(b.issuedAt).toBe(firstIssued); // issue date preserved across re-issue
  });
});

describe('POST /api/certificate — tenant branding gate', () => {
  it('does NOT fetch a logo on an unbranded plan (customBranding false)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    store.tenants.set('tenant-a', { name: 'Grace', plan: 'plus', config: { logo: 'https://cdn/logo.png', primaryColor: '#8dceb8' } });
    const res = await POST(makeReq({ courseId: 'course-1' }));
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled(); // no branding → no logo fetch
    vi.unstubAllGlobals();
  });

  it('attempts the logo on a branded plan and degrades gracefully when the fetch fails', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchSpy);
    store.tenants.set('tenant-a', { name: 'Grace', plan: 'ultra', config: { logo: 'https://cdn/logo.png', primaryColor: '#8dceb8' } });
    const res = await POST(makeReq({ courseId: 'course-1' }));
    expect(res.status).toBe(200); // logo failure does NOT fail the cert
    expect(fetchSpy).toHaveBeenCalled();
    expect(mockFileSave).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('a malformed primaryColor does not break issuance', async () => {
    store.tenants.set('tenant-a', { name: 'Grace', plan: 'ultra', config: { primaryColor: 'not-a-hex' } });
    const res = await POST(makeReq({ courseId: 'course-1' }));
    expect(res.status).toBe(200);
  });

  it('SSRF guard: a logo pointed at the cloud metadata IP is NOT fetched (cert still issues)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    store.tenants.set('tenant-a', { name: 'Grace', plan: 'ultra', config: { logo: 'http://169.254.169.254/latest/meta-data/' } });
    const res = await POST(makeReq({ courseId: 'course-1' }));
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('SSRF guard: a localhost logo URL is NOT fetched', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    store.tenants.set('tenant-a', { name: 'Grace', plan: 'ultra', config: { logo: 'http://localhost:9000/logo.png' } });
    const res = await POST(makeReq({ courseId: 'course-1' }));
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE-54 — certificates for ADOPTED platform library courses.
//
// Before this, /api/certificate read only /courses. An adopted library course
// lives in /libraryCourses and is held via tenants/{t}/adoptedCourses, so every
// request for one 404'd: the learner genuinely completed the course, the button
// was there, and the certificate could never be issued.
//
// The entitlement is the ADOPTION RECORD, not the course's tenantId — a library
// course has none, and the catalogue is readable by every authenticated user by
// design, so without the adoption check any user of any church could certify any
// catalogue course their church never took.
// ─────────────────────────────────────────────────────────────────────────────

function seedLibraryCourse(over?: any) {
  store.libraryCourses.set('lib-course-1', {
    title: 'Foundations of Prayer', authorIds: ['lib-auth-1'],
    status: 'published', issueCertificate: true, requireQuiz: false,
    levels: [{ id: 'lv1', title: 'L1', sections: [
      { id: 's1', title: 'A', lessons: [lesson('L1'), lesson('L2', true)] },
    ] }],
    ...over,
  });
  store.libraryAuthors.set('lib-auth-1', { name: 'Dr Platform Teacher' });
}

function adopt(tenantId = 'tenant-a', courseId = 'lib-course-1') {
  store.adoptedCourses.set(`${tenantId}/${courseId}`, {
    libraryCourseId: courseId, adoptedBy: 'admin-uid', adoptedAt: '2026-01-01T00:00:00.000Z',
  });
}

/** Completion for the library course's own lesson ids. */
function completeLibraryCourse() {
  store.users.set('learner-1', {
    displayName: 'Grace Learner',
    completedLessons: ['L1', 'L2'],
    quizAttempts: { L2: passAttempt },
  });
}

describe('POST /api/certificate — adopted library courses', () => {
  beforeEach(() => {
    seedLibraryCourse();
    completeLibraryCourse();
    adopt();
  });

  it('issues a certificate for a completed, adopted library course', async () => {
    const res = await POST(makeReq({ courseId: 'lib-course-1' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.courseTitle).toBe('Foundations of Prayer');
    expect(data.certificateId).toBe('learner-1_lib-course-1');
  });

  it('resolves the teacher name from libraryAuthors, not the tenant authors', async () => {
    // The two are separate namespaces. Looking an adopted course's author up in
    // `authors` finds nothing and the cert silently loses its teacher name.
    store.authors.set('lib-auth-1', { name: 'WRONG — tenant author' });
    await POST(makeReq({ courseId: 'lib-course-1' }));
    const [, certData] = mockCertSet.mock.calls[0];
    expect(certData.teacherName).toBe('Dr Platform Teacher');
  });

  it("stamps the ADOPTING church's tenant on the certificate, not the platform", async () => {
    // A library course has no tenantId, so resolvedTenantId falls through to the
    // learner's tenant — the church's name and logo, subject to their plan.
    await POST(makeReq({ courseId: 'lib-course-1' }));
    const [, certData] = mockCertSet.mock.calls[0];
    expect(certData.tenantId).toBe('tenant-a');
  });

  it('still recomputes completion server-side and refuses when not met', async () => {
    store.users.set('learner-1', { displayName: 'Grace Learner', completedLessons: ['L1'], quizAttempts: {} });
    const res = await POST(makeReq({ courseId: 'lib-course-1' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Course not completed');
  });

  it('honours issueCertificate: false on a library course', async () => {
    seedLibraryCourse({ issueCertificate: false });
    const res = await POST(makeReq({ courseId: 'lib-course-1' }));
    expect(res.status).toBe(403);
  });

  it('is idempotent — the same cert number on a second request', async () => {
    const first = await POST(makeReq({ courseId: 'lib-course-1' }));
    const a = await first.json();
    const second = await POST(makeReq({ courseId: 'lib-course-1' }));
    const b = await second.json();
    expect(b.certificateNumber).toBe(a.certificateNumber);
  });

  describe('adoption is the entitlement', () => {
    it('403s when the learner\'s church has NOT adopted the course', async () => {
      store.adoptedCourses.clear();
      const res = await POST(makeReq({ courseId: 'lib-course-1' }));
      expect(res.status).toBe(403);
      expect(mockCertSet).not.toHaveBeenCalled();
    });

    it("403s when ANOTHER church adopted it but the learner's did not", async () => {
      store.adoptedCourses.clear();
      adopt('tenant-b');
      const res = await POST(makeReq({ courseId: 'lib-course-1' }));
      expect(res.status).toBe(403);
    });

    it('403s for a learner with no tenant at all', async () => {
      mockRequireAuth.mockResolvedValue({
        uid: 'learner-1', email: 'learner@example.com', tenantId: null, isAdmin: false, isSuperAdmin: false,
      });
      const res = await POST(makeReq({ courseId: 'lib-course-1' }));
      expect(res.status).toBe(403);
    });

    it('a super admin is exempt from the adoption check', async () => {
      store.adoptedCourses.clear();
      mockRequireAuth.mockResolvedValue({
        uid: 'learner-1', email: 'platform@test.com', tenantId: 'tenant-a', isAdmin: true, isSuperAdmin: true,
      });
      const res = await POST(makeReq({ courseId: 'lib-course-1' }));
      expect(res.status).toBe(200);
    });

    it('un-adopting does NOT revoke an already-issued certificate', async () => {
      // Progress and certificates are retained on un-adopt — the church loses
      // the course, the learner keeps what they earned.
      const issued = await POST(makeReq({ courseId: 'lib-course-1' }));
      expect(issued.status).toBe(200);
      expect(store.certificates.has('learner-1_lib-course-1')).toBe(true);

      store.adoptedCourses.clear();
      expect(store.certificates.get('learner-1_lib-course-1')).toBeDefined();
    });
  });

  describe('tenant courses are unaffected', () => {
    it('a tenant course still resolves from /courses and never consults the catalogue', async () => {
      store.users.set('learner-1', { displayName: 'Grace Learner', completedLessons: ALL, quizAttempts: { l2: passAttempt } });
      const res = await POST(makeReq({ courseId: 'course-1' }));
      expect(res.status).toBe(200);
      expect((await res.json()).courseTitle).toBe('Foundations of Faith');
    });

    it("a tenant course in ANOTHER tenant is still 403 — adoption cannot launder it", async () => {
      seedCourse({ tenantId: 'tenant-b' });
      store.users.set('learner-1', { displayName: 'Grace Learner', completedLessons: ALL, quizAttempts: { l2: passAttempt } });
      const res = await POST(makeReq({ courseId: 'course-1' }));
      expect(res.status).toBe(403);
    });

    it('an id in neither collection is still 404', async () => {
      const res = await POST(makeReq({ courseId: 'no-such-course' }));
      expect(res.status).toBe(404);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-tenant overrides on an adopted library course.
//
// A church decides, for THEIR audience, whether the quiz is mandatory and
// whether the course issues a certificate. The platform's values are defaults,
// not restrictions: the certificate carries the adopting church's name and logo
// (#248), and they are the ones teaching it.
//
// THIS IS A CERTIFICATE PATH. The route already fetched the adoption record to
// check entitlement, so honouring the override costs an ordinary learner nothing.
// ─────────────────────────────────────────────────────────────────────────────
function adoptWith(overrides: any, tenantId = 'tenant-a', courseId = 'lib-course-1') {
  store.adoptedCourses.set(`${tenantId}/${courseId}`, {
    libraryCourseId: courseId, adoptedBy: 'admin-uid', adoptedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

describe('POST /api/certificate — the adopting church\'s overrides', () => {
  beforeEach(() => {
    seedLibraryCourse();
    completeLibraryCourse();
  });

  describe('issueCertificate', () => {
    it('ISSUES when the platform says false and the tenant set true', async () => {
      // Reverting the route to read issueCertificate off the course document
      // makes this fail: it would 403 on the platform's false.
      seedLibraryCourse({ issueCertificate: false });
      adoptWith({ issueCertificate: true });
      const res = await POST(makeReq({ courseId: 'lib-course-1' }));
      expect(res.status).toBe(200);
      expect(mockCertSet).toHaveBeenCalledTimes(1);
    });

    it('REFUSES when the platform says true and the tenant set false', async () => {
      // The same rule the other way. A church that has opted out must not have
      // certificates issued in their name.
      seedLibraryCourse({ issueCertificate: true });
      adoptWith({ issueCertificate: false });
      const res = await POST(makeReq({ courseId: 'lib-course-1' }));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/does not issue certificates/i);
      expect(mockFileSave).not.toHaveBeenCalled();
    });

    it('falls back to the platform value when the tenant has not chosen', async () => {
      seedLibraryCourse({ issueCertificate: false });
      adoptWith({});
      expect((await POST(makeReq({ courseId: 'lib-course-1' }))).status).toBe(403);

      seedLibraryCourse({ issueCertificate: true });
      adoptWith({});
      expect((await POST(makeReq({ courseId: 'lib-course-1' }))).status).toBe(200);
    });

    it('an ABSENT override is not the same as false', async () => {
      seedLibraryCourse({ issueCertificate: true });
      adoptWith({});                       // not chosen  -> platform true  -> issue
      expect((await POST(makeReq({ courseId: 'lib-course-1' }))).status).toBe(200);
      vi.clearAllMocks();
      mockGetSignedUrl.mockResolvedValue(['https://signed.example/cert.pdf']);
      adoptWith({ issueCertificate: false }); // chosen false -> refuse
      expect((await POST(makeReq({ courseId: 'lib-course-1' }))).status).toBe(403);
    });
  });

  describe('requireQuiz', () => {
    it('REFUSES when the tenant set requireQuiz and the quiz was not passed', async () => {
      // The platform left it false; the church requires it. Completion is
      // recomputed against the church's rule, not Harvest's.
      seedLibraryCourse({ requireQuiz: false });
      adoptWith({ requireQuiz: true });
      store.users.set('learner-1', {
        displayName: 'Grace Learner', completedLessons: ['L1', 'L2'],
        quizAttempts: { L2: { score: 0, total: 1, passed: false, answeredAt: 'x' } },
      });
      const res = await POST(makeReq({ courseId: 'lib-course-1' }));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('Course not completed');
    });

    it('ISSUES when the tenant set requireQuiz and the quiz WAS passed', async () => {
      seedLibraryCourse({ requireQuiz: false });
      adoptWith({ requireQuiz: true });
      completeLibraryCourse(); // L2 quiz passed
      expect((await POST(makeReq({ courseId: 'lib-course-1' }))).status).toBe(200);
    });

    it('ISSUES when the platform requires the quiz but the tenant turned it OFF', async () => {
      // The other direction: a church that does not want the quiz gating their
      // members gets completion on lesson progress alone.
      seedLibraryCourse({ requireQuiz: true });
      adoptWith({ requireQuiz: false });
      store.users.set('learner-1', {
        displayName: 'Grace Learner', completedLessons: ['L1', 'L2'],
        quizAttempts: { L2: { score: 0, total: 1, passed: false, answeredAt: 'x' } },
      });
      expect((await POST(makeReq({ courseId: 'lib-course-1' }))).status).toBe(200);
    });

    it('a lying passed:true is STILL recomputed under a tenant override', async () => {
      // The override changes whether the bar applies, never how it is measured.
      seedLibraryCourse({ requireQuiz: false });
      adoptWith({ requireQuiz: true });
      store.users.set('learner-1', {
        displayName: 'Grace Learner', completedLessons: ['L1', 'L2'],
        quizAttempts: { L2: { score: 0, total: 1, passed: true, answeredAt: 'x' } },
      });
      expect((await POST(makeReq({ courseId: 'lib-course-1' }))).status).toBe(403);
    });
  });

  describe('overrides are per-tenant and cannot leak', () => {
    it("one church's opt-out does not affect another church's learners", async () => {
      // TWO tenants, one catalogue course, independent adoption records.
      seedLibraryCourse({ issueCertificate: true });
      adoptWith({ issueCertificate: false }, 'tenant-a');
      adoptWith({ issueCertificate: true }, 'tenant-b');

      // Learner in tenant-a: their church opted out.
      expect((await POST(makeReq({ courseId: 'lib-course-1' }))).status).toBe(403);

      // Learner in tenant-b: unaffected.
      mockRequireAuth.mockResolvedValue({
        uid: 'learner-1', email: 'learner@example.com', tenantId: 'tenant-b', isAdmin: false, isSuperAdmin: false,
      });
      expect((await POST(makeReq({ courseId: 'lib-course-1' }))).status).toBe(200);
    });

    it('reads the override from the LEARNER\'s own tenant record', async () => {
      seedLibraryCourse({ issueCertificate: false });
      adoptWith({ issueCertificate: true }, 'tenant-b'); // a different church
      adoptWith({}, 'tenant-a');                          // the learner's, unset
      // tenant-b's opt-in must not reach tenant-a's learner.
      expect((await POST(makeReq({ courseId: 'lib-course-1' }))).status).toBe(403);
    });

    it('a TENANT course is unaffected — no adoption record, no override', async () => {
      store.users.set('learner-1', { displayName: 'Grace Learner', completedLessons: ALL, quizAttempts: { l2: passAttempt } });
      seedCourse({ issueCertificate: true });
      adoptWith({ issueCertificate: false }); // for the LIBRARY course, not this one
      expect((await POST(makeReq({ courseId: 'course-1' }))).status).toBe(200);
    });
  });

  it('a super admin sees the same answer the church\'s own members would', async () => {
    // Super admins skip the entitlement check, but not the override — otherwise
    // they would be issued a certificate their church's members are refused,
    // which is exactly the cross-context disagreement this bug class produces.
    seedLibraryCourse({ issueCertificate: true });
    adoptWith({ issueCertificate: false });
    mockRequireAuth.mockResolvedValue({
      uid: 'learner-1', email: 'platform@test.com', tenantId: 'tenant-a', isAdmin: true, isSuperAdmin: true,
    });
    expect((await POST(makeReq({ courseId: 'lib-course-1' }))).status).toBe(403);
  });
});

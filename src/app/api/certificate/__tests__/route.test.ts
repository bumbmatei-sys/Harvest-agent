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
  };
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => ({ doc: (id: string) => docRef(name, id) }) },
  getReceiptsBucket: () => ({ file: (_p: string) => ({ save: mockFileSave, getSignedUrl: mockGetSignedUrl }) }),
}));
vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));

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
});

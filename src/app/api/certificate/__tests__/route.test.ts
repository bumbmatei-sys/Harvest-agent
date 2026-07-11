import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockRequireAuth, mockSave, mockGetSignedUrl, mockFetch } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockSave: vi.fn().mockResolvedValue(undefined),
  mockGetSignedUrl: vi.fn().mockResolvedValue(['https://signed.example/cert.pdf?token=abc']),
  mockFetch: vi.fn(),
}));

// In-memory Firestore: store[collection][docId] = data (or undefined = missing).
// certSet records writes to certificates/{id} so we can assert idempotency.
const store: Record<string, Record<string, any>> = {};
const certSet = vi.fn();

function seed(collection: string, id: string, data: any) {
  store[collection] = store[collection] || {};
  store[collection][id] = data;
}

function docRef(collection: string, id: string) {
  return {
    get: async () => {
      const data = store[collection]?.[id];
      return { exists: data !== undefined, id, data: () => data };
    },
    set: async (data: any, opts: any) => {
      if (collection === 'certificates') {
        certSet(id, data, opts);
        // Persist so a re-request in the same test sees the prior issuedAt.
        store.certificates = store.certificates || {};
        store.certificates[id] = { ...(store.certificates[id] || {}), ...data };
      }
    },
  };
}

vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => ({ doc: (id: string) => docRef(name, id) }) },
  getReceiptsBucket: () => ({
    file: (_path: string) => ({ save: mockSave, getSignedUrl: mockGetSignedUrl }),
  }),
}));

// Avoid pulling client firebase in via tenant-scope.
vi.mock('@/utils/tenant-scope', () => ({ PLATFORM_TENANT_ID: 'harvest' }));

const { POST } = await import('../route');

// ── Fixtures ─────────────────────────────────────────────────────────────────
const COURSE_ID = 'course-1';
const UID = 'learner-uid';

// 1x1 transparent PNG (valid bytes so pdf-lib embedPng succeeds).
const PNG_1x1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
);

function lesson(id: string, withQuiz = false) {
  return {
    id, title: `Lesson ${id}`, duration: '5 min', authorId: 'a1', summary: '',
    ...(withQuiz ? { quiz: [{ id: 'q1', q: 'Q?', options: [{ id: 'o1', text: 'A', correct: true }] }] } : {}),
  };
}

function course(overrides: any = {}) {
  return {
    title: 'Foundations of Faith',
    tenantId: 'tenant-a',
    issueCertificate: true,
    requireQuiz: false,
    authorIds: ['a1'],
    levels: [{ id: 'lv1', title: 'L1', sections: [{ id: 's1', title: '', lessons: [lesson('L1'), lesson('L2')] }] }],
    ...overrides,
  };
}

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/certificate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: 'Bearer tok' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(store)) delete store[k];
  mockRequireAuth.mockResolvedValue({ uid: UID, email: 'learner@test.com', tenantId: 'tenant-a', isSuperAdmin: false });
  mockGetSignedUrl.mockResolvedValue(['https://signed.example/cert.pdf?token=abc']);
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);

  // Default happy-path world: an author, a non-branding tenant, no prior cert.
  seed('authors', 'a1', { name: 'Pastor Grace' });
  seed('tenants', 'tenant-a', { name: 'Tenant A', plan: 'pro', config: {} }); // pro → customBranding false
  seed('courses', COURSE_ID, course());
  seed('users', UID, { displayName: 'Jane Learner', completedLessons: ['L1', 'L2'], quizAttempts: {} });
});

describe('POST /api/certificate — completion is server-verified', () => {
  it('issues a PDF + signed URL for a genuinely completed course', async () => {
    const res = await POST(makeRequest({ courseId: COURSE_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('https://signed.example/cert.pdf?token=abc');
    expect(body.certId).toBe(`${UID}_${COURSE_ID}`);
    expect(body.courseTitle).toBe('Foundations of Faith');
    // A real PDF was stored privately (Buffer starting with %PDF), not returned inline.
    const savedBuf = mockSave.mock.calls[0][0] as Buffer;
    expect(savedBuf.slice(0, 4).toString()).toBe('%PDF');
    expect(mockGetSignedUrl).toHaveBeenCalledOnce();
  });

  it('REFUSES (403) when a lesson is not completed', async () => {
    seed('users', UID, { displayName: 'Jane', completedLessons: ['L1'], quizAttempts: {} });
    const res = await POST(makeRequest({ courseId: COURSE_ID }));
    expect(res.status).toBe(403);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('REFUSES (403) when the course does not issue certificates', async () => {
    seed('courses', COURSE_ID, course({ issueCertificate: false }));
    const res = await POST(makeRequest({ courseId: COURSE_ID }));
    expect(res.status).toBe(403);
  });

  it('returns 404 for a missing course and 400 for a missing courseId', async () => {
    expect((await POST(makeRequest({ courseId: 'nope' }))).status).toBe(404);
    expect((await POST(makeRequest({}))).status).toBe(400);
  });
});

describe('POST /api/certificate — quiz gate reuses Step 3 logic', () => {
  it('REFUSES when requireQuiz and a quiz lesson has no passing attempt', async () => {
    seed('courses', COURSE_ID, course({
      requireQuiz: true,
      levels: [{ id: 'lv1', title: 'L1', sections: [{ id: 's1', title: '', lessons: [lesson('L1', true), lesson('L2')] }] }],
    }));
    // Both lessons "completed" but the quiz on L1 was failed (below threshold).
    seed('users', UID, { completedLessons: ['L1', 'L2'], quizAttempts: { L1: { score: 0, total: 1, passed: false, answeredAt: '' } } });
    const res = await POST(makeRequest({ courseId: COURSE_ID }));
    expect(res.status).toBe(403);
  });

  it('REFUSES even when a forged passed=true flag has a failing score', async () => {
    seed('courses', COURSE_ID, course({
      requireQuiz: true,
      levels: [{ id: 'lv1', title: 'L1', sections: [{ id: 's1', title: '', lessons: [lesson('L1', true), lesson('L2')] }] }],
    }));
    // score 0/1 but passed:true — server recomputes via isQuizPassing and rejects.
    seed('users', UID, { completedLessons: ['L1', 'L2'], quizAttempts: { L1: { score: 0, total: 1, passed: true, answeredAt: '' } } });
    const res = await POST(makeRequest({ courseId: COURSE_ID }));
    expect(res.status).toBe(403);
  });

  it('ISSUES when requireQuiz and every quiz lesson passed', async () => {
    seed('courses', COURSE_ID, course({
      requireQuiz: true,
      levels: [{ id: 'lv1', title: 'L1', sections: [{ id: 's1', title: '', lessons: [lesson('L1', true), lesson('L2')] }] }],
    }));
    seed('users', UID, { completedLessons: ['L1', 'L2'], quizAttempts: { L1: { score: 1, total: 1, passed: true, answeredAt: '' } } });
    const res = await POST(makeRequest({ courseId: COURSE_ID }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/certificate — identity & idempotency', () => {
  it('ignores a client-supplied userId and keys the cert to the token uid', async () => {
    // The attacker seeds a "completed" doc for someone else — but the route only
    // reads the TOKEN uid's doc, which is fully completed, so the cert is theirs.
    seed('users', 'victim', { completedLessons: [], quizAttempts: {} });
    const res = await POST(makeRequest({ courseId: COURSE_ID, userId: 'victim', uid: 'victim' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.certId).toBe(`${UID}_${COURSE_ID}`); // token uid, not 'victim'
  });

  it('is idempotent: re-request returns the same certId and preserves issuedAt', async () => {
    const first = await (await POST(makeRequest({ courseId: COURSE_ID }))).json();
    const second = await (await POST(makeRequest({ courseId: COURSE_ID }))).json();
    expect(second.certId).toBe(first.certId);
    expect(second.issuedAt).toBe(first.issuedAt); // stable, not re-minted
    expect(second.certNumber).toBe(first.certNumber);
  });

  it('refuses a course from another tenant', async () => {
    seed('courses', COURSE_ID, course({ tenantId: 'tenant-b' }));
    const res = await POST(makeRequest({ courseId: COURSE_ID }));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/certificate — tenant branding is plan-gated', () => {
  it('does NOT fetch a logo when the tenant plan lacks customBranding (pro)', async () => {
    seed('tenants', 'tenant-a', { name: 'Tenant A', plan: 'pro', config: { logo: 'https://cdn/logo.png', primaryColor: '#8dceb8' } });
    const res = await POST(makeRequest({ courseId: COURSE_ID }));
    expect(res.status).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches + embeds the logo when the plan HAS customBranding (max)', async () => {
    seed('tenants', 'tenant-a', { name: 'Grace Ministry', plan: 'max', config: { logo: 'https://cdn/logo.png', primaryColor: '#8dceb8' } });
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => PNG_1x1.buffer,
    });
    const res = await POST(makeRequest({ courseId: COURSE_ID }));
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith('https://cdn/logo.png', expect.anything());
  });

  it('does NOT fetch a logo pointed at an internal/loopback host (SSRF guard)', async () => {
    seed('tenants', 'tenant-a', { name: 'Grace Ministry', plan: 'max', config: { logo: 'http://169.254.169.254/latest/meta-data', primaryColor: '#8dceb8' } });
    const res = await POST(makeRequest({ courseId: COURSE_ID }));
    expect(res.status).toBe(200); // still issues, just without the blocked logo
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('degrades gracefully when the logo fetch fails (still issues the cert)', async () => {
    seed('tenants', 'tenant-a', { name: 'Grace Ministry', plan: 'ultra', config: { logo: 'https://cdn/broken.png', primaryColor: 'not-a-hex' } });
    mockFetch.mockRejectedValue(new Error('network down'));
    const res = await POST(makeRequest({ courseId: COURSE_ID }));
    expect(res.status).toBe(200); // malformed color + failed logo → neutral, no crash
    expect(mockSave).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRequireAdmin, mockGet, mockWhere, mockLimit, mockCollection, mockCapture } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockLimit = vi.fn(() => ({ get: mockGet }));
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockCollection = vi.fn(() => ({ where: mockWhere }));
  return {
    mockRequireAdmin: vi.fn(),
    mockGet, mockWhere, mockLimit, mockCollection,
    mockCapture: vi.fn(),
  };
});

vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: mockCollection } }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: mockCapture }));

const { GET } = await import('../contact-activities/route');

/** A Timestamp-alike that satisfies both tsMillis() (toMillis) and the route's serializer (toDate). */
function ts(iso: string) {
  const d = new Date(iso);
  return { toDate: () => d, toMillis: () => d.getTime() };
}

function makeReq(qs = '?contactId=G6c04DRQwp2ngo6G9d6K'): NextRequest {
  return new NextRequest(`https://example.com/api/crm/contact-activities${qs}`, {
    headers: { authorization: 'Bearer token' },
  });
}

function mockUser(overrides: object = {}) {
  return { uid: 'u1', email: 'bumbmatei@gmail.com', tenantId: 'bumb', isAdmin: true, isSuperAdmin: false, ...overrides };
}

function snapshot(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return { docs: docs.map(d => ({ id: d.id, data: () => d.data })) };
}

/** The production acceptance case: 5 activities on one contact, all tenant `bumb`. */
const FIVE_ACTIVITIES = [
  { id: 'a1', data: { contactId: 'G6c04DRQwp2ngo6G9d6K', tenantId: 'bumb', type: 'donation', description: 'Gift', amount: 50, createdAt: ts('2026-01-01T00:00:00Z'), createdBy: 'sys' } },
  { id: 'a2', data: { contactId: 'G6c04DRQwp2ngo6G9d6K', tenantId: 'bumb', type: 'donation', description: 'Gift', amount: 25, createdAt: ts('2026-02-01T00:00:00Z'), createdBy: 'sys' } },
  { id: 'a3', data: { contactId: 'G6c04DRQwp2ngo6G9d6K', tenantId: 'bumb', type: 'note', description: 'Called', amount: null, createdAt: ts('2026-03-01T00:00:00Z'), createdBy: 'u1' } },
  { id: 'a4', data: { contactId: 'G6c04DRQwp2ngo6G9d6K', tenantId: 'bumb', type: 'meeting', description: 'Coffee', amount: null, createdAt: ts('2026-04-01T00:00:00Z'), createdBy: 'u1' } },
  { id: 'a5', data: { contactId: 'G6c04DRQwp2ngo6G9d6K', tenantId: 'bumb', type: 'note', description: 'Follow up', amount: null, createdAt: ts('2026-05-01T00:00:00Z'), createdBy: 'u1' } },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockLimit.mockReturnValue({ get: mockGet });
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockCollection.mockReturnValue({ where: mockWhere });
});

describe('GET /api/crm/contact-activities', () => {
  it('returns 401 when unauthenticated', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(mockCollection).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin (requireAdmin gate)', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Admin access required' }, { status: 403 }));
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    expect(mockCollection).not.toHaveBeenCalled();
  });

  it('returns 400 without a contactId', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    const res = await GET(makeReq(''));
    expect(res.status).toBe(400);
    expect(mockCollection).not.toHaveBeenCalled();
  });

  it('returns 403 for an admin with no tenant', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ tenantId: null }));
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    expect(mockCollection).not.toHaveBeenCalled();
  });

  // ── The acceptance test: contact G6c04DRQwp2ngo6G9d6K must show 5 ──
  it('returns all 5 activities for the contact, newest first', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    mockGet.mockResolvedValue(snapshot(FIVE_ACTIVITIES));

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.activities).toHaveLength(5);
    expect(body.activities.map((a: { id: string }) => a.id)).toEqual(['a5', 'a4', 'a3', 'a2', 'a1']);
    // Timestamps survive JSON as ISO strings, which toSafeDate()/tsMillis() handle.
    expect(body.activities[0].createdAt).toBe('2026-05-01T00:00:00.000Z');
    expect(body.activities[0].description).toBe('Follow up');
    expect(body.activities[3].amount).toBe(25);
  });

  it('runs the same single-field query with the same limit(200)', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    mockGet.mockResolvedValue(snapshot(FIVE_ACTIVITIES));
    await GET(makeReq());
    expect(mockCollection).toHaveBeenCalledWith('contactActivities');
    expect(mockWhere).toHaveBeenCalledWith('contactId', '==', 'G6c04DRQwp2ngo6G9d6K');
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockLimit).toHaveBeenCalledWith(200);
  });

  // ── Tenant isolation ──
  it('never leaks another tenant\'s activities for the same contactId', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ tenantId: 'bumb' }));
    mockGet.mockResolvedValue(snapshot([
      ...FIVE_ACTIVITIES,
      { id: 'other', data: { contactId: 'G6c04DRQwp2ngo6G9d6K', tenantId: 'someone-else', type: 'note', description: 'SECRET', amount: null, createdAt: ts('2026-06-01T00:00:00Z'), createdBy: 'x' } },
    ]));

    const body = await (await GET(makeReq())).json();
    expect(body.activities).toHaveLength(5);
    expect(JSON.stringify(body)).not.toContain('SECRET');
    expect(JSON.stringify(body)).not.toContain('someone-else');
  });

  it('returns [] — never another tenant\'s rows — when asked for a foreign contact', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ tenantId: 'bumb' }));
    mockGet.mockResolvedValue(snapshot([
      { id: 'x1', data: { contactId: 'foreign-contact', tenantId: 'other-tenant', type: 'note', description: 'SECRET', amount: null, createdAt: ts('2026-01-01T00:00:00Z'), createdBy: 'x' } },
    ]));
    const body = await (await GET(makeReq('?contactId=foreign-contact'))).json();
    expect(body.activities).toEqual([]);
  });

  it('IGNORES a client-supplied tenantId — scope comes from the token only', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ tenantId: 'bumb' }));
    mockGet.mockResolvedValue(snapshot([
      ...FIVE_ACTIVITIES,
      { id: 'other', data: { contactId: 'G6c04DRQwp2ngo6G9d6K', tenantId: 'victim-tenant', type: 'note', description: 'SECRET', amount: null, createdAt: ts('2026-06-01T00:00:00Z'), createdBy: 'x' } },
    ]));

    const body = await (await GET(makeReq('?contactId=G6c04DRQwp2ngo6G9d6K&tenantId=victim-tenant'))).json();
    expect(body.activities).toHaveLength(5);
    expect(JSON.stringify(body)).not.toContain('victim-tenant');
  });

  it('leaves a super admin unscoped (platform CRM view)', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ tenantId: null, isSuperAdmin: true }));
    mockGet.mockResolvedValue(snapshot([
      ...FIVE_ACTIVITIES,
      { id: 'legacy', data: { contactId: 'G6c04DRQwp2ngo6G9d6K', type: 'note', description: 'no tenantId', amount: null, createdAt: ts('2025-01-01T00:00:00Z'), createdBy: 'x' } },
    ]));
    const body = await (await GET(makeReq())).json();
    expect(body.activities).toHaveLength(6);
  });

  // ── Failures are reported, never rendered as "empty" ──
  it('returns 500 and reports to Sentry when the read throws', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    mockGet.mockRejectedValue(new Error('boom'));

    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.activities).toBeUndefined();
    expect(body.error).toBeTruthy();
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'crm-contact-activities-read', tenantId: 'bumb' }),
    );
  });
});

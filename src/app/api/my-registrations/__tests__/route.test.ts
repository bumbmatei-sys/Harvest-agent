import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockRequireAuth, mockWhere } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockWhere: vi.fn(),
}));

// mockCollGet answers the registrations queries (userId, then email); mockDocGet
// answers the per-event joins.
const { mockCollGet, mockDocGet } = vi.hoisted(() => ({
  mockCollGet: vi.fn(),
  mockDocGet: vi.fn(),
}));

function makeCollRef(): any {
  const coll: any = {
    doc: vi.fn(() => makeDocRef()),
    get: mockCollGet,
    limit: vi.fn(() => coll),
  };
  coll.where = (...args: unknown[]) => { mockWhere(...args); return coll; };
  return coll;
}
function makeDocRef(): any {
  return { get: mockDocGet, collection: vi.fn(() => makeCollRef()) };
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => makeCollRef()) },
}));
vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));

const { GET } = await import('../route');

function makeRequest(tenantId?: string): NextRequest {
  const url = tenantId
    ? `https://grace.theharvest.app/api/my-registrations?tenantId=${tenantId}`
    : 'https://grace.theharvest.app/api/my-registrations';
  return new NextRequest(url, { method: 'GET' });
}

// Firestore doc-snapshot shim.
const doc = (id: string, data: object) => ({ id, data: () => data });

const EVENTS: Record<string, object> = {
  e1: { title: 'Gala', startDate: { toMillis: () => 1111 }, location: 'Main Hall', isOnline: false, status: 'published' },
  e3: { title: 'Retreat', startDate: { toMillis: () => 3333 }, location: null, isOnline: true, status: 'published' },
  e5: { title: 'Legacy Night', startDate: { toMillis: () => 5555 }, location: 'Annex', isOnline: false, status: 'published' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ uid: 'user_9', email: 'Sam@Example.com' });
});

describe('GET /api/my-registrations', () => {
  it('returns confirmed + waitlisted tickets, dedupes userId/email overlap, and excludes pending/expired', async () => {
    // byUid query (confirmed free reg + a pending reg that must be excluded)
    mockCollGet.mockResolvedValueOnce({
      docs: [
        doc('r1', { eventId: 'e1', ticketCode: 'AAA', status: 'confirmed', ticketTypeName: 'GA', waitlisted: false, amount: 0 }),
        doc('r2', { eventId: 'e2', ticketCode: 'PPP', status: 'pending_payment', amount: 5000 }),
      ],
    });
    // byEmail query (same r1 dupe + a waitlisted reg + an expired reg to drop)
    mockCollGet.mockResolvedValueOnce({
      docs: [
        doc('r1', { eventId: 'e1', ticketCode: 'AAA', status: 'confirmed', ticketTypeName: 'GA', waitlisted: false, amount: 0 }),
        doc('r3', { eventId: 'e3', ticketCode: 'WWW', status: 'waitlisted', ticketTypeName: 'GA', waitlisted: true, amount: 0 }),
        doc('r4', { eventId: 'e4', ticketCode: 'XXX', status: 'expired', amount: 5000 }),
      ],
    });
    // event joins, in eventIds order [e1, e3]
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => EVENTS.e1 })
      .mockResolvedValueOnce({ exists: true, data: () => EVENTS.e3 });

    const res = await GET(makeRequest('t1'));
    expect(res.status).toBe(200);
    const { tickets } = await res.json();

    // Only r1 (confirmed) + r3 (waitlisted); r2 pending & r4 expired excluded; r1 deduped.
    expect(tickets).toHaveLength(2);
    const byId = Object.fromEntries(tickets.map((t: any) => [t.id, t]));
    expect(byId.r1).toMatchObject({ ticketCode: 'AAA', status: 'confirmed', event: { title: 'Gala', startMillis: 1111 } });
    expect(byId.r3).toMatchObject({ ticketCode: 'WWW', status: 'waitlisted', event: { title: 'Retreat', isOnline: true } });
    expect(tickets.find((t: any) => t.status === 'pending_payment')).toBeUndefined();
    expect(tickets.find((t: any) => t.status === 'expired')).toBeUndefined();
  });

  it('matches a legacy userId:null reg by the email fallback (lowercased)', async () => {
    mockCollGet.mockResolvedValueOnce({ docs: [] }); // byUid — no uid link yet
    mockCollGet.mockResolvedValueOnce({
      docs: [doc('r5', { eventId: 'e5', ticketCode: 'LEG', status: 'confirmed', ticketTypeName: 'GA', waitlisted: false, amount: 0, userId: null })],
    });
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => EVENTS.e5 });

    const res = await GET(makeRequest('t1'));
    expect(res.status).toBe(200);
    const { tickets } = await res.json();
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ ticketCode: 'LEG', status: 'confirmed' });

    // The email fallback queries with the token email LOWERCASED.
    expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'user_9');
    expect(mockWhere).toHaveBeenCalledWith('email', '==', 'sam@example.com');
  });

  it('includes a free ($0) confirmed reg', async () => {
    mockCollGet.mockResolvedValueOnce({
      docs: [doc('r6', { eventId: 'e1', ticketCode: 'FREE1', status: 'confirmed', ticketTypeName: 'Free', waitlisted: false, amount: 0 })],
    });
    mockCollGet.mockResolvedValueOnce({ docs: [] });
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => EVENTS.e1 });

    const res = await GET(makeRequest('t1'));
    const { tickets } = await res.json();
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ ticketCode: 'FREE1', amount: 0 });
  });

  it('400s when tenantId is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
  });

  it('401s when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await GET(makeRequest('t1'));
    expect(res.status).toBe(401);
  });
});

describe('r9.3 recurring ticket times', () => {
  it('returns distinct run dates and DST-adjusted start/end instants, retaining single-event times', async () => {
    const ts = (value: string) => ({ toMillis: () => new Date(value).getTime() });
    mockCollGet.mockResolvedValueOnce({ docs: [
      doc('spring-before', { eventId: 'series', runDate: '2031-03-23', status: 'confirmed', amount: 0 }),
      doc('spring-after', { eventId: 'series', runDate: '2031-03-30', status: 'confirmed', amount: 0 }),
      doc('single', { eventId: 'e1', status: 'confirmed', amount: 0 }),
    ] }).mockResolvedValueOnce({ docs: [] });
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({
      title: 'Weekly', startDate: ts('2031-03-23T18:00:00Z'), endDate: ts('2031-03-23T19:00:00Z'),
      timeZone: 'Europe/Berlin', recurrence: { freq: 'weekly', count: 2 },
    }) }).mockResolvedValueOnce({ exists: true, data: () => EVENTS.e1 });
    const response = await GET(makeRequest('t1'));
    expect(response.status).toBe(200);
    const { tickets } = await response.json();
    expect(tickets).toHaveLength(3);
    expect(tickets[0]).toMatchObject({ runDate: '2031-03-23', event: { startMillis: Date.UTC(2031, 2, 23, 18), endMillis: Date.UTC(2031, 2, 23, 19) } });
    expect(tickets[1]).toMatchObject({ runDate: '2031-03-30', event: { startMillis: Date.UTC(2031, 2, 30, 17), endMillis: Date.UTC(2031, 2, 30, 18) } });
    expect(tickets[2]).toMatchObject({ runDate: null, event: { startMillis: 1111 } });
  });
});

describe('#556 review r12 — a cancelled run keeps its date', () => {
  it('dates a cancelled run ticket at its scheduled instant and marks it cancelled', async () => {
    const ts = (value: string) => ({ toMillis: () => new Date(value).getTime() });
    mockCollGet.mockResolvedValueOnce({ docs: [
      doc('kept', { eventId: 'series', runDate: '2031-03-23', status: 'confirmed', amount: 0 }),
      doc('cancelled-run', { eventId: 'series', runDate: '2031-03-30', status: 'confirmed', amount: 0 }),
    ] }).mockResolvedValueOnce({ docs: [] });
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({
      title: 'Weekly', status: 'published', startDate: ts('2031-03-23T18:00:00Z'), endDate: ts('2031-03-23T19:00:00Z'),
      timeZone: 'Europe/Berlin', recurrence: { freq: 'weekly', count: 2, cancelledRuns: ['2031-03-30'] },
    }) });
    const { tickets } = await (await GET(makeRequest('t1'))).json();
    const cancelled = tickets.find((t: { runDate: string }) => t.runDate === '2031-03-30');
    expect(cancelled.event).toMatchObject({ status: 'cancelled', startMillis: Date.UTC(2031, 2, 30, 17), endMillis: Date.UTC(2031, 2, 30, 18) });
    expect(tickets.find((t: { runDate: string }) => t.runDate === '2031-03-23').event.status).toBe('published');
  });
});

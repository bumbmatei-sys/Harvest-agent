import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const state = vi.hoisted(() => ({
  docs: new Map<string, any>(), queries: [] as string[],
  send: vi.fn(), permission: vi.fn(), readError: false, failSentMarker: false,
}));
function ref(path: string): any {
  return {
    id: path.split('/').pop(), path,
    collection: (key: string) => ref(`${path}/${key}`), doc: (key: string) => ref(`${path}/${key}`),
    where: (key: string, _op: string, value: string) => ({ get: async () => {
      state.queries.push(path);
      if (state.readError) throw new Error('Read failed');
      return { docs: [...state.docs].filter(([p, data]) => p.startsWith(`${path}/`) && data[key] === value)
        .map(([p, data]) => ({ id: p.split('/').pop(), data: () => data, ref: ref(p) })) };
    } }),
    get: async () => ({ exists: state.docs.has(path), data: () => state.docs.get(path) }),
    update: async (data: Record<string, any>) => {
      if (state.failSentMarker && data.sentAt) throw new Error('Marker write failed');
      const next = { ...state.docs.get(path) };
      for (const [key, value] of Object.entries(data)) {
        if (key === 'cancellationNotice.sentAt') next.cancellationNotice = { ...next.cancellationNotice, sentAt: value };
        else next[key] = value;
      }
      state.docs.set(path, next);
    },
  };
}
// Transactions serialize and stage writes, so concurrent retries see committed markers.
let tail: Promise<unknown> = Promise.resolve();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {
  collection: (key: string) => ref(key),
  runTransaction: (work: (tx: any) => Promise<unknown>) => {
    const result = tail.then(async () => {
      const writes: Array<() => Promise<void>> = [];
      const value = await work({ get: (r: any) => r.get(), update: (r: any, data: any) => writes.push(() => r.update(data)), set: (r: any, data: any) => writes.push(() => r.update(data)) });
      for (const write of writes) await write();
      return value;
    });
    tail = result.catch(() => {});
    return result;
  },
} }));
vi.mock('@/lib/api-auth', () => ({ requireTenantPermission: state.permission }));
vi.mock('@/lib/transactional-email', () => ({ sendTransactionalEmail: state.send }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'SERVER_TS' } }));
const { GET, POST } = await import('../route');
const eventPath = 'tenants/t1/events/e1';
const noticePath = (id: string) => `tenants/t1/eventCancellationNotices/${id}`;
const rowPath = (id: string) => `tenants/t1/registrations/${id}`;
const event = () => ({ title: 'Gathering', status: 'published', createdBy: 'creator', timeZone: 'Europe/Berlin',
  startDate: { toDate: () => new Date('2031-03-23T09:00:00Z') }, recurrence: { freq: 'weekly', count: 3 } });
const request = (runDate?: string) => new NextRequest('https://example.test/api/events/cancel', {
  method: 'POST', body: JSON.stringify({ tenantId: 't1', eventId: 'e1', ...(runDate ? { runDate } : {}) }),
});
beforeEach(() => {
  state.docs.clear(); state.queries = []; state.readError = false; state.failSentMarker = false;
  state.send.mockReset().mockResolvedValue({ ok: true }); state.permission.mockReset().mockResolvedValue({ uid: 'admin' });
  state.docs.set(eventPath, event());
  state.docs.set('users/admin', { tenantId: 't1' });
  state.docs.set('tenants/t1', { ownerId: 'owner' });
  state.docs.set('users/owner', { email: 'owner@example.test' });
  for (const [id, runDate, status, amount] of [
    ['a', '2031-03-23', 'confirmed', 5000], ['b', '2031-03-23', 'waitlisted', 0],
    ['c', '2031-03-30', 'confirmed', 0], ['d', '2031-03-23', 'attended', 5000],
    ['e', '2031-03-23', 'pending_payment', 5000], ['f', '2031-03-23', 'cancelled', 0],
  ]) state.docs.set(rowPath(String(id)), { eventId: 'e1', runDate, status, amount, ...(id === 'a' ? { paymentStatus: 'confirmed' } : {}), email: `${id}@example.test` });
  state.docs.set('tenants/t2/registrations/other', { eventId: 'e1', status: 'confirmed', email: 'other@example.test' });
});
afterEach(() => vi.useRealTimers());

describe('event cancellation notices', () => {
  it('cancels and emails only confirmed/waitlisted registrations for the chosen run, once', async () => {
    expect((await POST(request('2031-03-23'))).status).toBe(200);
    expect(state.send.mock.calls.map(([notice]) => notice.to)).toEqual(['a@example.test', 'b@example.test']);
    for (const id of ['a', 'b']) expect(state.docs.get(rowPath(id))).toMatchObject({
      status: 'cancelled', cancelledAt: 'SERVER_TS', cancellationReason: 'event_cancelled',
    });
    expect(state.docs.get(noticePath('a'))).toMatchObject({ sentAt: 'SERVER_TS', attempts: 1 });
    expect(state.docs.get(rowPath('a')).refundStatus).toBe('pending_manual');
    expect(state.docs.get(rowPath('b')).refundStatus).toBeUndefined();
    expect(state.docs.get(rowPath('c')).status).toBe('confirmed');
    expect(state.docs.get(rowPath('d')).status).toBe('attended');
    expect(state.docs.get(rowPath('e')).status).toBe('pending_payment');
    expect(state.docs.get(eventPath)).toMatchObject({ status: 'published', recurrence: { cancelledRuns: ['2031-03-23'] } });
    const notice = state.send.mock.calls[0][0];
    expect(notice.idempotencyKey).toMatch(/^event-cancel-[a-f0-9]{64}$/);
    expect(notice.text).toContain('2031-03-23 is cancelled');
    expect(notice.text).toContain('owner@example.test');
    expect(notice.text).toContain('about any refund');
    expect(notice.replyTo).toBe('owner@example.test');
    expect((await POST(request('2031-03-23'))).status).toBe(200);
    expect(state.send).toHaveBeenCalledTimes(2);
    expect(state.docs.get(eventPath).recurrence.cancelledRuns).toEqual(['2031-03-23']);
  });
  it('cancels all dates, including remaining notices after an individually cancelled run', async () => {
    await POST(request('2031-03-23'));
    expect((await POST(request())).status).toBe(200);
    expect(state.docs.get(eventPath).status).toBe('cancelled');
    expect(state.send.mock.calls.map(([notice]) => notice.to)).toEqual(['a@example.test', 'b@example.test', 'c@example.test']);
    await POST(request());
    expect(state.send).toHaveBeenCalledTimes(3);
    expect(state.docs.get('tenants/t2/registrations/other').status).toBe('confirmed');
  });
  it('handles one-off events and uses an explicit organizer contact', async () => {
    state.docs.set(eventPath, { ...event(), recurrence: null, organizerEmail: 'organizer@example.test' });
    state.docs.set(rowPath('single'), { eventId: 'e1', status: 'confirmed', email: 'single@example.test', amount: 2500 });
    expect((await POST(request())).status).toBe(200);
    expect(state.docs.get(rowPath('single')).status).toBe('cancelled');
    expect(state.send.mock.calls.every(([notice]) => notice.replyTo === 'organizer@example.test')).toBe(true);
  });
  it('shows an exact uncapped preview and does not mutate or send', async () => {
    for (let i = 0; i < 510; i++) state.docs.set(rowPath(`extra${i}`), { eventId: 'e1', runDate: '2031-03-23', status: 'confirmed' });
    const response = await GET(new NextRequest('https://example.test/api/events/cancel?tenantId=t1&eventId=e1&runDate=2031-03-23'));
    expect(await response.json()).toEqual({ count: 512 });
    expect(state.send).not.toHaveBeenCalled();
    expect(state.docs.get(eventPath).status).toBe('published');
  });
  it('reports a provider rejection, keeps cancellation/refund records, and retries only unsent notices', async () => {
    state.send.mockResolvedValueOnce({ ok: false, error: 'Email unavailable' });
    const response = await POST(request('2031-03-23'));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('Email unavailable');
    expect(state.docs.get(rowPath('a')).status).toBe('cancelled');
    expect(state.docs.get(rowPath('a')).refundStatus).toBe('pending_manual');
    await POST(request('2031-03-23'));
    expect(state.send.mock.calls.map(([notice]) => notice.to)).toEqual(['a@example.test', 'b@example.test', 'a@example.test']);
    expect(state.send.mock.calls[0][0]).toEqual(state.send.mock.calls[2][0]);
  });
  it('uses identical provider keys and frozen payload after an accepted email loses its marker write', async () => {
    state.failSentMarker = true;
    expect((await POST(request('2031-03-23'))).status).toBe(503);
    const notices = state.send.mock.calls.map(([notice]) => structuredClone(notice));
    state.docs.set(eventPath, { ...state.docs.get(eventPath), title: 'Renamed', organizerEmail: 'new@example.test' });
    state.failSentMarker = false;
    await POST(request('2031-03-23'));
    expect(state.send.mock.calls.slice(2).map(([notice]) => notice)).toEqual(notices);
    state.send.mockClear();
    await POST(request('2031-03-23'));
    expect(state.send).not.toHaveBeenCalled();
  });
  it('never retries ambiguous delivery outside provider deduplication retention', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    state.failSentMarker = true;
    await POST(request('2031-03-23'));
    state.send.mockClear(); state.failSentMarker = false;
    vi.setSystemTime(new Date('2030-01-02T01:00:00Z'));
    const response = await POST(request('2031-03-23'));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('review delivery');
    expect(state.send).not.toHaveBeenCalled();
  });
  it('concurrent retries share provider idempotency keys for each registration', async () => {
    const responses = await Promise.all([POST(request('2031-03-23')), POST(request('2031-03-23'))]);
    expect(responses.every(response => response.status === 200)).toBe(true);
    const deliveries = new Map<string, Set<string>>();
    for (const [notice] of state.send.mock.calls) {
      const keys = deliveries.get(notice.to) || new Set(); keys.add(notice.idempotencyKey); deliveries.set(notice.to, keys);
    }
    expect([...deliveries.keys()].sort()).toEqual(['a@example.test', 'b@example.test']);
    expect([...deliveries.values()].map(keys => keys.size)).toEqual([1, 1]);
    expect(new Set([...deliveries.values()].flatMap(keys => [...keys])).size).toBe(2);
  });
  it('rejects an empty run selector instead of cancelling the whole series', async () => {
    const response = await POST(new NextRequest('https://example.test/api/events/cancel', { method: 'POST',
      body: JSON.stringify({ tenantId: 't1', eventId: 'e1', runDate: '' }) }));
    expect(response.status).toBe(400);
    expect(state.docs.get(eventPath).status).toBe('published');
  });
  it('fails visibly on a read failure, missing contact, or invalid run; permission failures send nothing', async () => {
    state.readError = true;
    expect((await POST(request())).status).toBe(503);
    state.readError = false; state.docs.delete('users/owner');
    expect((await POST(request())).status).toBe(409);
    expect((await POST(request('2031-03-24'))).status).toBe(400);
    state.permission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await POST(request())).status).toBe(403);
    expect((await GET(new NextRequest('https://example.test/api/events/cancel?tenantId=t1&eventId=e1'))).status).toBe(403);
    expect(state.permission.mock.calls.every(call => call[1] === 't1' && call[2] === 'manageEvents')).toBe(true);
    expect(state.docs.get(eventPath).status).toBe('published');
    expect(state.send).not.toHaveBeenCalled();
  });
});

it('marks an entire large series cancelled before bounded sends, then finishes every notice exactly once', async () => {
  state.docs.clear();
  state.docs.set('users/admin', { tenantId: 't1' });
  state.docs.set(eventPath, { ...event(), recurrence: null, organizerEmail: 'owner@example.test' });
  for (let i = 0; i < 45; i++) state.docs.set(rowPath(`large${i}`), {
    eventId: 'e1', status: 'confirmed', email: `large${i}@example.test`, amount: 500, paymentStatus: 'confirmed',
  });
  const first = await POST(request());
  expect(await first.json()).toEqual({ emailed: 20, remaining: 25 });
  expect([...state.docs].filter(([path]) => path.includes('/registrations/'))
    .every(([, row]) => row.status === 'cancelled' && row.refundStatus === 'pending_manual')).toBe(true);
  expect(await (await POST(request())).json()).toEqual({ emailed: 20, remaining: 5 });
  expect(await (await POST(request())).json()).toEqual({ emailed: 5, remaining: 0 });
  expect(state.send).toHaveBeenCalledTimes(45);
  expect(new Set(state.send.mock.calls.map(([notice]) => notice.to)).size).toBe(45);
  expect(await (await POST(request())).json()).toEqual({ emailed: 0, remaining: 0 });
  expect(state.send).toHaveBeenCalledTimes(45);
});

it('does not expire notices that have been queued but never attempted', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  state.docs.clear();
  state.docs.set('users/admin', { tenantId: 't1' });
  state.docs.set(eventPath, { ...event(), recurrence: null, organizerEmail: 'owner@example.test' });
  for (let i = 0; i < 25; i++) state.docs.set(rowPath(`queued${i}`), {
    eventId: 'e1', status: 'waitlisted', waitlisted: true, email: `queued${i}@example.test`, amount: 0,
  });
  expect(await (await POST(request())).json()).toEqual({ emailed: 20, remaining: 5 });
  expect(state.docs.get(rowPath('queued24')).waitlisted).toBe(false);
  vi.setSystemTime(new Date('2030-01-03T00:00:00Z'));
  expect(await (await POST(request())).json()).toEqual({ emailed: 5, remaining: 0 });
  expect(state.send).toHaveBeenCalledTimes(25);
});


it('B1 ignores forged registration notices and retry state, persisting only server-built notices', async () => {
  const forged = { to: 'victim@example.test', subject: 'Forged subject', text: 'Attacker content',
    replyTo: 'attacker@example.test', firstAttemptAt: '2000-01-01T00:00:00Z', attempts: 999, sentAt: 'FORGED' };
  state.docs.set(rowPath('a'), { ...state.docs.get(rowPath('a')), cancellationNotice: forged });
  state.docs.set(rowPath('b'), { ...state.docs.get(rowPath('b')), cancellationNotice: { ...forged, sentAt: null } });
  expect(await (await GET(new NextRequest('https://example.test/api/events/cancel?tenantId=t1&eventId=e1&runDate=2031-03-23'))).json()).toEqual({ count: 2 });
  expect((await POST(request('2031-03-23'))).status).toBe(200);
  expect(state.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@example.test',
    subject: 'Cancelled: Gathering — 2031-03-23', replyTo: 'owner@example.test' }));
  expect(state.send.mock.calls.some(([notice]) => notice.to === forged.to || notice.text === forged.text)).toBe(false);
  expect(state.docs.get(noticePath('a'))).toMatchObject({ attempts: 1, sentAt: 'SERVER_TS', to: 'a@example.test' });
  expect(state.docs.get(noticePath('a')).firstAttemptAt).not.toBe(forged.firstAttemptAt);
});

it('B2 flags actual payments, never the price on unpaid manual or waitlisted seats', async () => {
  for (const [id, status, payment] of [
    ['manual', 'confirmed', { paymentStatus: 'unpaid' }],
    ['waitlist', 'waitlisted', { paymentStatus: 'unpaid' }],
    ['claimed', 'confirmed', { paymentStatus: 'claimed' }],
    ['confirmed', 'confirmed', { paymentStatus: 'confirmed' }],
    ['stripe', 'confirmed', { stripePaymentIntentId: 'pi_paid' }],
    ['paidAmount', 'confirmed', { amountPaid: 5000 }],
  ] as const) state.docs.set(rowPath(id), { eventId: 'e1', runDate: '2031-03-23', status, amount: 5000,
    email: `${id}@example.test`, ...payment });
  expect((await POST(request('2031-03-23'))).status).toBe(200);
  for (const id of ['manual', 'waitlist', 'claimed']) expect(state.docs.get(rowPath(id)).refundStatus).toBeUndefined();
  for (const id of ['confirmed', 'stripe', 'paidAmount']) expect(state.docs.get(rowPath(id)).refundStatus).toBe('pending_manual');
});

it('B3 whole-series cancellation preserves past and already-started runs in the event time zone', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2031-03-30T08:00:00Z'));
  state.docs.set(rowPath('future'), { eventId: 'e1', runDate: '2031-04-06', status: 'confirmed',
    email: 'future@example.test', paymentStatus: 'confirmed', amount: 5000 });
  const before = ['a', 'b', 'c'].map(id => structuredClone(state.docs.get(rowPath(id))));
  expect(await (await GET(new NextRequest('https://example.test/api/events/cancel?tenantId=t1&eventId=e1'))).json()).toEqual({ count: 1 });
  expect((await POST(request())).status).toBe(200);
  expect(['a', 'b', 'c'].map(id => state.docs.get(rowPath(id)))).toEqual(before);
  expect(state.send.mock.calls.map(([notice]) => notice.to)).toEqual(['future@example.test']);
  expect(state.docs.get(rowPath('future')).refundStatus).toBe('pending_manual');
});

it('B3 refuses to cancel a one-off event that has already started', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2031-03-23T09:00:00Z'));
  state.docs.set(eventPath, { ...event(), recurrence: null });
  expect((await POST(request())).status).toBe(409);
  expect(state.docs.get(eventPath).status).toBe('published');
  expect(state.send).not.toHaveBeenCalled();
});

it.each(['other', null])('rejects cancellation and preview when current membership is %s despite a stale token', async tenantId => {
  state.docs.set('users/admin', { tenantId });
  expect((await POST(request())).status).toBe(403);
  expect((await GET(new NextRequest('https://example.test/api/events/cancel?tenantId=t1&eventId=e1'))).status).toBe(403);
  expect(state.docs.get(eventPath).status).toBe('published');
  expect(state.send).not.toHaveBeenCalled();
});

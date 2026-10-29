import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const state = vi.hoisted(() => ({
  event: {} as Record<string, any>, registrations: 0, readError: false,
  writes: [] as Record<string, any>[], paths: [] as string[],
  permission: vi.fn(),
}));
const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });
function ref(path: string): any {
  return {
    path, collection: (id: string) => ref(`${path}/${id}`), doc: (id: string) => ref(`${path}/${id}`),
    where: (key: string, op: string, value: string) => ref(`${path}?${key}${op}${value}`),
    select: () => ref(path),
    count: () => ({ get: async () => {
      if (state.readError) throw new Error('unavailable');
      state.paths.push(path);
      return { data: () => ({ count: state.registrations }) };
    } }),
    get: async () => ({ exists: true, data: () => state.event }),
  };
}
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {
  collection: (id: string) => ref(id),
  runTransaction: async (work: (tx: unknown) => Promise<void>) => work({
    get: async (r: { path: string }) => {
      state.paths.push(r.path);
      if (r.path.includes('registrations')) {
        if (state.readError) throw new Error('unavailable');
        return { empty: state.registrations === 0 };
      }
      return { exists: true, data: () => state.event };
    },
    update: (_r: unknown, data: Record<string, any>) => state.writes.push(data),
  }),
} }));
vi.mock('@/lib/api-auth', () => ({ requireTenantPermission: state.permission }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' }, Timestamp: { fromDate: (date: Date) => timestamp(date.toISOString()) },
}));
const { GET, PATCH } = await import('../route');
const request = (data: Record<string, unknown>) => new NextRequest('https://t1.theharvest.app/api/events/edit', {
  method: 'PATCH', body: JSON.stringify({ tenantId: 't1', eventId: 'e1', data }),
});
beforeEach(() => {
  state.event = { title: 'Series', startDate: timestamp('2031-03-16T18:00:00.000Z'), timeZone: 'Europe/Berlin', recurrence: { freq: 'weekly', count: 4 } };
  state.registrations = 1; state.readError = false; state.writes = []; state.paths = [];
  state.permission.mockReset().mockResolvedValue({ uid: 'admin' });
});

describe('series edits preserve registered run identities', () => {
  it.each([
    { startDate: '2031-03-17T18:00:00.000Z' },
    { recurrence: { freq: 'monthly', count: 4 } },
    { timeZone: 'America/New_York' },
    { recurrence: null },
  ])('refuses a schedule change with registrations: %j', async update => {
    const response = await PATCH(request(update));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('registrations');
    expect(state.writes).toEqual([]);
    expect(state.paths).toContain('tenants/t1/registrations?eventId==e1');
  });
  it('allows time-of-day, title and other edits with registrations', async () => {
    const response = await PATCH(request({ startDate: '2031-03-16T19:30:00.000Z', title: 'New title', location: 'New venue', capacity: 90 }));
    expect(response.status).toBe(200);
    expect(state.writes[0]).toMatchObject({ title: 'New title', location: 'New venue', capacity: 90 });
    expect(state.writes[0].startDate.toDate().toISOString()).toBe('2031-03-16T19:30:00.000Z');
  });
  it('allows schedule changes before the first registration', async () => {
    state.registrations = 0;
    const response = await PATCH(request({ timeZone: 'UTC', recurrence: { freq: 'every_2_weeks' }, startDate: '2031-03-17T12:00:00.000Z' }));
    expect(response.status).toBe(200);
    expect(state.writes).toHaveLength(1);
  });
  it('rechecks at save after an unlocked editor has opened', async () => {
    state.registrations = 0;
    expect(await (await GET(new NextRequest('https://t1.theharvest.app/api/events/edit?tenantId=t1&eventId=e1'))).json()).toEqual({ locked: false });
    state.registrations = 1;
    expect((await PATCH(request({ timeZone: 'UTC' }))).status).toBe(409);
    expect(state.writes).toEqual([]);
  });
  it('fails visibly and writes nothing if the registration read fails', async () => {
    state.readError = true;
    expect((await PATCH(request({ recurrence: { freq: 'monthly' } }))).status).toBe(503);
    expect(state.writes).toEqual([]);
    expect((await GET(new NextRequest('https://t1.theharvest.app/api/events/edit?tenantId=t1&eventId=e1'))).status).toBe(503);
  });
  it('checks manageEvents on both endpoints and returns an authorization failure', async () => {
    state.permission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await PATCH(request({ title: 'New' }))).status).toBe(403);
    expect((await GET(new NextRequest('https://t1.theharvest.app/api/events/edit?tenantId=t1&eventId=e1'))).status).toBe(403);
    expect(state.permission.mock.calls.every(call => call[1] === 't1' && call[2] === 'manageEvents')).toBe(true);
    expect(state.writes).toEqual([]);
  });
  it('rejects fields outside the event editor', async () => {
    expect((await PATCH(request({ tenantId: 'other' }))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
});


it('keeps the original Timestamp precision when the editor sends an untouched instant', async () => {
  const original = state.event.startDate;
  expect((await PATCH(request({ startDate: original.toDate().toISOString() }))).status).toBe(200);
  expect(state.writes[0].startDate).toBe(original);
});
it('reports a locked editor when the series has registrations', async () => {
  const response = await GET(new NextRequest('https://t1.theharvest.app/api/events/edit?tenantId=t1&eventId=e1'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ locked: true });
});

it.each([-1, '2', Infinity])('refuses invalid per-run cutoff hours %s', async value => {
  const response = await PATCH(request({ registrationCutoffHours: value }));
  expect(response.status).toBe(400);
});
it('saves an admin-edited per-run offset', async () => {
  expect((await PATCH(request({ registrationCutoffHours: 4.5 }))).status).toBe(200);
  expect(state.writes[0].registrationCutoffHours).toBe(4.5);
});
it('prevents an edit from bypassing cancellation notices', async () => {
  expect((await PATCH(request({ status: 'cancelled' }))).status).toBe(409);
  expect((await PATCH(request({ recurrence: { ...state.event.recurrence, cancelledRuns: ['2031-03-23'] } }))).status).toBe(409);
  expect(state.writes).toEqual([]);
});

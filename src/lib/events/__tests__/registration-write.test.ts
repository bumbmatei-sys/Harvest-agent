import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ event: {} as any, writes: [] as any[], paths: [] as string[], readError: false }));
function ref(path: string): any {
  return { path, collection: (key: string) => ref(`${path}/${key}`), doc: (key = 'generated-id') => ref(`${path}/${key}`) };
}
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {
  collection: (key: string) => ref(key),
  runTransaction: async (work: (tx: any) => Promise<unknown>) => {
    const creates: any[] = [];
    const result = await work({
      get: async (r: any) => {
        state.paths.push(r.path);
        if (state.readError) throw new Error('Unavailable');
        return { exists: !!state.event, data: () => state.event };
      },
      create: (r: any, data: any) => creates.push({ path: r.path, data }),
    });
    state.writes.push(...creates);
    return result;
  },
} }));
const { createEventRegistration, RegistrationClosedError } = await import('../registration-write');

beforeEach(() => {
  state.event = { status: 'published', registrationEnabled: true };
  state.writes = []; state.paths = []; state.readError = false;
});
describe('registration commit serializes with cancellation', () => {
  it('creates a registration only after reading the tenant event in the transaction', async () => {
    await createEventRegistration('t1', 'e1', { name: 'Person', eventId: 'e1' });
    expect(state.paths).toEqual(['tenants/t1/events/e1']);
    expect(state.writes).toEqual([{ path: 'tenants/t1/registrations/generated-id', data: { name: 'Person', eventId: 'e1' } }]);
  });
  it.each(['cancelled', 'draft', 'completed'])('refuses a stale signup after the event becomes %s', async status => {
    state.event.status = status;
    await expect(createEventRegistration('t1', 'e1', { eventId: 'e1' })).rejects.toBeInstanceOf(RegistrationClosedError);
    expect(state.writes).toEqual([]);
  });
  it('refuses a run cancelled since the initial request read', async () => {
    state.event = { ...state.event, startDate: { toDate: () => new Date('2031-03-23T09:00:00Z') },
      recurrence: { freq: 'weekly', count: 3, cancelledRuns: ['2031-03-30'] } };
    await expect(createEventRegistration('t1', 'e1', { eventId: 'e1', runDate: '2031-03-30' })).rejects.toBeInstanceOf(RegistrationClosedError);
    expect(state.writes).toEqual([]);
  });
  it('refuses a missing event, disabled registration or failed read', async () => {
    state.event = null;
    await expect(createEventRegistration('t1', 'e1', {})).rejects.toBeInstanceOf(RegistrationClosedError);
    state.event = { status: 'published', registrationEnabled: false };
    await expect(createEventRegistration('t1', 'e1', {})).rejects.toBeInstanceOf(RegistrationClosedError);
    state.readError = true;
    await expect(createEventRegistration('t1', 'e1', {})).rejects.toThrow('Unavailable');
    expect(state.writes).toEqual([]);
  });
  it('rechecks the cutoff at write time after request work crosses the boundary', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2031-03-30T06:00:00Z'));
    try {
      state.event = { ...state.event, timeZone: 'Europe/Berlin', startDate: { toDate: () => new Date('2031-03-23T09:00:00Z') },
        recurrence: { freq: 'weekly', count: 3 } };
      await expect(createEventRegistration('t1', 'e1', { runDate: '2031-03-30' })).rejects.toBeInstanceOf(RegistrationClosedError);
      expect(state.writes).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});

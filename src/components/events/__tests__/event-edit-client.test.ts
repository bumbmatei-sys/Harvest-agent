import { beforeEach, expect, it, vi } from 'vitest';
import { getSeriesEditLock, saveEventEdit } from '../event-edit-client';
import type { Event } from '@/hooks/queries/useEventQueries';
const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/utils/auth-fetch', () => ({ authFetch: fetch }));
beforeEach(() => { fetch.mockReset(); });

it('sends ISO event dates and nulls to the authenticated save endpoint', async () => {
  fetch.mockResolvedValue({ ok: true });
  const date = new Date(Date.UTC(2031, 2, 16, 18, 0, 12, 345));
  await saveEventEdit('t1', 'e1', {
    title: 'Renamed', startDate: { toDate: () => date } as Event['startDate'], endDate: null, registrationDeadline: null,
  });
  expect(fetch).toHaveBeenCalledWith('/api/events/edit', expect.objectContaining({ method: 'PATCH' }));
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ tenantId: 't1', eventId: 'e1', data: {
    title: 'Renamed', startDate: date.toISOString(), endDate: null, registrationDeadline: null,
  } });
});
it('surfaces a server schedule conflict instead of reporting a saved edit', async () => {
  fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'This series has registrations.' }) });
  await expect(saveEventEdit('t1', 'e1', { timeZone: 'UTC' })).rejects.toThrow('This series has registrations.');
});
it.each([{}, { locked: null }, { locked: 'false' }])('does not turn malformed lock responses into unlocked controls: %j', async result => {
  fetch.mockResolvedValue({ ok: true, json: async () => result });
  await expect(getSeriesEditLock('t1', 'e1')).rejects.toThrow('Could not check series registrations');
});
it.each([true, false])('returns the explicit lock value %s', async locked => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ locked }) });
  await expect(getSeriesEditLock('t1', 'e1')).resolves.toBe(locked);
  expect(fetch).toHaveBeenCalledWith('/api/events/edit?tenantId=t1&eventId=e1');
});

it('leaves omitted dates absent on partial edits instead of clearing them', async () => {
  fetch.mockResolvedValue({ ok: true });
  await saveEventEdit('t1', 'e1', { title: 'Renamed' });
  expect(JSON.parse(fetch.mock.calls[0][1].body).data).toEqual({ title: 'Renamed' });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture whatever the route writes via `.set(payload, { merge: true })`.
const setSpy = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({ set: setSpy }),
        }),
      }),
    }),
  },
}));

// FieldValue.delete() returns a sentinel we can assert on. serverTimestamp is a
// sentinel too — the route uses it for updatedAt.
const DELETE_SENTINEL = Symbol('delete');
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'ts',
    increment: () => 'inc',
    delete: () => DELETE_SENTINEL,
  },
}));

// generate/route (source of computeNextScheduled) pulls these in at import time.
vi.mock('@/lib/ai-config', () => ({
  getMimoChatUrl: () => 'https://mimo.test/chat',
  MIMO_MODEL: 'mimo-test',
}));

// requireAdmin is bypassed — return an authenticated admin with a tenant.
vi.mock('@/lib/api-auth', () => ({
  requireAdmin: async () => ({ tenantId: 'tenant-1', uid: 'admin-1' }),
}));

const { POST } = await import('../automate/route');
const { computeNextScheduled } = await import('../generate/route');

function makeRequest(body: unknown) {
  return { json: async () => body } as any;
}

beforeEach(() => {
  setSpy.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('automate POST — nextScheduledAt seeding', () => {
  it('seeds nextScheduledAt from the shared helper when enabling (weekly / Mon / 9am / LA)', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z')); // Wednesday

    const res = await POST(
      makeRequest({
        enabled: true,
        frequency: 'weekly',
        dayOfWeek: 1,
        hour: 9,
        timezone: 'America/Los_Angeles',
      }),
    );
    expect(res.status).toBe(200);

    const payload = setSpy.mock.calls[0][0];
    expect(payload.enabled).toBe(true);

    const expected = computeNextScheduled('weekly', 1, 9, 'America/Los_Angeles');
    expect(payload.nextScheduledAt).toBeInstanceOf(Date);
    expect((payload.nextScheduledAt as Date).toISOString()).toBe(expected.toISOString());
    // Next Monday (2026-07-20) 9am PDT (UTC-7) == 16:00 UTC.
    expect((payload.nextScheduledAt as Date).toISOString()).toBe('2026-07-20T16:00:00.000Z');
  });

  it('seeds tomorrow 08:00 UTC for daily / 8am / UTC', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

    await POST(makeRequest({ enabled: true, frequency: 'daily', hour: 8, timezone: 'UTC' }));

    const payload = setSpy.mock.calls[0][0];
    expect((payload.nextScheduledAt as Date).toISOString()).toBe('2026-07-16T08:00:00.000Z');
  });

  it('applies the same defaults the write payload uses when fields are omitted', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

    await POST(makeRequest({ enabled: true }));

    const payload = setSpy.mock.calls[0][0];
    // Defaults: weekly / dayOfWeek 1 (Mon) / hour 8 / UTC.
    const expected = computeNextScheduled('weekly', 1, 8, 'UTC');
    expect((payload.nextScheduledAt as Date).toISOString()).toBe(expected.toISOString());
  });

  it('clears nextScheduledAt via FieldValue.delete() when disabling', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

    await POST(makeRequest({ enabled: false, frequency: 'daily', hour: 8, timezone: 'UTC' }));

    const payload = setSpy.mock.calls[0][0];
    expect(payload.enabled).toBe(false);
    expect(payload.nextScheduledAt).toBe(DELETE_SENTINEL);
  });
});

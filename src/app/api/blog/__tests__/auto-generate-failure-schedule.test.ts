import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The retry loop (JAVASCRIPT-NEXTJS-8).
 *
 * `nextScheduledAt` used to be written only after a SUCCESSFUL generation. A
 * tenant whose generation failed therefore kept a `nextScheduledAt` in the past,
 * stayed permanently due, and was retried on every single cron run — 305 real
 * RAG + generation calls over thirteen days, for zero posts.
 *
 * These tests pin the four properties that make that impossible: a failure moves
 * the schedule, a success still moves it, a persistent failure eventually stops
 * (visibly), and a success clears the streak.
 */

const { state } = vi.hoisted(() => ({
  state: {
    settingsDocs: [] as any[],
    plan: 'max',
  },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collectionGroup: () => ({
      where: () => ({ get: async () => ({ docs: state.settingsDocs }) }),
    }),
    collection: () => ({
      doc: () => ({ get: async () => ({ data: () => ({ plan: state.plan }) }) }),
    }),
  },
}));

const DELETE_SENTINEL = Symbol('delete');
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'server-ts',
    increment: () => 'inc',
    delete: () => DELETE_SENTINEL,
  },
}));

// The tenant's normal next slot, fixed so retry clamping is deterministic.
const NORMAL_NEXT_SLOT = new Date('2026-08-15T08:00:00.000Z');
const generateAndSavePost = vi.fn();

vi.mock('../generate/route', () => ({
  generateAndSavePost: (...args: unknown[]) => generateAndSavePost(...args),
  computeNextScheduled: () => NORMAL_NEXT_SLOT,
  // The route narrows on this with `instanceof`; it resolves to the same class
  // the route imports, so a plain stand-in is faithful here.
  BlogGenerationError: class BlogGenerationError extends Error {},
}));

const captureHandledError = vi.fn();
vi.mock('@/lib/money-path-sentry', () => ({
  captureHandledError: (...args: unknown[]) => captureHandledError(...args),
}));

const { GET } = await import('../auto-generate/route');
const { MAX_CONSECUTIVE_FAILURES } = await import('@/lib/blog-automation');

/** A settings doc that is due now, with whatever prior failure state we want. */
function dueTenant(overrides: Record<string, unknown> = {}) {
  const set = vi.fn();
  return {
    set,
    doc: {
      ref: { parent: { parent: { id: 'bumb' } }, set },
      data: () => ({
        enabled: true,
        frequency: 'weekly',
        dayOfWeek: 1,
        hour: 8,
        timezone: 'UTC',
        // Due: in the past relative to the faked clock below.
        nextScheduledAt: { toDate: () => new Date('2026-08-08T08:00:00.000Z') },
        ...overrides,
      }),
    },
  };
}

const cronRequest = {
  headers: { get: () => 'Bearer test-cron-secret' },
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'));
  process.env.CRON_SECRET = 'test-cron-secret';
  state.plan = 'max';
  state.settingsDocs = [];
});

afterEach(() => {
  vi.useRealTimers();
  // In afterEach rather than at the end of the one test that spies on
  // computeNextScheduled: a failing assertion returns early, and an unrestored
  // module spy then leaks into the next test as a confusing second failure.
  vi.restoreAllMocks();
});

describe('auto-generate cron — a failed generation advances nextScheduledAt', () => {
  it('writes the settings doc in the catch path so the tenant is no longer due', async () => {
    const tenant = dueTenant();
    state.settingsDocs = [tenant.doc];
    generateAndSavePost.mockRejectedValue(new Error('AI returned invalid JSON'));

    await GET(cronRequest);

    // The regression: the catch path must write, not just log.
    expect(tenant.set).toHaveBeenCalledTimes(1);
    const payload = tenant.set.mock.calls[0][0];

    expect(payload.nextScheduledAt).toBeInstanceOf(Date);
    // Strictly in the future — this is what stops the hourly retry.
    expect((payload.nextScheduledAt as Date).getTime()).toBeGreaterThan(Date.now());
    // 6h retry, which is sooner than the normal weekly slot.
    expect((payload.nextScheduledAt as Date).toISOString()).toBe('2026-08-08T18:00:00.000Z');
    expect(payload.consecutiveFailures).toBe(1);
    expect(payload.lastFailureMessage).toBe('AI returned invalid JSON');
  });

  it('never schedules the retry LATER than the tenant\'s own next slot', async () => {
    // A daily tenant whose next slot is 1 hour away: the 6h retry would skip a
    // legitimately due post, so the normal slot has to win.
    const soon = new Date('2026-08-08T13:00:00.000Z');
    const tenant = dueTenant();
    state.settingsDocs = [tenant.doc];
    generateAndSavePost.mockRejectedValue(new Error('transient blip'));

    const mod = await import('../generate/route');
    vi.spyOn(mod, 'computeNextScheduled').mockReturnValue(soon);

    await GET(cronRequest);

    const payload = tenant.set.mock.calls[0][0];
    expect((payload.nextScheduledAt as Date).toISOString()).toBe(soon.toISOString());
  });

  it('reports the failure to Sentry as well as rescheduling', async () => {
    const tenant = dueTenant();
    state.settingsDocs = [tenant.doc];
    generateAndSavePost.mockRejectedValue(new Error('boom'));

    await GET(cronRequest);

    expect(captureHandledError).toHaveBeenCalledTimes(1);
    expect(captureHandledError.mock.calls[0][1]).toMatchObject({
      step: 'blog-auto-generate-tenant',
      tenantId: 'bumb',
    });
  });
});

describe('auto-generate cron — a successful generation still advances nextScheduledAt', () => {
  it('advances to the normal next slot, as before', async () => {
    const tenant = dueTenant();
    state.settingsDocs = [tenant.doc];
    generateAndSavePost.mockResolvedValue({ postId: 'p1', title: 'Grace Abounds' });

    const res = await GET(cronRequest);
    const body = await res.json();

    expect(tenant.set).toHaveBeenCalledTimes(1);
    const payload = tenant.set.mock.calls[0][0];
    expect((payload.nextScheduledAt as Date).toISOString()).toBe(
      NORMAL_NEXT_SLOT.toISOString(),
    );
    expect(body.results[0]).toMatchObject({ status: 'generated', title: 'Grace Abounds' });
  });
});

describe('auto-generate cron — disabling after N consecutive failures', () => {
  it(`disables automation on failure number ${MAX_CONSECUTIVE_FAILURES}, with a visible reason`, async () => {
    const tenant = dueTenant({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1 });
    state.settingsDocs = [tenant.doc];
    generateAndSavePost.mockRejectedValue(new Error('AI returned invalid JSON'));

    await GET(cronRequest);

    const payload = tenant.set.mock.calls[0][0];
    expect(payload.enabled).toBe(false);
    expect(payload.consecutiveFailures).toBe(MAX_CONSECUTIVE_FAILURES);

    // Not silent: a human-readable reason is recorded on the doc AdminBlog reads.
    expect(typeof payload.automationDisabledReason).toBe('string');
    expect(payload.automationDisabledReason).toContain(String(MAX_CONSECUTIVE_FAILURES));
    expect(payload.automationDisabledReason).toContain('AI returned invalid JSON');
    expect(payload.automationDisabledAt).toBe('server-ts');

    // No lingering schedule to fire if automation is switched back on.
    expect(payload.nextScheduledAt).toBe(DELETE_SENTINEL);
  });

  it(`keeps retrying below the cap (failure ${MAX_CONSECUTIVE_FAILURES - 1} stays enabled)`, async () => {
    const tenant = dueTenant({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 2 });
    state.settingsDocs = [tenant.doc];
    generateAndSavePost.mockRejectedValue(new Error('still broken'));

    await GET(cronRequest);

    const payload = tenant.set.mock.calls[0][0];
    expect(payload.enabled).toBeUndefined();
    expect(payload.automationDisabledReason).toBeUndefined();
    expect(payload.consecutiveFailures).toBe(MAX_CONSECUTIVE_FAILURES - 1);
  });
});

describe('auto-generate cron — a success resets the failure count', () => {
  it('zeroes the streak so unrelated blips months apart never accumulate to a disable', async () => {
    const tenant = dueTenant({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1 });
    state.settingsDocs = [tenant.doc];
    generateAndSavePost.mockResolvedValue({ postId: 'p1', title: 'Recovered' });

    await GET(cronRequest);

    const payload = tenant.set.mock.calls[0][0];
    expect(payload.consecutiveFailures).toBe(0);
    expect(payload.lastFailureMessage).toBe(DELETE_SENTINEL);
    expect(payload.lastFailureAt).toBe(DELETE_SENTINEL);
    expect(payload.automationDisabledReason).toBe(DELETE_SENTINEL);
    expect(payload.automationDisabledAt).toBe(DELETE_SENTINEL);
  });
});

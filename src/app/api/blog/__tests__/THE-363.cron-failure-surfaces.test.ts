import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE-363 · THE-104 — the blog auto-generate cron.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 THE CURRENT STATE, ESTABLISHED FIRST ─────────────────────────────────
 *
 * The card reports the cron as "failing every day". IT IS NOT, and that was
 * established from production rather than inferred:
 *
 *   • VERCEL RUNTIME LOGS, project `harvest-agent`, branch `main`:
 *     `GET /api/blog/auto-generate 200` — the scheduled run completed with a
 *     200, not a 401 and not a 500.
 *   • SENTRY, org `harvest-jf`, last 14 days: 10 error events across two
 *     distinct signatures (`Could not load the default credentials` on
 *     /api/tenants/{roster,grace}-status, and a credential error on
 *     /api/auth/set-claims). NONE of them is blog-related, and no event carries
 *     the `blog-auto-generate-cron` or `blog-auto-generate-tenant` step.
 *
 * So the answer to "fixed, failing silently, or should not run" is FIXED —
 * the retry-loop work (JAVASCRIPT-NEXTJS-8, pinned next door in
 * `auto-generate-failure-schedule.test.ts`) is what fixed it.
 *
 * ── ⚠️ BUT ONE EXIT COULD STILL VANISH, and that is what this file closes ───
 *
 * Two of the route's three failure exits already surface. The third did not:
 *
 *   per-tenant generation error → Sentry `blog-auto-generate-tenant` AND the
 *                                 settings document, which AdminBlog renders.
 *   whole-run error            → Sentry `blog-auto-generate-cron` AND a 500.
 *   🔴 AUTH REFUSAL (401)      → NOTHING. No capture, no log.
 *
 * A `CRON_SECRET` that was never set, or rotated on one side only, produces a
 * daily 401 that reaches no error tracker at all: the feature stops posting for
 * every tenant and the only trace is a status code in a cron log nobody reads.
 * That is precisely the shape the card calls the more interesting finding, and
 * it is the one real defect left in this route.
 *
 * ── Where a cron failure should land: BOTH ──────────────────────────────────
 *
 * Sentry AND an admin-visible state, because the two readers are different
 * people and neither substitutes for the other. An operator learns from Sentry
 * that the scheduled job is dead; a church admin learns from the settings
 * document (the `automationDisabledReason` AdminBlog renders) why THEIR posts
 * stopped. An auth refusal is not attributable to any one tenant, so it can
 * only take the Sentry half — which is exactly why it must take it.
 *
 * ── Should it run at all? YES ───────────────────────────────────────────────
 *
 * `automatedBlog` is `true` on Ministry (`max`) alone, and unlike the
 * `churchDirectory` / `customBackground` / `publicCalendar` cells that were
 * deleted for naming capabilities nobody built, this one IS READ — by a real
 * server-side gate in this very route, recorded in
 * `docs/plan-features-flag-audit.md`. The feature exists, it is gated, the
 * route disables automation for a downgraded tenant, and the scheduled run
 * succeeds. There is nothing here to disable.
 *
 * NO LINE NUMBER IS PINNED ANYWHERE IN THIS FILE.
 */

const { state } = vi.hoisted(() => ({
  state: { settingsDocs: [] as any[], plan: 'max', collectionGroupThrows: null as Error | null },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collectionGroup: () => ({
      where: () => ({
        get: async () => {
          if (state.collectionGroupThrows) throw state.collectionGroupThrows;
          return { docs: state.settingsDocs };
        },
      }),
    }),
    collection: () => ({
      doc: () => ({ get: async () => ({ data: () => ({ plan: state.plan }) }) }),
    }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'server-ts',
    increment: () => 'inc',
    delete: () => Symbol('delete'),
  },
}));

const generateAndSavePost = vi.fn();
vi.mock('../generate/route', () => ({
  generateAndSavePost: (...args: unknown[]) => generateAndSavePost(...args),
  computeNextScheduled: () => new Date('2026-03-15T08:00:00.000Z'),
  BlogGenerationError: class BlogGenerationError extends Error {},
}));

const captureHandledError = vi.fn();
vi.mock('@/lib/money-path-sentry', () => ({
  captureHandledError: (...args: unknown[]) => captureHandledError(...args),
}));

const { GET } = await import('../auto-generate/route');
const { hasFeature, toTenantPlan, PLAN_ORDER } = await import('@/utils/plan-features');
const { stripComments } = await import('../../../../__tests__/__fixtures__/the-346-strip-comments');

const ROUTE = join(process.cwd(), 'src/app/api/blog/auto-generate/route.ts');

/** A request carrying whatever authorization header the caller wants. */
const requestWith = (authorization: string | null) =>
  ({ headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? authorization : null) } }) as any;

/** Every `step` this run reported to Sentry. */
const reportedSteps = () =>
  captureHandledError.mock.calls.map((c) => (c[1] as { step: string }).step);

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
        nextScheduledAt: { toDate: () => new Date('2026-03-08T08:00:00.000Z') },
        ...overrides,
      }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Far from today, deliberately — #468 turned `main` red with a fixture pinned
  // near the day it was written.
  vi.setSystemTime(new Date('2026-03-08T12:00:00.000Z'));
  process.env.CRON_SECRET = 'test-cron-secret';
  state.plan = 'max';
  state.settingsDocs = [];
  state.collectionGroupThrows = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1 · The cron's current state is established
// ═════════════════════════════════════════════════════════════════════════════

describe("the cron's current state is established", () => {
  it('a normal scheduled run completes — the daily failure is not reproducible', async () => {
    const tenant = dueTenant();
    state.settingsDocs = [tenant.doc];
    generateAndSavePost.mockResolvedValue({ title: 'On Advent' });

    const res = await GET(requestWith('Bearer test-cron-secret'));

    expect(res.status ?? 200).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.results[0].status).toBe('generated');
    // Nothing was reported, because nothing failed. This is what the Vercel
    // `200` and the empty Sentry window look like from inside the handler.
    expect(reportedSteps()).toEqual([]);
  });

  it('the feature it gates is real and Ministry-only — there is nothing to disable', () => {
    expect(hasFeature(toTenantPlan('max'), 'automatedBlog')).toBe(true);
    for (const plan of PLAN_ORDER.filter((p) => p !== 'max')) {
      expect(hasFeature(toTenantPlan(plan), 'automatedBlog'), plan).toBe(false);
    }
  });

  it('and the route still disables automation for a downgraded tenant', async () => {
    const tenant = dueTenant();
    state.settingsDocs = [tenant.doc];
    state.plan = 'free';

    const res = await GET(requestWith('Bearer test-cron-secret'));
    const body = await res.json();

    expect(body.results[0].status).toContain('plan downgraded');
    expect(tenant.set).toHaveBeenCalledWith({ enabled: false }, { merge: true });
    expect(generateAndSavePost).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · A cron failure SURFACES — asserted by making it fail
// ═════════════════════════════════════════════════════════════════════════════

describe('a cron failure surfaces', () => {
  it('🔴 an auth refusal reaches Sentry — the exit that used to vanish', async () => {
    const res = await GET(requestWith('Bearer a-rotated-secret'));

    expect(res.status).toBe(401);
    // THE NAMED DESTINATION.
    expect(reportedSteps()).toContain('blog-auto-generate-auth');
    const [, capture] = captureHandledError.mock.calls[0];
    expect((capture as { diagnostics: { reason: string } }).diagnostics.reason)
      .toBe('cron-secret-mismatch');
    // And the response says why, so the cron log is diagnosable on its own.
    expect((await res.json()).reason).toBe('cron-secret-mismatch');
  });

  it('an UNSET CRON_SECRET is reported as its own distinct reason', async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(requestWith('Bearer anything'));

    expect(res.status).toBe(401);
    expect(reportedSteps()).toContain('blog-auto-generate-auth');
    const [, capture] = captureHandledError.mock.calls[0];
    expect((capture as { diagnostics: { reason: string } }).diagnostics.reason)
      .toBe('cron-secret-not-configured');
  });

  it('a missing authorization header surfaces too, rather than silently 401ing', async () => {
    const res = await GET(requestWith(null));

    expect(res.status).toBe(401);
    expect(reportedSteps()).toContain('blog-auto-generate-auth');
  });

  it('a whole-run failure still reaches Sentry and still returns 500', async () => {
    state.collectionGroupThrows = new Error('Could not load the default credentials');

    const res = await GET(requestWith('Bearer test-cron-secret'));

    expect(res.status).toBe(500);
    expect(reportedSteps()).toContain('blog-auto-generate-cron');
  });

  it('a per-tenant failure reaches BOTH Sentry and the admin-visible document', async () => {
    const tenant = dueTenant();
    state.settingsDocs = [tenant.doc];
    generateAndSavePost.mockRejectedValue(new Error('AI returned invalid JSON'));

    await GET(requestWith('Bearer test-cron-secret'));

    // Destination 1: Sentry, for the operator.
    expect(reportedSteps()).toContain('blog-auto-generate-tenant');
    // Destination 2: the settings document, for the church admin. AdminBlog
    // renders `lastFailureMessage` / `automationDisabledReason`.
    const payload = tenant.set.mock.calls[0][0];
    expect(payload.lastFailureMessage).toContain('AI returned invalid JSON');
    expect(payload.consecutiveFailures).toBe(1);
  });

  it('no failure exit in the route returns without reporting', () => {
    // The structural claim behind the cases above, and it is POSITIONAL rather
    // than a count: a count of captures vs. a count of exits stays satisfied
    // when one exit loses its capture and another has two, which is exactly the
    // mutation this must catch. Read from PARSER-STRIPPED source so a
    // commented-out example cannot satisfy it.
    const src = stripComments(readFileSync(ROUTE, 'utf8'));

    // Needle assembled from fragments — spelled whole it would match itself.
    // 🔴 THE OPEN PAREN IS LOAD-BEARING: without it the needle also matches the
    // IMPORT of the same symbol at the top of the route, which sits before every
    // exit and made this guard unable to fail. Caught by mutation, not by
    // reading — the first version of this assertion passed a planted defect.
    const capture = ['capture', 'HandledError', '('].join('');

    const exits = [...src.matchAll(/status:\s*(401|500)/g)];
    expect(exits.length, 'the route must still have failure exits to check').toBeGreaterThan(1);

    for (const exit of exits) {
      const at = exit.index ?? 0;
      // The report for THIS exit has to appear before it, and after the
      // previous exit — so each failure path carries its own.
      const before = src.slice(0, at);
      const lastCapture = before.lastIndexOf(capture);
      expect(
        lastCapture,
        `the ${exit[1]} exit returns without reporting first`,
      ).toBeGreaterThan(-1);

      // ...and nothing else returned in between, which is what makes it THIS
      // exit's report rather than an earlier one's.
      const between = before.slice(lastCapture);
      expect(
        /status:\s*(401|500)/.test(between),
        `the ${exit[1]} exit is reusing an earlier exit's report`,
      ).toBe(false);
    }
  });
});

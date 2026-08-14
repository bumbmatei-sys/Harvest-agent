import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { checkRosterAdminStatus, ROSTER_RETRY_BUDGET_MS, type RosterAdminStatus } from '../tenant.utils';
import { clearRosterAnswerCache, readCachedRosterAnswer } from '../roster-cache';

/**
 * THE-139 — the roster lookup's retry policy, on its own.
 *
 * The nav-level behaviour lives in AdminDashboard.rate-limit-nav.test.tsx; this
 * file pins the classification underneath it. The distinction that matters is
 * the one the production bug got wrong: a 429 is not a denial, and a denial is
 * not a hiccup. Retrying the first is how an admin keeps their tabs; NOT
 * retrying the second is how a genuine "no" stays a "no".
 */

const currentUser = vi.hoisted(() => ({
  current: { uid: 'user-1', getIdToken: async () => 'token' } as
    { uid: string; getIdToken: () => Promise<string> } | null,
}));

vi.mock('../../firebase', () => ({
  db: {},
  get auth() { return { get currentUser() { return currentUser.current; } }; },
}));

const TENANT = 'connect';

let calls = 0;

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' }, ...init,
  });

/** Respond with `queue[i]` for attempt i; the last entry repeats. */
function respondWith(queue: Array<() => Response>) {
  calls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    const next = queue[Math.min(calls, queue.length - 1)];
    calls++;
    return next();
  }));
}

const status = (code: number, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify({ error: 'nope' }), { status: code, headers });

// checkRosterAdminStatus reaches auth-fetch through a dynamic import. Warm it
// once up front: a cold module load is real I/O, which a fake clock does not
// wait for, so the first lookup would otherwise schedule its backoff after the
// test had already advanced past it.
beforeAll(async () => { await import('../auth-fetch'); });

beforeEach(() => {
  vi.useFakeTimers();
  clearRosterAnswerCache();
  currentUser.current = { uid: 'user-1', getIdToken: async () => 'token' };
  calls = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearRosterAnswerCache();
});

/** Run a lookup to completion, letting every backoff elapse. */
async function settle(promise: Promise<RosterAdminStatus>): Promise<RosterAdminStatus> {
  let done = false;
  const result = promise.then((r) => { done = true; return r; });
  // Advance in slices, re-checking between them: each backoff is only scheduled
  // once the attempt before it has come back, so a single jump can land before
  // the next timer exists.
  for (let i = 0; i < 12 && !done; i++) {
    await vi.advanceTimersByTimeAsync(ROSTER_RETRY_BUDGET_MS / 4);
  }
  return result;
}

describe('checkRosterAdminStatus — what it retries', () => {
  it('retries a 429 and returns the answer the retry gets', async () => {
    respondWith([status(429, { 'Retry-After': '1' }), () => json({ isRosterAdmin: true })]);
    expect(await settle(checkRosterAdminStatus(TENANT))).toBe('admin');
    expect(calls).toBe(2);
  });

  it('retries a 5xx', async () => {
    respondWith([status(503), () => json({ isRosterAdmin: true })]);
    expect(await settle(checkRosterAdminStatus(TENANT))).toBe('admin');
    expect(calls).toBe(2);
  });

  it('retries a network-level throw', async () => {
    calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed');
      return json({ isRosterAdmin: true });
    }));
    expect(await settle(checkRosterAdminStatus(TENANT))).toBe('admin');
    expect(calls).toBe(2);
  });

  it('gives up as "error" when a retryable failure never clears', async () => {
    respondWith([status(429, { 'Retry-After': '1' })]);
    expect(await settle(checkRosterAdminStatus(TENANT))).toBe('error');
    // Bounded: it does not retry forever.
    expect(calls).toBeLessThanOrEqual(3);
    expect(calls).toBeGreaterThan(1);
  });

  it('does NOT retry a settled refusal — 401/403/404 are answers, not hiccups', async () => {
    for (const code of [401, 403, 404]) {
      clearRosterAnswerCache();
      respondWith([status(code)]);
      expect(await settle(checkRosterAdminStatus(TENANT))).toBe('error');
      expect(calls, `${code} was retried`).toBe(1);
    }
  });

  it('abandons a Retry-After it could not honour inside the budget', async () => {
    // The limiter says "come back in a minute". Waiting that out would hold the
    // nav far past the point AdminDashboard has already given up, so it settles
    // now instead of burning the budget on a window that will not reopen.
    respondWith([status(429, { 'Retry-After': '60' })]);
    expect(await settle(checkRosterAdminStatus(TENANT))).toBe('error');
    expect(calls).toBe(1);
  });
});

describe('checkRosterAdminStatus — what it remembers', () => {
  it('caches a settled answer and stops asking', async () => {
    respondWith([() => json({ isRosterAdmin: true })]);
    expect(await settle(checkRosterAdminStatus(TENANT))).toBe('admin');
    expect(calls).toBe(1);

    expect(await settle(checkRosterAdminStatus(TENANT))).toBe('admin');
    expect(calls, 'a settled answer was re-fetched').toBe(1);
  });

  it('caches a settled "no" too — it is an answer', async () => {
    respondWith([() => json({ isRosterAdmin: false })]);
    expect(await settle(checkRosterAdminStatus(TENANT))).toBe('not-admin');
    expect(await settle(checkRosterAdminStatus(TENANT))).toBe('not-admin');
    expect(calls).toBe(1);
  });

  it('🔴 never caches "error" — one failed lookup must not become permanent', async () => {
    respondWith([status(429, { 'Retry-After': '1' })]);
    expect(await settle(checkRosterAdminStatus(TENANT))).toBe('error');
    expect(readCachedRosterAnswer(TENANT)).toBeNull();

    // The very next ask reaches the network again and gets the real answer.
    const before = calls;
    respondWith([() => json({ isRosterAdmin: true })]);
    calls = 0;
    expect(await settle(checkRosterAdminStatus(TENANT))).toBe('admin');
    expect(calls).toBe(1);
    expect(before).toBeGreaterThan(0);
  });
});

describe('the retry budget fits inside the nav ceiling', () => {
  it('ROSTER_RETRY_BUDGET_MS is below AdminDashboard ROSTER_LOOKUP_TIMEOUT_MS', () => {
    // If retrying could outlast the nav's ceiling, the nav would degrade while
    // the lookup was still trying — reintroducing the defect from the other end.
    const source = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');
    const match = /const ROSTER_LOOKUP_TIMEOUT_MS = (\d+)/.exec(source);
    expect(match, 'ROSTER_LOOKUP_TIMEOUT_MS is no longer declared as a literal').not.toBeNull();
    expect(ROSTER_RETRY_BUDGET_MS).toBeLessThan(Number(match![1]));
  });
});

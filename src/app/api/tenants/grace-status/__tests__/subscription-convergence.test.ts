import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  DODO_GRACE_PERIOD_MS,
  TENANT_STATUS_ACTIVE,
  TENANT_STATUS_ARCHIVED,
} from '@/lib/tenant-lifecycle';
import { DODO_ON_HOLD_FIELD, DODO_SUBSCRIPTION_CHECK_FIELD } from '@/lib/tenant-private';
import type { BillingSubscription, BillingSubscriptionStatus } from '@/lib/dodo/provider';

/**
 * THE-167 — a cancelled subscription left the tenant fully active.
 *
 * Three live subscriptions were cancelled through the Dodo API on 2026-08-17.
 * Dodo reports all three `status: cancelled`, `cancelled_at` set,
 * `cancel_at_next_billing_date: false` — immediate and terminal. Every tenant
 * doc still read `status: 'active'`. `subscription.cancelled` is one of the two
 * terminal lifecycle events and archives a tenant, so the state should have
 * moved and did not. The webhook endpoint is configured correctly, and whether
 * the event ever fired CANNOT BE DETERMINED — Dodo exposes no delivery log this
 * account can read.
 *
 * So this suite does not test a webhook. It tests the convergence that makes the
 * recorded lifecycle agree with what Dodo actually says, which closes the gap
 * whether the event was never emitted, was emitted and failed, or was delivered
 * and silently no-opped.
 *
 * ─── ⚠️ WHAT THIS SUITE DELIBERATELY DOES NOT MOCK ───────────────────────────
 *
 * Only the DODO CLIENT and FIREBASE are mocked. In particular:
 *
 *  1. `@/lib/dodo/lifecycle` runs FOR REAL. Test 9 is the whole reason — "the
 *     archive is performed by the same path the webhook uses" cannot be proved
 *     against a stub of that path. The suite runs the real webhook handler
 *     beside the real convergence and compares what each leaves behind.
 *  2. `resolveTenantGraceState` and the real grace convergence run too, so
 *     test 10 pins that the 21-day timer is untouched rather than asserting it
 *     about a mock.
 *  3. `@/lib/api-auth` and `@/lib/tenant-private` are real, with Firebase mocked
 *     beneath them — the shape the sibling suite established, and what makes
 *     test 12's 401 a real gate rather than a stubbed one.
 */

// ── Firebase, beneath the real auth, tenant-private and lifecycle modules ────
//
// `ops` is an ordered log of every Firestore operation. Two tests need ordering
// rather than end state: test 5 (the answer is read before Dodo is called) and
// test 9 (the archive lands in ONE batch, not as a loose write).
interface Op {
  readonly op: 'get' | 'set' | 'update' | 'query';
  readonly path: string;
  /** 'batch' when the write was committed as part of a batch, 'direct' otherwise. */
  readonly via?: 'batch' | 'direct';
}

const { mockVerifyIdToken, firestore, ops } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  /** `${collection}/${id}` → document data. Absent key = document missing. */
  firestore: new Map<string, any>(),
  ops: [] as any[],
}));

vi.mock('@/lib/firebase-admin', () => {
  const merge = (path: string, data: Record<string, any>) => {
    const existing = firestore.get(path) ?? {};
    const next = { ...existing, ...data };
    // Firestore deletes a field written as null via merge in this codebase's
    // usage (`dodoOnHoldAt: null` clears a hold), so mirror that.
    for (const [key, value] of Object.entries(data)) {
      if (value === null) delete next[key];
    }
    firestore.set(path, next);
  };

  const docRef = (path: string) => ({
    __path: path,
    get: async () => {
      ops.push({ op: 'get', path });
      const data = firestore.get(path);
      return { exists: data !== undefined, id: path.split('/')[1], data: () => data };
    },
    set: async (data: Record<string, any>) => {
      ops.push({ op: 'set', path, via: 'direct' });
      merge(path, data);
    },
    update: async (data: Record<string, any>) => {
      ops.push({ op: 'update', path, via: 'direct' });
      merge(path, data);
    },
  });

  const collection = (name: string) => ({
    doc: (id: string) => docRef(`${name}/${id}`),
    where: (field: string, _op: string, value: unknown) => ({
      limit: (_n: number) => ({
        get: async () => {
          ops.push({ op: 'query', path: `${name}?${field}` });
          const hits = [...firestore.entries()]
            .filter(([key, data]) => key.startsWith(`${name}/`) && data?.[field] === value)
            .map(([key, data]) => ({ id: key.split('/')[1], data: () => data }));
          return { empty: hits.length === 0, docs: hits };
        },
      }),
    }),
  });

  return {
    adminAuth: { verifyIdToken: mockVerifyIdToken },
    adminDb: {
      collection,
      batch: () => {
        const queued: Array<() => void> = [];
        return {
          update(ref: { __path: string }, data: Record<string, any>) {
            queued.push(() => {
              ops.push({ op: 'update', path: ref.__path, via: 'batch' });
              merge(ref.__path, data);
            });
          },
          set(ref: { __path: string }, data: Record<string, any>) {
            queued.push(() => {
              ops.push({ op: 'set', path: ref.__path, via: 'batch' });
              merge(ref.__path, data);
            });
          },
          commit: async () => {
            for (const write of queued) write();
          },
        };
      },
    },
  };
});

// ── The Dodo client: the ONLY thing stubbed on the convergence path ──────────
//
// The provider seam, not the raw SDK — `getSubscription` returns the app's own
// `BillingSubscription`, so these tests name statuses in Harvest's vocabulary.
const { mockGetSubscription } = vi.hoisted(() => ({ mockGetSubscription: vi.fn() }));
vi.mock('@/lib/dodo/dodo-provider', () => ({
  dodoBillingProvider: { getSubscription: mockGetSubscription },
}));

const { mockCaptureMoneyPathError } = vi.hoisted(() => ({ mockCaptureMoneyPathError: vi.fn() }));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: mockCaptureMoneyPathError }));

const { GET } = await import('../route');
const { handleDodoSubscriptionCancelled } = await import('@/lib/dodo/lifecycle');
const { DODO_SUBSCRIPTION_CHECK_INTERVAL_MS } = await import('@/lib/dodo/subscription-convergence');

// ── Fixtures ────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

interface Persona {
  uid: string;
  email: string;
  decoded: Record<string, unknown>;
  userDoc: Record<string, unknown> | null;
}

const OWNER: Persona = {
  uid: 'owner1',
  email: 'owner@grace.org',
  decoded: { uid: 'owner1', email: 'owner@grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'admin' },
};

const ALL_PERSONAS = [OWNER];

/** A subscription as the APP understands one. Named by status label, never by shape. */
function subscription(status: BillingSubscriptionStatus): BillingSubscription {
  return {
    id: 'sub_grace',
    status,
    plan: 'plus',
    period: 'monthly',
    cancelAtPeriodEnd: false,
    currentPeriodEndsAt: null,
    trialDays: 0,
    customerId: 'cus_grace',
    metadata: {},
  };
}

/** An ISO timestamp `ms` milliseconds in the past. */
function msAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function request(as: Persona | null, tenantId = 'grace'): NextRequest {
  return new NextRequest(`https://example.com/api/tenants/grace-status?tenantId=${tenantId}`, {
    method: 'GET',
    headers: as ? { authorization: `Bearer ${as.uid}` } : {},
  });
}

/** The public tenant doc's recorded lifecycle state. */
function statusOf(tenantId: string): string | undefined {
  return firestore.get(`tenants/${tenantId}`)?.status;
}

beforeEach(() => {
  vi.clearAllMocks();
  firestore.clear();
  ops.length = 0;

  mockVerifyIdToken.mockImplementation(async (token: string) => {
    const persona = ALL_PERSONAS.find((p) => p.uid === token);
    if (!persona) throw new Error('invalid token');
    return persona.decoded;
  });
  for (const persona of ALL_PERSONAS) {
    if (persona.userDoc) firestore.set(`users/${persona.uid}`, persona.userDoc);
  }

  // Grace Chapel: Dodo-owned, active, never on hold, never checked.
  firestore.set('tenants/grace', { ownerId: OWNER.uid, status: TENANT_STATUS_ACTIVE });
  firestore.set('tenant_private/grace', {
    adminEmails: ['roster@grace.org'],
    billingProcessor: 'dodo',
    dodoSubscriptionId: 'sub_grace',
    dodoCustomerId: 'cus_grace',
  });

  // Dodo says "still running" unless a test says otherwise.
  mockGetSubscription.mockResolvedValue(subscription('active'));
});

// ─────────────────────────────────────────────────────────────────────────────

describe('THE-167 — converging a tenant against Dodo\'s actual subscription status', () => {
  it('a tenant whose Dodo subscription is cancelled is archived on the next admin load', async () => {
    // 🔴 THE REGRESSION TEST. This is the observed defect exactly: Dodo says
    // cancelled, the tenant doc says active, and no webhook ever moved it. The
    // next admin load must close that gap on its own.
    mockGetSubscription.mockResolvedValue(subscription('cancelled'));
    expect(statusOf('grace')).toBe(TENANT_STATUS_ACTIVE);

    const res = await GET(request(OWNER));

    expect(res.status).toBe(200);
    expect(statusOf('grace')).toBe(TENANT_STATUS_ARCHIVED);
    // The provenance the archive path records — WHICH ending, kept for a human
    // reading the private doc later.
    expect(firestore.get('tenant_private/grace').dodoSubscriptionStatus).toBe('cancelled');
  });

  it('a tenant whose Dodo subscription is expired is archived', async () => {
    // The sibling terminal state. Different event, same capability answer.
    mockGetSubscription.mockResolvedValue(subscription('expired'));

    await GET(request(OWNER));

    expect(statusOf('grace')).toBe(TENANT_STATUS_ARCHIVED);
    expect(firestore.get('tenant_private/grace').dodoSubscriptionStatus).toBe('expired');
  });

  it('a tenant with an active subscription is left alone', async () => {
    // 🔴 THE NO-REGRESSION TEST. The overwhelming majority of admin loads are
    // this one. A convergence that archived a paying church would be far worse
    // than the defect it was written to fix.
    mockGetSubscription.mockResolvedValue(subscription('active'));

    const res = await GET(request(OWNER));

    expect(res.status).toBe(200);
    expect(statusOf('grace')).toBe(TENANT_STATUS_ACTIVE);
    expect(firestore.get('tenant_private/grace').dodoSubscriptionStatus).toBeUndefined();
    // The public tenant doc was not written at all.
    expect(ops.filter((o: Op) => o.path === 'tenants/grace' && o.op !== 'get')).toEqual([]);
  });

  it('a tenant on hold at Dodo keeps its entitlements and its own grace clock', async () => {
    // `on_hold` is NOT terminal, and it is the grace timer's business, not this
    // convergence's. Reaching into it here would make a second writer of the
    // very field the sibling convergence manages.
    mockGetSubscription.mockResolvedValue(subscription('grace'));

    await GET(request(OWNER));

    expect(statusOf('grace')).toBe(TENANT_STATUS_ACTIVE);
    expect(firestore.get('tenant_private/grace')[DODO_ON_HOLD_FIELD]).toBeUndefined();
  });

  it('an archived tenant is never resurrected by convergence', async () => {
    // 🔴 THE ONE-DIRECTION TEST. Dodo reporting `active` for an archived tenant
    // must NOT switch the church back on: reactivation is `subscription.active`'s
    // job through the provisioning path, which is deliberate and already tested.
    // A side channel here could restore a church that has not paid.
    firestore.set('tenants/grace', { ownerId: OWNER.uid, status: TENANT_STATUS_ARCHIVED });
    mockGetSubscription.mockResolvedValue(subscription('active'));

    const res = await GET(request(OWNER));

    expect(res.status).toBe(200);
    expect(statusOf('grace')).toBe(TENANT_STATUS_ARCHIVED);
    // Not one write to the public doc, in either direction.
    expect(ops.filter((o: Op) => o.path === 'tenants/grace' && o.op !== 'get')).toEqual([]);
  });

  it('the convergence runs after the response body is built', async () => {
    // ⚠️ "CONVERGENCE, AFTER THE ANSWER AND NEVER IN FRONT OF IT" — the rule the
    // route states for the grace timer, which the sibling has to honour too. A
    // church's admin screen must not wait on a Dodo round trip.
    //
    // Proved two ways. First, the Dodo call MUTATES the private doc as a side
    // effect: if convergence ran before the answer was read, the response would
    // report the hold this mock plants. It reports `none`, so the answer was
    // already fixed.
    mockGetSubscription.mockImplementation(async () => {
      firestore.set('tenant_private/grace', {
        ...firestore.get('tenant_private/grace'),
        [DODO_ON_HOLD_FIELD]: msAgo(DODO_GRACE_PERIOD_MS + DAY_MS),
      });
      return subscription('active');
    });

    const res = await GET(request(OWNER));

    expect(await res.json()).toEqual({ state: 'none' });
    expect(mockGetSubscription).toHaveBeenCalled();

    // Second, directly on the ordering log: the read that produced the answer
    // precedes the Dodo call.
    const firstAnswerRead = ops.findIndex((o: Op) => o.op === 'get' && o.path === 'tenant_private/grace');
    const stampWrite = ops.findIndex((o: Op) => o.op === 'set' && o.path === 'tenant_private/grace');
    expect(firstAnswerRead).toBeGreaterThanOrEqual(0);
    expect(stampWrite).toBeGreaterThan(firstAnswerRead);
  });

  it('a Dodo failure during convergence does not change the response or its status code', async () => {
    // A Dodo outage must not 500 a route the admin shell mounts on. The answer
    // came from Firestore and the resolver; it is correct either way.
    const healthy = await GET(request(OWNER));
    const healthyBody = await healthy.json();

    mockGetSubscription.mockRejectedValue(new Error('dodo unavailable'));
    const broken = await GET(request(OWNER));
    const brokenBody = await broken.json();

    expect(broken.status).toBe(healthy.status);
    expect(broken.status).toBe(200);
    expect(brokenBody).toEqual(healthyBody);
    // And the tenant is untouched — a failed read is never read as "cancelled".
    expect(statusOf('grace')).toBe(TENANT_STATUS_ACTIVE);
  });

  it('a Dodo failure is captured as a money-path error', async () => {
    // Failing quietly would mean the convergence could stop working and nobody
    // would learn it from anywhere except the defect it was built to prevent.
    mockGetSubscription.mockRejectedValue(new Error('dodo unavailable'));

    await GET(request(OWNER));

    expect(mockCaptureMoneyPathError).toHaveBeenCalled();
    const context = mockCaptureMoneyPathError.mock.calls.at(-1)?.[1];
    expect(context.step).toBe('dodo-subscription-converge');
    expect(context.tenantId).toBe('grace');
  });

  it('the convergence does not call Dodo more than once per throttle interval', async () => {
    // ⚠️ THE THROTTLE. This route runs on every admin shell mount, and THE-139
    // was a 429 on this exact route that stripped the admin nav. A Dodo API call
    // per page load is not acceptable.
    await GET(request(OWNER));
    await GET(request(OWNER));
    await GET(request(OWNER));

    expect(mockGetSubscription).toHaveBeenCalledTimes(1);
    // The stamp is what makes the second and third loads cheap.
    expect(firestore.get('tenant_private/grace')[DODO_SUBSCRIPTION_CHECK_FIELD]).toBeTruthy();

    // Once the interval has elapsed it asks again — a throttle, not an off switch.
    firestore.set('tenant_private/grace', {
      ...firestore.get('tenant_private/grace'),
      [DODO_SUBSCRIPTION_CHECK_FIELD]: msAgo(DODO_SUBSCRIPTION_CHECK_INTERVAL_MS + 60_000),
    });
    await GET(request(OWNER));

    expect(mockGetSubscription).toHaveBeenCalledTimes(2);
  });

  it('a throttled load writes nothing at all', async () => {
    // The throttle is checked off the private doc the convergence already read,
    // so the common case costs no write on the hottest path in the app.
    await GET(request(OWNER));
    ops.length = 0;

    await GET(request(OWNER));

    expect(ops.filter((o: Op) => o.op === 'set' || o.op === 'update')).toEqual([]);
  });

  it('the archive is performed by the same path the webhook uses, not a second writer', async () => {
    // 🔴 ONE WRITER. The webhook is the single writer of the lifecycle state, and
    // the convergence must reach it rather than become a second one. Proved by
    // running the REAL `subscription.cancelled` handler against an identical
    // tenant and comparing what each leaves behind — a hand-rolled `status`
    // write here would diverge on the provenance the batch carries.
    firestore.set('tenants/webhooked', { ownerId: OWNER.uid, status: TENANT_STATUS_ACTIVE });
    firestore.set('tenant_private/webhooked', {
      billingProcessor: 'dodo',
      dodoSubscriptionId: 'sub_webhooked',
      dodoCustomerId: 'cus_webhooked',
    });

    await handleDodoSubscriptionCancelled({
      type: 'subscription.cancelled',
      data: { subscription_id: 'sub_webhooked' },
    } as any);

    mockGetSubscription.mockResolvedValue(subscription('cancelled'));
    ops.length = 0;
    await GET(request(OWNER));

    const converged = firestore.get('tenant_private/grace');
    const webhooked = firestore.get('tenant_private/webhooked');

    // Same public lifecycle state...
    expect(statusOf('grace')).toBe(statusOf('webhooked'));
    expect(statusOf('grace')).toBe(TENANT_STATUS_ARCHIVED);
    // ...and the same private provenance the one archive path writes.
    expect(converged.dodoSubscriptionStatus).toBe(webhooked.dodoSubscriptionStatus);
    expect(converged.archivedAt).toBeTruthy();

    // 🔴 And it landed as ONE BATCH — the public status and the private
    // provenance together, exactly as the webhook's archive does. A loose
    // `tenants/{id}.update` would be the duplicated-writer shape.
    const publicWrite = ops.find((o: Op) => o.path === 'tenants/grace' && o.op !== 'get');
    expect(publicWrite?.via).toBe('batch');
  });

  it('the grace timer and its convergence are unchanged', async () => {
    // ⚠️ THE-167 does not touch the 21-day clock. The real resolver and the real
    // `convergeExpiredDodoGrace` run here: a hold inside the window still
    // reports a countdown, and a hold past it still archives with the grace
    // timer's OWN provenance reason — not the subscription convergence's.
    firestore.set('tenant_private/grace', {
      ...firestore.get('tenant_private/grace'),
      [DODO_ON_HOLD_FIELD]: msAgo(7 * DAY_MS),
    });

    const inWindow = await GET(request(OWNER));
    const body = await inWindow.json();
    expect(body.state).toBe('in-grace');
    expect(body.daysRemaining).toBe(DODO_GRACE_PERIOD_MS / DAY_MS - 7);
    expect(statusOf('grace')).toBe(TENANT_STATUS_ACTIVE);

    // Past the window: the grace timer archives, on its own reason code, while
    // Dodo still reports the subscription active.
    firestore.set('tenant_private/grace', {
      ...firestore.get('tenant_private/grace'),
      [DODO_ON_HOLD_FIELD]: msAgo(DODO_GRACE_PERIOD_MS + DAY_MS),
    });

    const expired = await GET(request(OWNER));
    expect((await expired.json()).state).toBe('expired');
    expect(statusOf('grace')).toBe(TENANT_STATUS_ARCHIVED);
    expect(firestore.get('tenant_private/grace').dodoSubscriptionStatus).toBe('grace-expired');
  });

  it('no raw private field appears in the response', async () => {
    // Only the derived state ships. The hold timestamp, the Dodo identifiers and
    // the new throttle stamp are all server-only.
    firestore.set('tenant_private/grace', {
      ...firestore.get('tenant_private/grace'),
      [DODO_ON_HOLD_FIELD]: msAgo(7 * DAY_MS),
    });
    mockGetSubscription.mockResolvedValue(subscription('active'));

    const res = await GET(request(OWNER));
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(['daysRemaining', 'graceEndsAt', 'state']);
    const serialized = JSON.stringify(body);
    for (const field of [
      DODO_ON_HOLD_FIELD,
      DODO_SUBSCRIPTION_CHECK_FIELD,
      'dodoSubscriptionId',
      'dodoCustomerId',
      'dodoSubscriptionStatus',
      'billingProcessor',
      'adminEmails',
      'sub_grace',
      'cus_grace',
    ]) {
      expect(serialized, field).not.toContain(field);
    }
  });

  it('an unauthenticated caller still gets 401 before anything else', async () => {
    const res = await GET(request(null));

    expect(res.status).toBe(401);
    // 🔴 Nothing ran behind the gate: no Dodo call, and no write of any kind.
    expect(mockGetSubscription).not.toHaveBeenCalled();
    expect(ops.filter((o: Op) => o.op === 'set' || o.op === 'update')).toEqual([]);
  });

  it('a Stripe-owned tenant is never asked about at Dodo', async () => {
    // The refusal `./lifecycle` already makes, inherited before any network
    // call: a tenant Dodo does not own is not Dodo's to read or to archive.
    firestore.set('tenant_private/grace', {
      adminEmails: ['roster@grace.org'],
      billingProcessor: 'stripe',
      stripeCustomerId: 'cus_stripe',
    });

    const res = await GET(request(OWNER));

    expect(res.status).toBe(200);
    expect(mockGetSubscription).not.toHaveBeenCalled();
    expect(statusOf('grace')).toBe(TENANT_STATUS_ACTIVE);
  });
});

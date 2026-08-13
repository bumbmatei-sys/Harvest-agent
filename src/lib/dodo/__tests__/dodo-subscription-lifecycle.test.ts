import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SeenEventStore } from '../webhook-dispatch';

/**
 * REP-4 PR 3 (part 1 of 2): `subscription.cancelled` and `subscription.expired`.
 *
 * 🔴 The regression this file exists for is one sentence long: a church cancels
 * through Dodo's hosted portal, Dodo stops billing them, and Harvest leaves the
 * tenant `active` with full entitlements forever. Test 1 is that sentence.
 *
 * ⚠️ The rest of the file is the OTHER half of the decision, which matters just
 * as much: the downgrade must not become a lockout. Admins keep login and read,
 * every export keeps working, and reactivation puts the church back exactly as
 * it was — same subdomain, same data, same members.
 *
 * Giving (server-side refusal) and the export routes are exercised through the
 * REAL routes in `dodo-cancelled-giving-and-exports.test.ts`, which needs a
 * different set of module mocks and therefore a different file.
 */

const SRC = resolve(__dirname, '../../..');

// ── An in-memory Firestore, faithful to the parts the handlers use ───────────

function makeDb() {
  const store = new Map<string, Record<string, any>>();
  const key = (coll: string, id: string) => `${coll}/${id}`;

  const docRef = (coll: string, id: string) => ({
    __coll: coll,
    __id: id,
    async get() {
      const data = store.get(key(coll, id));
      // `data` is a METHOD on a Firestore snapshot, not a property.
      return { id, exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
    },
    async update(patch: Record<string, any>) {
      const existing = store.get(key(coll, id));
      if (!existing) throw new Error(`update on missing doc ${key(coll, id)}`);
      store.set(key(coll, id), { ...existing, ...patch });
    },
    async set(data: Record<string, any>, options?: { merge?: boolean }) {
      const existing = options?.merge ? store.get(key(coll, id)) : undefined;
      store.set(key(coll, id), { ...(existing || {}), ...data });
    },
  });

  const collection = (coll: string) => {
    const filters: [string, any][] = [];
    const api: any = {
      doc: (id: string) => docRef(coll, id),
      where(field: string, _op: string, value: any) {
        filters.push([field, value]);
        return api;
      },
      limit() { return api; },
      async get() {
        const docs = [...store.entries()]
          .filter(([k]) => k.startsWith(`${coll}/`))
          .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
          .map(([k, data]) => ({ id: k.slice(coll.length + 1), data: () => ({ ...data }) }));
        return { empty: docs.length === 0, docs, size: docs.length };
      },
    };
    return api;
  };

  return {
    store,
    collection: vi.fn(collection),
    batch() {
      const writes: Array<() => void> = [];
      return {
        set(ref: any, data: Record<string, any>, options?: { merge?: boolean }) {
          writes.push(() => {
            const existing = options?.merge ? store.get(key(ref.__coll, ref.__id)) : undefined;
            store.set(key(ref.__coll, ref.__id), { ...(existing || {}), ...data });
          });
        },
        update(ref: any, patch: Record<string, any>) {
          writes.push(() => {
            const existing = store.get(key(ref.__coll, ref.__id));
            if (!existing) throw new Error(`update on missing doc ${key(ref.__coll, ref.__id)}`);
            store.set(key(ref.__coll, ref.__id), { ...existing, ...patch });
          });
        },
        async commit() { for (const write of writes) write(); },
      };
    },
  };
}

const { mockCapture, mockSetCustomClaims, mockGetUser } = vi.hoisted(() => ({
  mockCapture: vi.fn(),
  mockSetCustomClaims: vi.fn().mockResolvedValue(undefined),
  mockGetUser: vi.fn(),
}));

let currentDb = makeDb();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => currentDb.collection(name),
    batch: () => currentDb.batch(),
  },
  adminAuth: { getUser: (...args: any[]) => mockGetUser(...args) },
}));
vi.mock('@/lib/set-custom-claims', () => ({ setCustomClaims: mockSetCustomClaims }));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: mockCapture }));

const {
  archiveTenantForDodoSubscription,
  handleDodoSubscriptionCancelled,
  handleDodoSubscriptionExpired,
  handleDodoSubscriptionOnHold,
  handleDodoSubscriptionRenewed,
  recordDodoSubscriptionOnHold,
  convergeExpiredDodoGrace,
  reactivateTenantForDodoSubscription,
} = await import('../lifecycle');
const { handleDodoSubscriptionActive } = await import('../provisioning');
const { receiveDodoWebhookEvent, DODO_EVENT_HANDLERS } = await import('../webhook-dispatch');
const {
  tenantAllows,
  tenantCapabilities,
  TENANT_CAPABILITIES,
  NEVER_GATED,
  TENANT_STATUS_ARCHIVED,
  DODO_GRACE_PERIOD_DAYS,
  DODO_GRACE_PERIOD_MS,
  resolveTenantGraceState,
  resolveEffectiveTenantStatus,
} = await import('@/lib/tenant-lifecycle');
const { DODO_ON_HOLD_FIELD } = await import('@/lib/tenant-private');

const SUB_ID = 'sub_dodo_1';

// ── Time fixtures for the grace window ───────────────────────────────────────
//
// ⚠️ Every offset below is expressed in terms of DODO_GRACE_PERIOD_DAYS, never
// as the literal 21. The shipped value is pinned ONCE, in its own test, so that
// changing the window updates exactly one assertion instead of silently
// invalidating every boundary test in this file.

const DAY_MS = 24 * 60 * 60 * 1000;
/** The moment the renewal failed. A fixed instant — no clock is read. */
const HELD_AT = Date.parse('2026-05-01T00:00:00.000Z');
/** `now`, expressed as whole days after the hold started. */
const daysAfterHold = (days: number) => HELD_AT + days * DAY_MS;
/** Comfortably inside the window. */
const DURING_GRACE = daysAfterHold(DODO_GRACE_PERIOD_DAYS - 1);
/** The first instant the window is closed. */
const WINDOW_CLOSED = HELD_AT + DODO_GRACE_PERIOD_MS;
/** Well past it. */
const AFTER_GRACE = daysAfterHold(DODO_GRACE_PERIOD_DAYS + 5);

const onHoldEvent = (subscriptionId = SUB_ID) => ({
  type: 'subscription.on_hold',
  data: { payload_type: 'Subscription', subscription_id: subscriptionId, status: 'on_hold' },
});
const renewedEvent = (subscriptionId = SUB_ID) => ({
  type: 'subscription.renewed',
  data: { payload_type: 'Subscription', subscription_id: subscriptionId, status: 'active' },
});
const activeEvent = (subscriptionId = SUB_ID) => ({
  type: 'subscription.active',
  data: {
    payload_type: 'Subscription',
    subscription_id: subscriptionId,
    product_id: 'pdt_0NlAMMp4QndR3qPzlD8sG',
    status: 'active',
    metadata: { newTenant: 'true', userId: 'user_1', ministryName: 'Grace Church' },
  },
});

/** A live Dodo-owned church, exactly as `provisioning.ts` leaves one. */
function seedDodoTenant(overrides: { status?: string; plan?: string } = {}) {
  currentDb.store.set('tenants/gracechurch', {
    name: 'Grace Church',
    subdomain: 'gracechurch',
    plan: overrides.plan ?? 'max',
    status: overrides.status ?? 'active',
    config: {},
    ownerId: 'user_1',
    createdBy: 'user_1',
    setupCompleted: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  currentDb.store.set('tenant_private/gracechurch', {
    adminEmails: ['pastor@gracechurch.org'],
    dodoCustomerId: 'cus_dodo_1',
    dodoSubscriptionId: SUB_ID,
    dodoProductId: 'pdt_0NlAMMp4QndR3qPzlD8sG',
    billingProcessor: 'dodo',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

/** A Stripe-owned church. Nothing in this PR may touch one. */
function seedStripeTenant() {
  currentDb.store.set('tenants/stripechurch', {
    name: 'Stripe Church',
    subdomain: 'stripechurch',
    plan: 'pro',
    status: 'active',
    config: {},
    ownerId: 'user_2',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  currentDb.store.set('tenant_private/stripechurch', {
    adminEmails: ['pastor@stripechurch.org'],
    stripeCustomerId: 'cus_stripe_1',
    stripeSubscriptionId: 'sub_stripe_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

const cancelledEvent = (subscriptionId = SUB_ID) => ({
  type: 'subscription.cancelled',
  data: { payload_type: 'Subscription', subscription_id: subscriptionId, status: 'cancelled' },
});
const expiredEvent = (subscriptionId = SUB_ID) => ({
  type: 'subscription.expired',
  data: { payload_type: 'Subscription', subscription_id: subscriptionId, status: 'expired' },
});

const tenant = (id = 'gracechurch') => currentDb.store.get(`tenants/${id}`)!;
const priv = (id = 'gracechurch') => currentDb.store.get(`tenant_private/${id}`)!;

beforeEach(() => {
  vi.clearAllMocks();
  currentDb = makeDb();
});

// ─── Test 1 — the whole issue, in one assertion ──────────────────────────────

describe('subscription.cancelled moves the tenant out of active', () => {
  it('moves the tenant out of active', async () => {
    // 🔴 THE REGRESSION TEST FOR THE WHOLE ISSUE. Before this handler existed,
    // a cancelled church stayed `active` with full entitlements indefinitely.
    seedDodoTenant();

    await handleDodoSubscriptionCancelled(cancelledEvent() as any);

    expect(tenant().status).not.toBe('active');
    expect(tenant().status).toBe(TENANT_STATUS_ARCHIVED);
  });

  it('subscription.expired lands in the SAME state — both are terminal', async () => {
    seedDodoTenant();
    await handleDodoSubscriptionExpired(expiredEvent() as any);
    expect(tenant().status).toBe(TENANT_STATUS_ARCHIVED);
  });

  it('records WHICH event ended it, privately, without giving it a second state', () => {
    // The distinction between "a decision" and "end of term" survives as
    // provenance on the server-only doc. It is not a lifecycle state, because
    // the capability answer is identical and a second state would be a second
    // source of entitlement truth.
    return (async () => {
      seedDodoTenant();
      await handleDodoSubscriptionCancelled(cancelledEvent() as any);
      expect(priv().dodoSubscriptionStatus).toBe('cancelled');
      expect(priv().archivedAt).toEqual(expect.any(String));
    })();
  });

  it('leaves `plan` alone — it is the tier reactivation restores', async () => {
    // ⚠️ The Stripe path rewrites plan to 'plus' on cancellation. That both
    // destroys the record of what to restore AND hands the church a working
    // paid tier, donate page included. Neither happens here.
    seedDodoTenant({ plan: 'max' });
    await handleDodoSubscriptionCancelled(cancelledEvent() as any);
    expect(tenant().plan).toBe('max');
  });

  it('leaves the subdomain, the name and the owner untouched', async () => {
    seedDodoTenant();
    const before = { ...tenant() };
    await handleDodoSubscriptionCancelled(cancelledEvent() as any);
    expect(tenant().subdomain).toBe(before.subdomain);
    expect(tenant().name).toBe(before.name);
    expect(tenant().ownerId).toBe(before.ownerId);
    expect(tenant().setupCompleted).toBe(before.setupCompleted);
  });

  it('leaves the admin roster intact — archived is not locked out', async () => {
    seedDodoTenant();
    await handleDodoSubscriptionCancelled(cancelledEvent() as any);
    expect(priv().adminEmails).toEqual(['pastor@gracechurch.org']);
  });

  it('does nothing when no tenant carries the subscription', async () => {
    const outcome = await handleDodoSubscriptionCancelled(cancelledEvent('sub_unknown') as any);
    expect(outcome).toEqual({ outcome: 'no-tenant', subscriptionId: 'sub_unknown' });
  });

  it('reports, rather than throws, when the payload has no subscription id', async () => {
    // BEST-EFFORT event: the route has already answered 2xx, so a throw would be
    // an unhandled rejection nobody sees. It is captured instead.
    const outcome = await handleDodoSubscriptionCancelled({ type: 'subscription.cancelled', data: {} } as any);
    expect(outcome).toEqual({ outcome: 'no-subscription-id' });
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'dodo-lifecycle-missing-subscription-id', level: 'error' }),
    );
  });
});

// ─── Tests 2, 3 and 5 — the capability table itself ──────────────────────────

describe('an admin of a cancelled tenant can still log in and read', () => {
  it('keeps login and admin read in the archived state', () => {
    expect(tenantAllows(TENANT_STATUS_ARCHIVED, 'login')).toBe(true);
    expect(tenantAllows(TENANT_STATUS_ARCHIVED, 'adminRead')).toBe(true);
  });

  it('keeps login and admin read in EVERY state, known or not', () => {
    for (const status of ['active', 'pending', 'suspended', 'past_due', 'cancelled', TENANT_STATUS_ARCHIVED, undefined, null, 'nonsense']) {
      expect(tenantAllows(status, 'login')).toBe(true);
      expect(tenantAllows(status, 'adminRead')).toBe(true);
    }
  });

  it('is never consulted by the auth layer at all', () => {
    // The strongest form of "login still works": the module that decides whether
    // a request is authenticated has no idea a lifecycle state exists.
    const auth = readFileSync(join(SRC, 'lib/api-auth.ts'), 'utf8');
    expect(auth).not.toContain('tenant-lifecycle');
    expect(auth).not.toContain('archived');
  });
});

describe('every export still works for a cancelled tenant', () => {
  it('allows `export` for an archived tenant', () => {
    // 🔴 THE MOST IMPORTANT TEST HERE. A church has a legal need for its own
    // giving records; withholding a donor CSV or a year-end statement behind a
    // paywall is indefensible.
    expect(tenantAllows(TENANT_STATUS_ARCHIVED, 'export')).toBe(true);
  });

  it('allows `export` in every state this build can produce, and in states it cannot', () => {
    for (const status of ['active', 'pending', 'suspended', 'past_due', 'cancelled', TENANT_STATUS_ARCHIVED, undefined, null, '', 'whatever']) {
      expect(tenantAllows(status, 'export')).toBe(true);
    }
  });

  it('keeps `export` on the list of capabilities no state may gate', () => {
    // Structural, not enumerative: gating an export means DELETING it from
    // NEVER_GATED, which is a visible edit rather than a state someone forgot.
    expect(NEVER_GATED).toContain('export');
  });
});

describe('publishing and sending are refused', () => {
  it('refuses publishing and sending for an archived tenant', () => {
    expect(tenantAllows(TENANT_STATUS_ARCHIVED, 'publishing')).toBe(false);
    expect(tenantAllows(TENANT_STATUS_ARCHIVED, 'sending')).toBe(false);
  });

  it('refuses giving for an archived tenant — first to stop', () => {
    expect(tenantAllows(TENANT_STATUS_ARCHIVED, 'giving')).toBe(false);
  });

  it('reports the whole capability set for an archived tenant', () => {
    expect(tenantCapabilities(TENANT_STATUS_ARCHIVED)).toEqual({
      login: true,
      adminRead: true,
      export: true,
      giving: false,
      publishing: false,
      sending: false,
    });
  });

  it('changes nothing for any other state — including the Stripe terminal one', () => {
    // ⚠️ `cancelled` is what the STRIPE webhook writes on
    // customer.subscription.deleted. It stays ungated, so this PR changes no
    // Stripe-owned tenant's behaviour. See the PR body.
    for (const status of ['active', 'pending', 'suspended', 'past_due', 'cancelled', undefined, 'unknown']) {
      for (const capability of TENANT_CAPABILITIES) {
        expect(tenantAllows(status, capability)).toBe(true);
      }
    }
  });

  it('wires the gate into the real publish and send surfaces', () => {
    // Client-gated, and the PR body says so. This pins that the gate is
    // actually attached to the buttons rather than only living in a module.
    for (const file of ['components/AdminBlogPostEditor.tsx', 'components/NewsletterEditor.tsx']) {
      expect(readFileSync(join(SRC, file), 'utf8')).toContain('useTenantCapability');
    }
  });
});

// ─── Test 6 — cancelled then expired applies once ────────────────────────────

describe('cancelled then expired for one subscription applies once', () => {
  it('archives on the first event and writes NOTHING on the second', async () => {
    seedDodoTenant();

    const first = await handleDodoSubscriptionCancelled(cancelledEvent() as any);
    const archivedAt = priv().archivedAt;
    const updatedAt = tenant().updatedAt;

    const second = await handleDodoSubscriptionExpired(expiredEvent() as any);

    expect(first).toEqual({ outcome: 'archived', tenantId: 'gracechurch', reason: 'cancelled' });
    expect(second).toEqual({ outcome: 'already-archived', tenantId: 'gracechurch' });
    // Not merely "the same state": the documents were not written at all, which
    // is what makes "applies once" observable rather than a coincidence of the
    // second write happening to be identical.
    expect(priv().archivedAt).toBe(archivedAt);
    expect(tenant().updatedAt).toBe(updatedAt);
    expect(priv().dodoSubscriptionStatus).toBe('cancelled');
  });

  it('applies once in the other order too', async () => {
    seedDodoTenant();
    await handleDodoSubscriptionExpired(expiredEvent() as any);
    const outcome = await handleDodoSubscriptionCancelled(cancelledEvent() as any);
    expect(outcome).toEqual({ outcome: 'already-archived', tenantId: 'gracechurch' });
    expect(priv().dodoSubscriptionStatus).toBe('expired');
  });

  it('survives five deliveries of the two events interleaved', async () => {
    seedDodoTenant();
    for (let i = 0; i < 5; i++) {
      await handleDodoSubscriptionCancelled(cancelledEvent() as any);
      await handleDodoSubscriptionExpired(expiredEvent() as any);
    }
    expect(tenant().status).toBe(TENANT_STATUS_ARCHIVED);
    expect(tenant().plan).toBe('max');
    expect(priv().dodoSubscriptionStatus).toBe('cancelled');
  });

  it('neither event undoes the other', async () => {
    seedDodoTenant();
    await handleDodoSubscriptionExpired(expiredEvent() as any);
    await handleDodoSubscriptionCancelled(cancelledEvent() as any);
    await handleDodoSubscriptionExpired(expiredEvent() as any);
    expect(tenant().status).toBe(TENANT_STATUS_ARCHIVED);
  });
});

// ─── Test 7 — a replayed webhook-id changes nothing ──────────────────────────

describe('a replayed webhook-id changes nothing', () => {
  function memoryStore(): SeenEventStore {
    const seen = new Set<string>();
    return {
      async reserve(id) { if (seen.has(id)) return false; seen.add(id); return true; },
      async release(id) { seen.delete(id); },
    };
  }

  it('runs the cancellation once across five redeliveries of one id', async () => {
    seedDodoTenant();
    const store = memoryStore();
    const handler = vi.fn(handleDodoSubscriptionCancelled);
    const handlers = { ...DODO_EVENT_HANDLERS, 'subscription.cancelled': handler } as any;

    const outcomes = [];
    for (let i = 0; i < 5; i++) {
      outcomes.push(await receiveDodoWebhookEvent('whk_1', cancelledEvent() as any, { store, handlers }));
    }

    expect(handler).toHaveBeenCalledTimes(1);
    expect(outcomes[0].outcome).toBe('routed');
    expect(outcomes.slice(1).every((o) => o.outcome === 'duplicate')).toBe(true);
  });

  it('leaves the archived tenant byte-identical after the replays', async () => {
    seedDodoTenant();
    const store = memoryStore();

    await receiveDodoWebhookEvent('whk_1', cancelledEvent() as any, { store });
    const afterFirst = { tenant: { ...tenant() }, priv: { ...priv() } };

    for (let i = 0; i < 4; i++) {
      await receiveDodoWebhookEvent('whk_1', cancelledEvent() as any, { store });
    }

    expect(tenant()).toEqual(afterFirst.tenant);
    expect(priv()).toEqual(afterFirst.priv);
  });

  it('routes the two events through the dispatcher at all', () => {
    // The gap this PR closes was "recognised, no handler". Pin that both slots
    // are now filled — an empty function would satisfy every behavioural test
    // above only by never being reached.
    expect(DODO_EVENT_HANDLERS['subscription.cancelled']).toBe(handleDodoSubscriptionCancelled);
    expect(DODO_EVENT_HANDLERS['subscription.expired']).toBe(handleDodoSubscriptionExpired);
  });

  it('routes subscription.on_hold to the grace timer — it is no longer a no-op', async () => {
    // ⚠️ This slot USED to be empty, with a comment saying `on_hold` needed a
    // timer rather than a handler. It needs both: an event to start the clock,
    // and a derived deadline the gates enforce.
    seedDodoTenant();
    await DODO_EVENT_HANDLERS['subscription.on_hold'](onHoldEvent() as any);
    // 🔴 Recording the hold is NOT enforcing it. The tenant is still active.
    expect(tenant().status).toBe('active');
    expect(priv()[DODO_ON_HOLD_FIELD]).toEqual(expect.any(String));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REP-4 part 3 — the `on_hold` grace timer
// ═══════════════════════════════════════════════════════════════════════════

// ─── The shipped window, pinned exactly once ─────────────────────────────────

describe('the grace window is the 21 days REP-4 decided on', () => {
  it('ships 21 days', () => {
    // 🔴 THE ONLY PLACE THE LITERAL APPEARS. Every other test in this file
    // derives its offsets from the constant, so changing the window here changes
    // this assertion alone rather than quietly moving every boundary test with
    // it. Dodo's own recovery window is assumed to be SHORTER (THE-90) — that
    // assumption is stated in the constant's comment, which is the thing a
    // reader finds first.
    expect(DODO_GRACE_PERIOD_DAYS).toBe(21);
    expect(DODO_GRACE_PERIOD_MS).toBe(21 * 24 * 60 * 60 * 1000);
  });
});

// ─── The resolver, exercised directly ────────────────────────────────────────

describe('the grace resolver is pure and reads no clock', () => {
  it('reports no grace when nothing is on hold', () => {
    expect(resolveTenantGraceState({ onHoldAt: undefined, now: AFTER_GRACE })).toBe('none');
    expect(resolveTenantGraceState({ onHoldAt: null, now: AFTER_GRACE })).toBe('none');
    expect(resolveTenantGraceState({ onHoldAt: '', now: AFTER_GRACE })).toBe('none');
  });

  it('fails OPEN on a timestamp it cannot parse', () => {
    // ⚠️ Same reasoning as an unknown `status`: refusing would take a paying
    // church's donate page down because a field did not parse. Allowing costs
    // revenue. Those are not comparable.
    expect(resolveTenantGraceState({ onHoldAt: 'not-a-date', now: AFTER_GRACE })).toBe('none');
    expect(resolveEffectiveTenantStatus({ status: 'active', onHoldAt: 'not-a-date', now: AFTER_GRACE }))
      .toBe('active');
  });

  it('is in grace up to the last instant before the window closes', () => {
    expect(resolveTenantGraceState({ onHoldAt: new Date(HELD_AT).toISOString(), now: HELD_AT })).toBe('in-grace');
    expect(resolveTenantGraceState({ onHoldAt: new Date(HELD_AT).toISOString(), now: DURING_GRACE })).toBe('in-grace');
    expect(resolveTenantGraceState({ onHoldAt: new Date(HELD_AT).toISOString(), now: WINDOW_CLOSED - 1 }))
      .toBe('in-grace');
  });

  it('is expired at exactly the boundary, and after it', () => {
    // The boundary is CLOSED: the instant the window elapses is expired, not the
    // last moment of grace. Pinned because "21 days" does not say which side the
    // moment itself falls on.
    expect(resolveTenantGraceState({ onHoldAt: new Date(HELD_AT).toISOString(), now: WINDOW_CLOSED })).toBe('expired');
    expect(resolveTenantGraceState({ onHoldAt: new Date(HELD_AT).toISOString(), now: AFTER_GRACE })).toBe('expired');
  });

  it('returns the recorded status untouched for every tenant with no hold', () => {
    for (const status of ['active', 'pending', 'suspended', 'past_due', 'cancelled', undefined, 'nonsense']) {
      expect(resolveEffectiveTenantStatus({ status, onHoldAt: undefined, now: AFTER_GRACE })).toBe(status);
    }
  });

  it('reads no clock of its own — the same inputs always give the same answer', () => {
    // 🔴 The property the injected `now` exists for. Called twice with a fixed
    // `now`, minutes of real time apart in a slow suite, it cannot disagree.
    const args = { status: 'active', onHoldAt: new Date(HELD_AT).toISOString(), now: DURING_GRACE };
    expect(resolveEffectiveTenantStatus(args)).toBe(resolveEffectiveTenantStatus(args));
    expect(resolveEffectiveTenantStatus(args)).toBe('active');
  });
});

// ─── Test 1 — on_hold records the hold and does not archive immediately ──────

describe('on_hold records the hold and does not archive immediately', () => {
  it('records the hold and does not archive immediately', async () => {
    // 🔴 THE HALF OF THIS THAT IS EASY TO GET WRONG. A failed renewal is
    // probably an expired card, not a decision to leave. Archiving on the event
    // would take a church's donate page down the day their card expired.
    seedDodoTenant();

    const outcome = await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);

    expect(outcome).toMatchObject({ outcome: 'on-hold-recorded', tenantId: 'gracechurch' });
    expect(tenant().status).toBe('active');
    expect(tenantAllows(tenant().status, 'giving')).toBe(true);
  });

  it('writes the deadline to the SERVER-ONLY doc and adds no public field', async () => {
    // 🔴 `tenants/{id}` is world-readable (`allow read: if true`). A
    // billing-trouble timestamp there would publish a named church's failed card
    // to anyone who asked. That is the adminEmails mistake repeated.
    seedDodoTenant();
    const publicBefore = { ...tenant() };

    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);

    expect(tenant()).toEqual(publicBefore);
    expect(priv()[DODO_ON_HOLD_FIELD]).toBe(new Date(HELD_AT).toISOString());
  });

  it('reports when the window will close, without enforcing anything yet', async () => {
    seedDodoTenant();
    const outcome = await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    expect(outcome).toMatchObject({ graceEndsAt: new Date(WINDOW_CLOSED).toISOString() });
  });

  it('leaves every capability intact for the whole window', async () => {
    seedDodoTenant();
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);

    const effective = resolveEffectiveTenantStatus({
      status: tenant().status,
      onHoldAt: priv()[DODO_ON_HOLD_FIELD],
      now: DURING_GRACE,
    });

    expect(tenantCapabilities(effective)).toEqual({
      login: true, adminRead: true, export: true, giving: true, publishing: true, sending: true,
    });
  });

  it('reports, rather than throws, when the payload has no subscription id', async () => {
    // BEST-EFFORT event: the route has already answered 2xx, so a throw would be
    // an unhandled rejection nobody sees.
    const outcome = await recordDodoSubscriptionOnHold({} as any, HELD_AT);
    expect(outcome).toEqual({ outcome: 'no-subscription-id' });
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'dodo-on-hold-missing-subscription-id', level: 'error' }),
    );
  });

  it('does nothing when no tenant carries the subscription', async () => {
    const outcome = await recordDodoSubscriptionOnHold({ subscription_id: 'sub_unknown' } as any, HELD_AT);
    expect(outcome).toEqual({ outcome: 'no-tenant', subscriptionId: 'sub_unknown' });
  });

  it('does not start a clock on a tenant a terminal event already archived', async () => {
    seedDodoTenant();
    await handleDodoSubscriptionCancelled(cancelledEvent() as any);

    const outcome = await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);

    expect(outcome).toEqual({ outcome: 'already-archived', tenantId: 'gracechurch' });
    expect(priv()[DODO_ON_HOLD_FIELD]).toBeUndefined();
  });
});

// ─── Test 2 — a second on_hold does not restart the clock ────────────────────

describe('a second on_hold does not restart the clock', () => {
  it('does not restart the clock', async () => {
    // 🔴 THE GUARD THAT MAKES THE TIMER TERMINATE. Dodo re-emits `on_hold` as
    // its own retries fail, each delivery with its OWN webhook-id — so #290's
    // redelivery guard does not cover it. Rewriting the timestamp would push the
    // deadline out every time, and a subscription failing weekly would never
    // reach it: grace would extend forever and the timer would never fire.
    seedDodoTenant();

    const first = await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    const secondOutcome = await recordDodoSubscriptionOnHold(onHoldEvent().data as any, DURING_GRACE);

    expect(first).toMatchObject({ outcome: 'on-hold-recorded' });
    expect(secondOutcome).toEqual({
      outcome: 'already-on-hold',
      tenantId: 'gracechurch',
      onHoldAt: new Date(HELD_AT).toISOString(),
    });
    // The deadline is still measured from the FIRST failure.
    expect(priv()[DODO_ON_HOLD_FIELD]).toBe(new Date(HELD_AT).toISOString());
  });

  it('still expires on schedule after five repeat holds inside the window', async () => {
    // The failure this rules out is the interesting one: a timer that never
    // fires because every retry nudged it forward.
    seedDodoTenant();
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    for (let i = 1; i <= 5; i++) {
      await recordDodoSubscriptionOnHold(onHoldEvent().data as any, daysAfterHold(i * 3));
    }

    expect(priv()[DODO_ON_HOLD_FIELD]).toBe(new Date(HELD_AT).toISOString());
    expect(resolveTenantGraceState({ onHoldAt: priv()[DODO_ON_HOLD_FIELD], now: WINDOW_CLOSED })).toBe('expired');
  });

  it('writes nothing at all on the repeat delivery', async () => {
    seedDodoTenant();
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    const after = { tenant: { ...tenant() }, priv: { ...priv() } };

    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, DURING_GRACE);

    expect(tenant()).toEqual(after.tenant);
    expect(priv()).toEqual(after.priv);
  });

  it('converges instead when the repeat arrives after the window closed', async () => {
    // Dodo is still talking to us about a subscription whose grace ran out —
    // the cheapest convergence trigger there is.
    seedDodoTenant();
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);

    const outcome = await recordDodoSubscriptionOnHold(onHoldEvent().data as any, AFTER_GRACE);

    expect(outcome).toEqual({ outcome: 'grace-expired', tenantId: 'gracechurch' });
    expect(tenant().status).toBe(TENANT_STATUS_ARCHIVED);
    expect(priv().dodoSubscriptionStatus).toBe('grace-expired');
  });
});

// ─── Test 3 — recovery clears the hold, one test per recovery event ──────────

describe('recovery clears the hold', () => {
  it('recovery clears the hold — subscription.active', async () => {
    // 🔴 THE WORST OUTCOME THIS PR CAN PRODUCE IS ARCHIVING A CHURCH THAT PAID.
    // Dodo's Payment Retries page: "`subscription.active` | A retry succeeds and
    // the subscription is reactivated". This is the documented recovery event.
    seedDodoTenant();
    currentDb.store.set('users/user_1', { tenantId: 'gracechurch' });
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);

    await handleDodoSubscriptionActive(activeEvent() as any);

    expect(priv()[DODO_ON_HOLD_FIELD]).toBeNull();
    // And the deadline is gone for good — the resolver has nothing left to fire on.
    expect(resolveEffectiveTenantStatus({
      status: tenant().status, onHoldAt: priv()[DODO_ON_HOLD_FIELD], now: AFTER_GRACE,
    })).toBe('active');
  });

  it('recovery clears the hold — subscription.renewed', async () => {
    // ⚠️ The HEDGE, and deliberately so. Dodo documents `renewed` as "Renewal
    // succeeds", and a successful retry IS a renewal succeeding, so it may fire
    // alongside or instead of `active`. Clearing on an event that did not mean
    // recovery costs one cycle's revenue; failing to clear takes a paying
    // church's donate page down on day 21.
    seedDodoTenant();
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);

    const outcome = await handleDodoSubscriptionRenewed(renewedEvent() as any);

    expect(outcome).toEqual({ outcome: 'hold-cleared', tenantId: 'gracechurch' });
    expect(priv()[DODO_ON_HOLD_FIELD]).toBeNull();
  });

  it('a church that paid on day 20 is NOT archived on day 21', async () => {
    // 🔴 The end-to-end version of the sentence above, run through the real
    // convergence path rather than asserted on the resolver.
    seedDodoTenant();
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    await handleDodoSubscriptionRenewed(renewedEvent() as any);

    const converged = await convergeExpiredDodoGrace('gracechurch', AFTER_GRACE);

    expect(converged).toEqual({ outcome: 'no-hold', tenantId: 'gracechurch' });
    expect(tenant().status).toBe('active');
    expect(tenantAllows(tenant().status, 'giving')).toBe(true);
  });

  it('clears the hold WITHOUT having to un-archive anything', async () => {
    // A tenant in grace was never archived — its status never left `active`. So
    // "reactivate only if archived" would have looked correct and left the
    // deadline running. The public doc is not written at all here.
    seedDodoTenant();
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    const publicBefore = { ...tenant() };

    await handleDodoSubscriptionRenewed(renewedEvent() as any);

    expect(tenant()).toEqual(publicBefore);
    expect(priv()[DODO_ON_HOLD_FIELD]).toBeNull();
  });

  it('clears the hold when a LATE retry succeeds after the tenant was archived', async () => {
    // The window closed, Harvest archived, and then Dodo's retry finally landed.
    // Reactivation must be total AND must not leave the stale deadline behind.
    seedDodoTenant();
    currentDb.store.set('users/user_1', { tenantId: 'gracechurch' });
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    await convergeExpiredDodoGrace('gracechurch', AFTER_GRACE);
    expect(tenant().status).toBe(TENANT_STATUS_ARCHIVED);

    await handleDodoSubscriptionActive(activeEvent() as any);

    expect(tenant().status).toBe('active');
    expect(priv()[DODO_ON_HOLD_FIELD]).toBeNull();
    expect(priv().archivedAt).toBeNull();
  });

  it('writes nothing when a renewal lands on a tenant that was never on hold', async () => {
    // The ordinary case: a healthy subscription renewing on schedule.
    seedDodoTenant();
    const before = { tenant: { ...tenant() }, priv: { ...priv() } };

    const outcome = await handleDodoSubscriptionRenewed(renewedEvent() as any);

    expect(outcome).toEqual({ outcome: 'not-archived', tenantId: 'gracechurch' });
    expect(tenant()).toEqual(before.tenant);
    expect(priv()).toEqual(before.priv);
  });

  it('survives the full failure-then-recovery cycle five times without drift', async () => {
    seedDodoTenant();
    const original = { ...tenant() };
    for (let i = 0; i < 5; i++) {
      await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
      await handleDodoSubscriptionRenewed(renewedEvent() as any);
    }
    expect({ ...tenant(), updatedAt: original.updatedAt }).toEqual(original);
    expect(priv()[DODO_ON_HOLD_FIELD]).toBeNull();
  });
});

// ─── Convergence — the recorded state catches up with the enforced one ───────

describe('an expired grace window converges to the archived state', () => {
  it('archives through the terminal handler’s own guarded path', async () => {
    seedDodoTenant();
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);

    const outcome = await convergeExpiredDodoGrace('gracechurch', AFTER_GRACE);

    expect(outcome).toEqual({ outcome: 'archived', tenantId: 'gracechurch', reason: 'grace-expired' });
    expect(tenant().status).toBe(TENANT_STATUS_ARCHIVED);
  });

  it('records WHY it ended, distinctly from a cancellation', async () => {
    // Provenance, never a gate. A human reading tenant_private needs to tell
    // "they left" from "their card failed and nobody fixed it in 21 days".
    seedDodoTenant();
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    await convergeExpiredDodoGrace('gracechurch', AFTER_GRACE);

    expect(priv().dodoSubscriptionStatus).toBe('grace-expired');
    expect(priv().archivedAt).toEqual(expect.any(String));
  });

  it('writes nothing while the tenant is still inside the window', async () => {
    seedDodoTenant();
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    const before = { tenant: { ...tenant() }, priv: { ...priv() } };

    const outcome = await convergeExpiredDodoGrace('gracechurch', DURING_GRACE);

    expect(outcome).toEqual({ outcome: 'in-grace', tenantId: 'gracechurch' });
    expect(tenant()).toEqual(before.tenant);
    expect(priv()).toEqual(before.priv);
  });

  it('does nothing for a tenant with no hold at all', async () => {
    seedDodoTenant();
    const outcome = await convergeExpiredDodoGrace('gracechurch', AFTER_GRACE);
    expect(outcome).toEqual({ outcome: 'no-hold', tenantId: 'gracechurch' });
    expect(tenant().status).toBe('active');
  });

  it('applies once — a second convergence writes nothing', async () => {
    seedDodoTenant();
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    await convergeExpiredDodoGrace('gracechurch', AFTER_GRACE);
    const after = { tenant: { ...tenant() }, priv: { ...priv() } };

    const second = await convergeExpiredDodoGrace('gracechurch', AFTER_GRACE);

    expect(second).toEqual({ outcome: 'already-archived', tenantId: 'gracechurch' });
    expect(tenant()).toEqual(after.tenant);
    expect(priv()).toEqual(after.priv);
  });

  it('leaves the tenant reactivatable — archiving took nothing away', async () => {
    seedDodoTenant();
    const before = { ...tenant() };
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    await convergeExpiredDodoGrace('gracechurch', AFTER_GRACE);

    await reactivateTenantForDodoSubscription('gracechurch');

    expect({ ...tenant(), updatedAt: before.updatedAt }).toEqual(before);
  });
});

// ─── Test 9 — plan is never rewritten ────────────────────────────────────────

describe('plan is never rewritten', () => {
  it('is never rewritten by the hold, the expiry, or the recovery', async () => {
    // 🔴 `plan` is the TIER reactivation restores. Overwriting it means the
    // church comes back on the wrong product — and a rewrite to the entry tier
    // (which is what the Stripe path does) hands them a working paid tier with a
    // live donate page, so it does not even stop anything.
    seedDodoTenant({ plan: 'max' });

    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    expect(tenant().plan).toBe('max');

    await convergeExpiredDodoGrace('gracechurch', AFTER_GRACE);
    expect(tenant().plan).toBe('max');

    await reactivateTenantForDodoSubscription('gracechurch');
    expect(tenant().plan).toBe('max');
  });

  it.each(['plus', 'pro', 'max'])('survives the whole grace cycle on the %s tier', async (plan) => {
    seedDodoTenant({ plan });
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    await convergeExpiredDodoGrace('gracechurch', AFTER_GRACE);
    await reactivateTenantForDodoSubscription('gracechurch');
    expect(tenant().plan).toBe(plan);
  });

  it('never rewrites the per-user copy of the tier either', async () => {
    seedDodoTenant({ plan: 'max' });
    currentDb.store.set('users/user_1', { tenantId: 'gracechurch', role: 'admin', plan: 'max' });
    const before = { ...currentDb.store.get('users/user_1')! };

    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    await convergeExpiredDodoGrace('gracechurch', AFTER_GRACE);

    expect(currentDb.store.get('users/user_1')).toEqual(before);
  });
});

// ─── Tests 7 and 8 — ownership refusals on every write the timer adds ────────

describe('a Stripe-owned tenant is untouched by on_hold', () => {
  it('is untouched by on_hold', async () => {
    // A Dodo event cannot even find a Stripe church: the lookup is by Dodo
    // subscription id, and it carries none.
    seedStripeTenant();
    const before = { tenant: { ...tenant('stripechurch') }, priv: { ...priv('stripechurch') } };

    const outcome = await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);

    expect(outcome).toEqual({ outcome: 'no-tenant', subscriptionId: SUB_ID });
    expect(tenant('stripechurch')).toEqual(before.tenant);
    expect(priv('stripechurch')).toEqual(before.priv);
  });

  it('holds only the Dodo church when both exist side by side', async () => {
    seedDodoTenant();
    seedStripeTenant();
    const stripeBefore = { ...priv('stripechurch') };

    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);

    expect(priv('gracechurch')[DODO_ON_HOLD_FIELD]).toEqual(expect.any(String));
    expect(priv('stripechurch')).toEqual(stripeBefore);
  });

  it('never expires a Stripe church’s donate page, whatever the clock says', async () => {
    seedStripeTenant();
    const effective = resolveEffectiveTenantStatus({
      status: tenant('stripechurch').status,
      onHoldAt: priv('stripechurch')[DODO_ON_HOLD_FIELD],
      now: AFTER_GRACE,
    });
    expect(tenantAllows(effective, 'giving')).toBe(true);
  });
});

describe('a conflict-owned tenant is refused, not archived', () => {
  /** A tenant carrying identifiers from BOTH processors — ownership is contradictory. */
  function seedConflictTenant() {
    seedStripeTenant();
    currentDb.store.set('tenant_private/stripechurch', {
      ...priv('stripechurch'),
      dodoSubscriptionId: SUB_ID,
    });
  }

  it('is refused, not archived, when on_hold arrives', async () => {
    // 🔴 `resolveBillingOwnership` returns `conflict` — processor null — and
    // every write path refuses rather than guessing. A grace timer is a write
    // like any other.
    seedConflictTenant();

    const outcome = await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);

    expect(outcome).toEqual({ outcome: 'not-dodo-owned', tenantId: 'stripechurch' });
    expect(priv('stripechurch')[DODO_ON_HOLD_FIELD]).toBeUndefined();
    expect(tenant('stripechurch').status).toBe('active');
  });

  it('reports the refusal rather than failing silently', async () => {
    seedConflictTenant();
    await recordDodoSubscriptionOnHold(onHoldEvent().data as any, HELD_AT);
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'dodo-on-hold-ownership-refused', level: 'warning' }),
    );
  });

  it('is refused by convergence too, even with a hold already on the doc', async () => {
    // The belt-and-braces case: a hold written before the tenant grew a
    // conflicting identifier must still not archive it.
    seedConflictTenant();
    currentDb.store.set('tenant_private/stripechurch', {
      ...priv('stripechurch'),
      [DODO_ON_HOLD_FIELD]: new Date(HELD_AT).toISOString(),
    });

    const outcome = await convergeExpiredDodoGrace('stripechurch', AFTER_GRACE);

    expect(outcome).toEqual({ outcome: 'not-dodo-owned', tenantId: 'stripechurch' });
    expect(tenant('stripechurch').status).toBe('active');
  });

  it('is refused by the recovery clear too', async () => {
    seedConflictTenant();
    const outcome = await reactivateTenantForDodoSubscription('stripechurch');
    expect(outcome).toEqual({ outcome: 'not-dodo-owned', tenantId: 'stripechurch' });
  });
});

// ─── Test 8 — reactivation restores full entitlement ─────────────────────────

describe('reactivation restores full entitlement', () => {
  it('puts an archived tenant back to active', async () => {
    seedDodoTenant();
    await handleDodoSubscriptionCancelled(cancelledEvent() as any);
    expect(tenant().status).toBe(TENANT_STATUS_ARCHIVED);

    await reactivateTenantForDodoSubscription('gracechurch');

    expect(tenant().status).toBe('active');
    expect(tenantCapabilities(tenant().status)).toEqual({
      login: true, adminRead: true, export: true, giving: true, publishing: true, sending: true,
    });
  });

  it('restores the SAME subdomain, the same data and the same members', async () => {
    seedDodoTenant();
    currentDb.store.set('users/user_1', { tenantId: 'gracechurch', role: 'admin', plan: 'max' });
    const before = { tenant: { ...tenant() }, priv: { ...priv() }, user: { ...currentDb.store.get('users/user_1')! } };

    await handleDodoSubscriptionCancelled(cancelledEvent() as any);
    await reactivateTenantForDodoSubscription('gracechurch');

    // ⚠️ Everything except `status`, `updatedAt` and the private provenance is
    // exactly as it was — because archiving never took any of it away.
    expect({ ...tenant(), status: before.tenant.status, updatedAt: before.tenant.updatedAt })
      .toEqual(before.tenant);
    expect(priv().adminEmails).toEqual(before.priv.adminEmails);
    expect(priv().dodoSubscriptionId).toBe(before.priv.dodoSubscriptionId);
    expect(priv().billingProcessor).toBe('dodo');
    expect(currentDb.store.get('users/user_1')).toEqual(before.user);
  });

  it('clears the archive provenance so a later cancellation reads cleanly', async () => {
    seedDodoTenant();
    await handleDodoSubscriptionCancelled(cancelledEvent() as any);
    await reactivateTenantForDodoSubscription('gracechurch');
    expect(priv().archivedAt).toBeNull();
    expect(priv().dodoSubscriptionStatus).toBe('active');
  });

  it('comes back through subscription.active, the event a real reactivation arrives as', async () => {
    seedDodoTenant();
    currentDb.store.set('users/user_1', { tenantId: 'gracechurch' });
    await handleDodoSubscriptionCancelled(cancelledEvent() as any);

    await handleDodoSubscriptionActive({
      type: 'subscription.active',
      data: {
        payload_type: 'Subscription',
        subscription_id: SUB_ID,
        product_id: 'pdt_0NlAMMp4QndR3qPzlD8sG',
        metadata: { newTenant: 'true', userId: 'user_1', ministryName: 'Grace Church' },
      },
    } as any);

    expect(tenant().status).toBe('active');
  });

  it('writes nothing when subscription.active lands on a tenant that is not archived', async () => {
    seedDodoTenant();
    const before = { ...tenant() };
    const outcome = await reactivateTenantForDodoSubscription('gracechurch');
    expect(outcome).toEqual({ outcome: 'not-archived', tenantId: 'gracechurch' });
    expect(tenant()).toEqual(before);
  });

  it('can be archived and reactivated repeatedly without drift', async () => {
    seedDodoTenant();
    const original = { ...tenant() };
    for (let i = 0; i < 3; i++) {
      await handleDodoSubscriptionCancelled(cancelledEvent() as any);
      await reactivateTenantForDodoSubscription('gracechurch');
    }
    expect({ ...tenant(), updatedAt: original.updatedAt }).toEqual(original);
  });
});

// ─── Test 9 — a Stripe-owned tenant is unaffected ────────────────────────────

describe('a Stripe-owned tenant is unaffected by any of it', () => {
  it('refuses to archive a tenant whose subscription is Stripe-owned', async () => {
    seedStripeTenant();
    // Contrive the only way a Dodo event could reach one: a stray Dodo
    // subscription id on a Stripe tenant. Ownership resolves to `conflict`
    // (identifiers from both processors) and the handler refuses.
    currentDb.store.set('tenant_private/stripechurch', {
      ...priv('stripechurch'),
      dodoSubscriptionId: SUB_ID,
    });

    const outcome = await archiveTenantForDodoSubscription(
      { subscription_id: SUB_ID }, 'cancelled',
    );

    expect(outcome).toEqual({ outcome: 'not-dodo-owned', tenantId: 'stripechurch' });
    expect(tenant('stripechurch').status).toBe('active');
  });

  it('never touches a Stripe tenant that has no Dodo identifier at all', async () => {
    seedStripeTenant();
    const before = { ...tenant('stripechurch') };
    await handleDodoSubscriptionCancelled(cancelledEvent() as any);
    await handleDodoSubscriptionExpired(expiredEvent() as any);
    expect(tenant('stripechurch')).toEqual(before);
  });

  it('archives only the Dodo tenant when both exist side by side', async () => {
    seedDodoTenant();
    seedStripeTenant();
    await handleDodoSubscriptionCancelled(cancelledEvent() as any);
    expect(tenant('gracechurch').status).toBe(TENANT_STATUS_ARCHIVED);
    expect(tenant('stripechurch').status).toBe('active');
  });

  it('leaves the Stripe webhook source untouched by this PR', () => {
    // The Stripe path has its own gap (see the PR body: it RECORDS
    // `status: 'cancelled'` and nothing enforces it). Fixing both would double
    // this PR, so it is reported and not edited.
    const stripeWebhook = readFileSync(join(SRC, 'app/api/stripe/webhook/route.ts'), 'utf8');
    expect(stripeWebhook).not.toContain('tenant-lifecycle');
    expect(stripeWebhook).not.toContain(TENANT_STATUS_ARCHIVED);
  });

  it('leaves firestore.rules untouched — enforcement is client-gated for now', () => {
    // ⚠️ Rules deploy to production on merge, and they cannot express this
    // without a cross-document read per evaluation. Reported, not edited.
    const rules = readFileSync(resolve(SRC, '..', 'firestore.rules'), 'utf8');
    expect(rules).not.toContain(TENANT_STATUS_ARCHIVED);
  });

  it('leaves stripe-connect.ts untouched — the gate went on the donate ROUTE', () => {
    const connect = readFileSync(join(SRC, 'lib/stripe-connect.ts'), 'utf8');
    expect(connect).not.toContain('tenant-lifecycle');
    expect(connect).not.toContain('status');
  });
});

// ─── The single source of entitlement truth ──────────────────────────────────

describe('lifecycle entitlement is read from exactly one field', () => {
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) sourceFiles(full, out);
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
  }

  it('has no hand-rolled archived comparison anywhere outside the module itself', () => {
    // 🔴 Two sources of entitlement truth is how a cancelled tenant keeps
    // working somewhere. Every caller asks `tenantAllows` / `useTenantCapability`
    // instead of comparing the status string on its own.
    const offenders = sourceFiles(join(SRC))
      .filter((f) => !/__tests__|\.test\.tsx?$/.test(f))
            // The module itself, the handler that writes the state, the type that
      // declares it, the super-admin badge colours — and `statusTone`, a
      // generic content-status → badge-colour helper that has matched the word
      // 'archived' since long before this PR and gates nothing.
      .filter((f) => !/lib\/tenant-lifecycle\.ts$|lib\/dodo\/lifecycle\.ts$|types\/tenant\.types\.ts$|components\/AdminTenants\.tsx$|components\/admin\/AdminUI\.tsx$/.test(f))
      .filter((f) => /['"]archived['"]/.test(
        readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, ''),
      ))
      .map((f) => f.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  it('writes the state to tenants/{id}.status and introduces no second field', async () => {
    seedDodoTenant();
    const publicBefore = new Set(Object.keys(tenant()));
    await handleDodoSubscriptionCancelled(cancelledEvent() as any);
    // The public doc gained NO key. Only `status` and `updatedAt` changed.
    expect(new Set(Object.keys(tenant()))).toEqual(publicBefore);
  });
});

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
} = await import('@/lib/tenant-lifecycle');

const SUB_ID = 'sub_dodo_1';

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

  it('leaves subscription.on_hold deliberately unhandled — that is a timer, not a handler', async () => {
    // ⚠️ Dodo runs the retries and dunning but NEVER cancels: at the end of the
    // recovery window a subscription sits in on_hold forever. That needs a timer
    // Harvest owns, which is a different mechanism and the remainder of part 3.
    seedDodoTenant();
    await DODO_EVENT_HANDLERS['subscription.on_hold']({ type: 'subscription.on_hold', data: { subscription_id: SUB_ID } } as any);
    expect(tenant().status).toBe('active');
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

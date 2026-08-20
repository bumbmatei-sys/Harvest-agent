import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SeenEventStore } from '../webhook-dispatch';

/**
 * REP-4 PR 2, tests 1–4: the Dodo webhook builds a tenant that is
 * indistinguishable from the one the Stripe webhook builds.
 *
 * 🔴 These assert FIELD BY FIELD, never "a tenant exists". A field missed here is
 * a tenant that looks provisioned and is subtly broken, and nobody finds out
 * until a customer hits it — so test 1 additionally reads the Stripe handler's
 * OWN SOURCE and pins that the two field sets agree. Adding a field to the
 * Stripe path without adding it here fails this file, which is the only way the
 * parity claim survives contact with a future change.
 */

const SRC = resolve(__dirname, '../../..');

// ── An in-memory Firestore, faithful to the parts provisioning uses ──────────

function makeDb() {
  const store = new Map<string, Record<string, any>>();
  const key = (coll: string, id: string) => `${coll}/${id}`;

  const docRef = (coll: string, id: string) => ({
    __coll: coll,
    __id: id,
    async get() {
      const data = store.get(key(coll, id));
      // `data` is a METHOD on a Firestore snapshot, not a property. Getting this
      // wrong in a fake is how a test passes against an API the real SDK does
      // not have.
      return { id, exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
    },
    async update(patch: Record<string, any>) {
      const existing = store.get(key(coll, id));
      if (!existing) throw new Error(`update on missing doc ${key(coll, id)}`);
      store.set(key(coll, id), { ...existing, ...patch });
    },
    async set(data: Record<string, any>) {
      store.set(key(coll, id), { ...data });
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
      const writes: [{ __coll: string; __id: string }, Record<string, any>][] = [];
      return {
        set(ref: any, data: Record<string, any>) { writes.push([ref, data]); },
        async commit() {
          for (const [ref, data] of writes) store.set(key(ref.__coll, ref.__id), { ...data });
        },
      };
    },
  };
}

// The provisioning chain reaches the Dodo catalogue, which consumes the
// validated dodoConfig — so the three required variables must exist before the
// dynamic imports below run. Hoisted for symmetry with the mock block.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

const { db, mockGetUser, mockSetCustomClaims, mockCapture } = vi.hoisted(() => ({
  db: { current: null as any },
  mockGetUser: vi.fn(),
  mockSetCustomClaims: vi.fn(),
  mockCapture: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  get adminDb() { return db.current; },
  adminAuth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
}));
vi.mock('@/lib/set-custom-claims', () => ({ setCustomClaims: mockSetCustomClaims }));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: mockCapture }));

const {
  provisionTenantFromDodoSubscription,
  handleDodoSubscriptionActive,
  requirePlanForProduct,
  DodoProvisioningError,
} = await import('../provisioning');
const { receiveDodoWebhookEvent } = await import('../webhook-dispatch');
const { requireProductId } = await import('../catalogue');
const { TENANT_PRIVATE_FIELDS } = await import('@/lib/tenant-private');
const { NO_ADDONS } = await import('@/utils/plan-features');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER_UID = 'uid_owner_1';
const OWNER_EMAIL = 'pastor@grace.example';

function subscription(over: Record<string, any> = {}) {
  return {
    subscription_id: 'sub_dodo_1',
    product_id: requireProductId('max', 'monthly'),
    status: 'active',
    created_at: '2026-08-11T12:00:00Z',
    customer: { customer_id: 'cus_dodo_1', email: OWNER_EMAIL, name: 'Grace Community Church' },
    metadata: {
      plan: 'max',
      billing: 'monthly',
      ministryName: 'Grace Community Church',
      userId: OWNER_UID,
      newTenant: 'true',
    },
    ...over,
  };
}

const activeEvent = (sub: Record<string, any> = subscription()) => ({
  business_id: 'bus_test',
  type: 'subscription.active',
  timestamp: '2026-08-11T12:00:00Z',
  data: { payload_type: 'Subscription', ...sub },
});

function memoryStore(): SeenEventStore & { released: string[] } {
  const seen = new Set<string>();
  const released: string[] = [];
  return {
    released,
    async reserve(id) { if (seen.has(id)) return false; seen.add(id); return true; },
    async release(id) { seen.delete(id); released.push(id); },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.current = makeDb();
  // The signup marker ChurchOnboarding writes before checkout. Provisioning
  // updates this doc; it must exist, exactly as it does in production.
  db.current.store.set(`users/${OWNER_UID}`, {
    email: OWNER_EMAIL,
    role: 'user',
    termsAccepted: true,
    signupInProgress: true,
    signupPlan: 'max',
    signupMinistryName: 'Grace Community Church',
  });
  mockGetUser.mockResolvedValue({ uid: OWNER_UID, email: OWNER_EMAIL });
});

const tenantDoc = () => [...db.current.store.entries()].find(([k]: [string, any]) => k.startsWith('tenants/'));
const privateDoc = () => [...db.current.store.entries()].find(([k]: [string, any]) => k.startsWith('tenant_private/'));

// ── Test 1: every field the Stripe path writes ───────────────────────────────

describe('a completed Dodo checkout creates a tenant with every field the Stripe path writes', () => {
  it('writes the public tenant doc, field by field', async () => {
    const result = await provisionTenantFromDodoSubscription(subscription());

    expect(result.outcome).toBe('created');
    const [tenantKey, tenant] = tenantDoc()!;
    const tenantId = tenantKey.slice('tenants/'.length);

    expect(tenant).toEqual({
      name: 'Grace Community Church',
      subdomain: tenantId,
      // From the PRODUCT, not from metadata. See test 4.
      plan: 'max',
      // 🔴 An EMPTY write, not an absent field (REP-5a). Nothing sells an add-on
      // at signup, so every value is zero — but the key exists, so a tenant with
      // no add-ons is distinguishable from a tenant whose add-on write failed.
      // Compared against NO_ADDONS rather than a literal, so the shape has one
      // definition.
      addons: NO_ADDONS,
      status: 'active',
      config: {},
      ownerId: OWNER_UID,
      createdBy: OWNER_UID,
      // Gates the first-run "Finish setup" screen. `false`, not absent —
      // OnboardingGate keys on `setupCompleted !== false`, so a missing field
      // would drop a brand-new owner straight past first-run setup.
      setupCompleted: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('writes tenant_private with the roster and the Dodo identifiers', async () => {
    await provisionTenantFromDodoSubscription(subscription());

    const [, priv] = privateDoc()!;
    expect(priv).toEqual({
      adminEmails: [OWNER_EMAIL],
      dodoCustomerId: 'cus_dodo_1',
      dodoSubscriptionId: 'sub_dodo_1',
      dodoProductId: requireProductId('max', 'monthly'),
      // 🔴 THE-79: who owns this subscription, stated rather than inferred. Every
      // billing write path routes on it; without it a later plan change would
      // open a SECOND subscription on Stripe and bill this church twice.
      billingProcessor: 'dodo',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('records billingProcessor in the SAME batch as the identifiers it describes', async () => {
    // Written together so the two can never disagree — a tenant carrying Dodo ids
    // whose ownership says otherwise is the state that blocks its own billing.
    await provisionTenantFromDodoSubscription(subscription());

    const [, priv] = privateDoc()!;
    expect(priv.billingProcessor).toBe('dodo');
    expect(priv.dodoSubscriptionId).toBe('sub_dodo_1');
  });

  it('does NOT write any stripe* identifier — those belong to the rollback', async () => {
    await provisionTenantFromDodoSubscription(subscription());

    const [, priv] = privateDoc()!;
    for (const field of ['stripeCustomerId', 'stripeSubscriptionId', 'stripePriceId', 'stripeConnectAccountId']) {
      expect(priv).not.toHaveProperty(field);
    }
  });

  it('promotes the paying user to admin and mints their claim', async () => {
    await provisionTenantFromDodoSubscription(subscription());

    const [tenantKey] = tenantDoc()!;
    const tenantId = tenantKey.slice('tenants/'.length);
    const user = db.current.store.get(`users/${OWNER_UID}`);

    expect(user).toMatchObject({
      tenantId,
      role: 'admin',
      plan: 'max',
      onboardingCompleted: true,
      // Releases OnboardingGate from its "Setting up your account…" poll.
      signupInProgress: false,
    });
    expect(mockSetCustomClaims).toHaveBeenCalledWith(OWNER_UID);
  });

  it('leaves termsAccepted alone — the client wrote it before checkout', async () => {
    // ChurchOnboarding.tsx:94 writes it into users/{uid} at signup. Neither
    // webhook has ever touched it, and this path must not start.
    await provisionTenantFromDodoSubscription(subscription());
    expect(db.current.store.get(`users/${OWNER_UID}`).termsAccepted).toBe(true);
  });

  it('derives the subdomain from the ministry name, like the Stripe path', async () => {
    await provisionTenantFromDodoSubscription(
      subscription({ metadata: { ...subscription().metadata, ministryName: 'Grace Community Church' } }),
    );
    const [tenantKey] = tenantDoc()!;
    expect(tenantKey).toBe('tenants/grace-community-church');
  });

  it('falls back to "My Ministry" / "ministry" when no name was given', async () => {
    await provisionTenantFromDodoSubscription(
      subscription({ metadata: { newTenant: 'true', userId: OWNER_UID } }),
    );
    const [tenantKey, tenant] = tenantDoc()!;
    expect(tenantKey).toBe('tenants/ministry');
    expect(tenant.name).toBe('My Ministry');
  });

  // ── The parity guard: read the Stripe handler's own source. ────────────────

  it('writes the SAME public-doc field set the Stripe handler writes', () => {
    const stripeSource = readFileSync(join('app/api/stripe/webhook/route.ts'), 'utf8');
    const stripeFields = objectLiteralKeys(
      stripeSource,
      "newTenantBatch.set(adminDb.collection('tenants').doc(newTenantId), {",
    );
    const dodoSource = readFileSync(join('lib/dodo/provisioning.ts'), 'utf8');
    const dodoFields = objectLiteralKeys(
      dodoSource,
      "batch.set(adminDb.collection('tenants').doc(newTenantId), {",
    );

    // The ONE deliberate difference, named rather than tolerated: `addons`
    // (REP-5a) is what the tenant owns BEYOND its tier, and only Dodo sells
    // those. The Stripe handler is the rollback path and has no add-on concept,
    // so writing the field there would record a set nothing can ever change.
    // Everything else must still agree key for key — that is what this guards.
    const DODO_ONLY = ['addons'];
    const withoutDodoOnly = (fields: string[]) => fields.filter((f) => !DODO_ONLY.includes(f)).sort();

    expect(stripeFields.length).toBeGreaterThan(0);
    // The exception is real, not a way to pass: `addons` IS written by the Dodo
    // path, so removing it from provisioning.ts fails here rather than silently
    // satisfying the filter.
    expect(dodoFields).toContain('addons');
    expect(withoutDodoOnly(dodoFields)).toEqual(withoutDodoOnly(stripeFields));
  });

  it('writes the same tenant_private field set, with dodo* in place of stripe*', () => {
    const stripeSource = readFileSync(join('app/api/stripe/webhook/route.ts'), 'utf8');
    const stripeFields = objectLiteralKeys(stripeSource, 'newTenantBatch.set(tenantPrivateRef(newTenantId), {');
    const dodoSource = readFileSync(join('lib/dodo/provisioning.ts'), 'utf8');
    const dodoFields = objectLiteralKeys(dodoSource, 'batch.set(tenantPrivateRef(newTenantId), {');

    // The ONE deliberate difference: the billing identifiers are this
    // processor's. `stripePriceId` has no counterpart — Dodo puts the price on
    // the product, so `dodoProductId` carries both roles.
    const normalise = (fields: string[]) =>
      fields
        .map((f) => f.replace(/^stripe/, 'dodo').replace(/^dodoPriceId$/, 'dodoProductId'))
        .sort();

    expect(normalise(dodoFields)).toEqual(normalise(stripeFields));
  });

  it('keeps the dodo identifiers on the list that survives a subdomain rename', () => {
    // /api/tenants/finish-setup moves tenant_private to the new id with
    // pickTenantPrivateFields, which copies EXACTLY this list. A dodo id missing
    // from it disappears the first time an owner picks their own subdomain —
    // during first-run setup, i.e. on essentially every new church.
    for (const field of ['dodoCustomerId', 'dodoSubscriptionId', 'dodoProductId']) {
      expect(TENANT_PRIVATE_FIELDS as readonly string[]).toContain(field);
    }
  });
});

function join(rel: string): string {
  return resolve(SRC, rel);
}

/** The top-level keys of the object literal that follows `marker` in `source`. */
function objectLiteralKeys(source: string, marker: string): string[] {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Marker not found, so the parity guard is not guarding: ${marker}`);
  let depth = 0;
  let i = start + marker.length - 1;
  const body: string[] = [];
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) break; }
    body.push(ch);
  }
  // Drop the opening brace so the first line starts at nesting 0.
  const text = body.join('').replace(/^\{/, '');
  const keys: string[] = [];
  let nesting = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (nesting === 0) {
      // `name: value` and the shorthand `plan,` are the same field.
      const match = /^([A-Za-z_$][\w$]*)\s*[,:]/.exec(trimmed);
      if (match && !trimmed.startsWith('//')) keys.push(match[1]);
    }
    nesting += (line.match(/[[{(]/g) || []).length - (line.match(/[\]})]/g) || []).length;
    if (nesting < 0) nesting = 0;
  }
  return keys;
}

// ── Test 2: the THE-64 regression — tenant_private, and a reachable roster ────

describe('tenant_private is written, and a roster-derived admin can reach the admin area', () => {
  it('lands the owner on the adminEmails roster', async () => {
    await provisionTenantFromDodoSubscription(subscription());
    const [, priv] = privateDoc()!;
    expect(priv.adminEmails).toEqual([OWNER_EMAIL]);
  });

  it('answers "yes" to the roster check the admin area actually performs', async () => {
    // THE-64 in one assertion: firestore.rules' inTenantAdminEmails and
    // /api/tenants/roster-status BOTH read tenant_private.adminEmails, and
    // nothing else grants a roster-only admin access. An empty roster is not a
    // cosmetic gap — it locks every admin of that tenant out of their church.
    await provisionTenantFromDodoSubscription(subscription());
    const [privKey, priv] = privateDoc()!;
    const tenantId = privKey.slice('tenant_private/'.length);

    const rosterSaysYes = (email: string) =>
      Array.isArray(priv.adminEmails)
      && priv.adminEmails.some((e: string) => (e || '').toLowerCase() === email.toLowerCase());

    expect(rosterSaysYes(OWNER_EMAIL)).toBe(true);
    expect(rosterSaysYes('someone-else@example.com')).toBe(false);
    // …and the tenant the roster belongs to is the one the owner was attached to.
    expect(db.current.store.get(`users/${OWNER_UID}`).tenantId).toBe(tenantId);
  });

  it('falls back to the Dodo customer email when Firebase Auth cannot be read', async () => {
    mockGetUser.mockRejectedValue(new Error('auth unavailable'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await provisionTenantFromDodoSubscription(subscription());

    expect(privateDoc()![1].adminEmails).toEqual([OWNER_EMAIL]);
    err.mockRestore();
  });

  it('reports at ERROR level when BOTH email sources are gone', async () => {
    mockGetUser.mockRejectedValue(new Error('auth unavailable'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await provisionTenantFromDodoSubscription(
      subscription({ customer: { customer_id: 'cus_dodo_1' } }),
    );

    expect(privateDoc()![1].adminEmails).toEqual([]);
    expect(mockCapture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ step: 'dodo-new-tenant-owner-email-missing', level: 'error' }),
    );
    err.mockRestore();
  });

  it('writes both documents in ONE batch — never a tenant without its roster', async () => {
    // A tenant doc that lands without its private doc is a church whose every
    // admin is locked out. Proven by failing the commit: neither may exist.
    const realBatch = db.current.batch.bind(db.current);
    db.current.batch = () => {
      const b = realBatch();
      return { set: b.set, commit: async () => { throw new Error('firestore unavailable'); } };
    };

    await expect(provisionTenantFromDodoSubscription(subscription())).rejects.toThrow();
    expect(tenantDoc()).toBeUndefined();
    expect(privateDoc()).toBeUndefined();
  });
});

// ── Test 3: a retried webhook-id creates no second tenant ────────────────────

describe('a retried webhook-id creates no second tenant', () => {
  it('provisions once across five redeliveries of the same webhook-id', async () => {
    const store = memoryStore();
    const event = activeEvent();

    for (let i = 0; i < 5; i++) {
      await receiveDodoWebhookEvent('whk_same_delivery', event, { store });
    }

    const tenants = [...db.current.store.keys()].filter((k: string) => k.startsWith('tenants/'));
    expect(tenants).toHaveLength(1);
  });

  it('reports the redelivery as a duplicate and never re-enters the handler', async () => {
    const store = memoryStore();
    const event = activeEvent();

    const first = await receiveDodoWebhookEvent('whk_dupe', event, { store });
    const second = await receiveDodoWebhookEvent('whk_dupe', event, { store });

    expect(first.outcome).toBe('routed');
    expect(second.outcome).toBe('duplicate');
    expect([...db.current.store.keys()].filter((k: string) => k.startsWith('tenants/'))).toHaveLength(1);
  });

  it('creates no second tenant even for a DIFFERENT webhook-id on the same subscription', async () => {
    // Dodo emits subscription.active and subscription.updated for the same
    // state change, each with its own webhook-id, so the reservation cannot
    // help here. The subscription-id guard is what does.
    const store = memoryStore();

    await receiveDodoWebhookEvent('whk_a', activeEvent(), { store });
    const second = await receiveDodoWebhookEvent('whk_b', activeEvent(), { store });

    expect([...db.current.store.keys()].filter((k: string) => k.startsWith('tenants/'))).toHaveLength(1);
    expect(second.outcome).toBe('routed');
  });

  it('creates no second tenant for a second paid checkout by the same user', async () => {
    // A distinct subscription, so neither the webhook-id nor the
    // subscription-id guard applies. The user guard does — the same one the
    // Stripe path carries, and for the same reason: building a second church
    // would detach the owner from the first.
    const store = memoryStore();

    await receiveDodoWebhookEvent('whk_1', activeEvent(), { store });
    await receiveDodoWebhookEvent(
      'whk_2',
      activeEvent(subscription({ subscription_id: 'sub_dodo_2' })),
      { store },
    );

    expect([...db.current.store.keys()].filter((k: string) => k.startsWith('tenants/'))).toHaveLength(1);
  });

  it('runs the two concurrent redeliveries of one id exactly once', async () => {
    // 🔴 THE CASE ONLY THE RESERVATION CAN SAVE. The subscription-id and user
    // guards are read-then-write, so two deliveries racing each other both see
    // "no tenant yet" and both provision. Only the atomic claim serialises them.
    //
    // Counting tenant DOCUMENTS cannot detect that — both runs derive the same
    // subdomain and write the same key, so the duplicate hides behind the
    // collision. Counting how many times an owner was promoted can.
    const store = memoryStore();
    const event = activeEvent();

    await Promise.all([
      receiveDodoWebhookEvent('whk_race', event, { store }),
      receiveDodoWebhookEvent('whk_race', event, { store }),
    ]);

    expect([...db.current.store.keys()].filter((k: string) => k.startsWith('tenants/'))).toHaveLength(1);
    expect(mockSetCustomClaims).toHaveBeenCalledTimes(1);
  });

  it('promotes the owner exactly once across five sequential redeliveries', async () => {
    const store = memoryStore();
    const event = activeEvent();

    for (let i = 0; i < 5; i++) {
      await receiveDodoWebhookEvent('whk_five', event, { store });
    }

    expect(mockSetCustomClaims).toHaveBeenCalledTimes(1);
  });
});

// ── Test 4: an unknown product fails loudly ──────────────────────────────────

describe('an unknown product id fails loudly and provisions nothing', () => {
  it('throws rather than defaulting to plus', async () => {
    await expect(
      provisionTenantFromDodoSubscription(subscription({ product_id: 'pdt_not_in_this_catalogue' })),
    ).rejects.toThrow(DodoProvisioningError);
  });

  it('writes NO tenant at all — not a plus one, not any', async () => {
    await expect(
      provisionTenantFromDodoSubscription(subscription({ product_id: 'pdt_not_in_this_catalogue' })),
    ).rejects.toThrow();

    expect(tenantDoc()).toBeUndefined();
    expect(privateDoc()).toBeUndefined();
    // …and the user is untouched: still mid-signup, not an admin of nothing.
    expect(db.current.store.get(`users/${OWNER_UID}`).tenantId).toBeUndefined();
    expect(db.current.store.get(`users/${OWNER_UID}`).role).toBe('user');
  });

  it('names the product in the error, so the fix is obvious', async () => {
    await expect(
      provisionTenantFromDodoSubscription(subscription({ product_id: 'pdt_mystery' })),
    ).rejects.toThrow(/pdt_mystery/);
  });

  it('rejects an empty or missing product id too', async () => {
    await expect(provisionTenantFromDodoSubscription(subscription({ product_id: '' }))).rejects.toThrow();
    await expect(provisionTenantFromDodoSubscription(subscription({ product_id: undefined }))).rejects.toThrow();
  });

  it('surfaces the failure as a RETRYABLE dispatch outcome, not a swallowed log', async () => {
    // An unknown product is a build/catalogue mismatch a human must fix. The
    // event has to keep coming back until they do — silently 200-ing it would
    // leave a paying customer with no account and no trace.
    const store = memoryStore();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await receiveDodoWebhookEvent(
      'whk_unknown_product',
      activeEvent(subscription({ product_id: 'pdt_nope' })),
      { store },
    );

    expect(result.outcome).toBe('failed');
    expect(store.released).toEqual(['whk_unknown_product']);
    err.mockRestore();
  });

  it('resolves every product in the catalogue and nothing else', () => {
    expect(requirePlanForProduct(requireProductId('plus', 'monthly'))).toEqual({ plan: 'plus', period: 'monthly' });
    expect(requirePlanForProduct(requireProductId('plus', 'yearly'))).toEqual({ plan: 'plus', period: 'yearly' });
    expect(requirePlanForProduct(requireProductId('pro', 'monthly'))).toEqual({ plan: 'pro', period: 'monthly' });
    expect(requirePlanForProduct(requireProductId('pro', 'yearly'))).toEqual({ plan: 'pro', period: 'yearly' });
    expect(requirePlanForProduct(requireProductId('max', 'monthly'))).toEqual({ plan: 'max', period: 'monthly' });
    expect(requirePlanForProduct(requireProductId('max', 'yearly'))).toEqual({ plan: 'max', period: 'yearly' });
  });

  it('takes the plan from the PRODUCT even when metadata claims another one', async () => {
    // Metadata is client-supplied at checkout; the product is what Dodo will
    // actually charge. If they ever disagree, the charge wins.
    await provisionTenantFromDodoSubscription(
      subscription({
        product_id: requireProductId('max', 'yearly'),
        metadata: { ...subscription().metadata, plan: 'plus', billing: 'monthly' },
      }),
    );

    expect(tenantDoc()![1].plan).toBe('max');
    expect(db.current.store.get(`users/${OWNER_UID}`).plan).toBe('max');
  });
});

// ── Not-a-signup: provisioning must not invent tenants ───────────────────────

describe('a subscription that is not a new-ministry signup provisions nothing', () => {
  it('ignores a subscription with no newTenant marker', async () => {
    const result = await provisionTenantFromDodoSubscription(
      subscription({ metadata: { plan: 'max', userId: OWNER_UID } }),
    );
    expect(result.outcome).toBe('not-a-signup');
    expect(tenantDoc()).toBeUndefined();
  });

  it('ignores a signup with no userId — there is nobody to make the owner', async () => {
    const result = await provisionTenantFromDodoSubscription(
      subscription({ metadata: { newTenant: 'true', ministryName: 'X' } }),
    );
    expect(result.outcome).toBe('not-a-signup');
    expect(tenantDoc()).toBeUndefined();
  });

  it('ignores metadata entirely absent', async () => {
    const result = await provisionTenantFromDodoSubscription(subscription({ metadata: undefined }));
    expect(result.outcome).toBe('not-a-signup');
  });

  it('fails loudly on a signup with no subscription_id', async () => {
    await expect(
      provisionTenantFromDodoSubscription(subscription({ subscription_id: '' })),
    ).rejects.toThrow(DodoProvisioningError);
  });
});

describe('the handler reads the subscription out of the webhook envelope', () => {
  it('provisions from event.data', async () => {
    const result = await handleDodoSubscriptionActive(activeEvent());
    expect(result.outcome).toBe('created');
    expect(tenantDoc()).toBeDefined();
  });
});

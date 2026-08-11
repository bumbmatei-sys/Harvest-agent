import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { Webhook } from 'standardwebhooks';

/**
 * REP-4 PR 2, test 8 — a signature failure provisions NOTHING.
 *
 * 🔴 End to end, through the real route, the real dispatcher and the real
 * provisioner: only the Firestore layer is faked. The existing route test proves
 * a bad signature is not dispatched; this proves the consequence that actually
 * matters — that no tenant, no roster and no admin promotion can be produced by
 * anyone who cannot sign as Dodo.
 *
 * That is the whole security boundary of the money path. `/api/dodo/webhook` is
 * a public, unauthenticated endpoint whose one handler CREATES A CHURCH; if the
 * signature check could be bypassed, anyone on the internet could mint tenants
 * on any plan without paying.
 */

const OUR_SECRET = 'whsec_' + Buffer.from('harvest-dodo-provisioning-secret').toString('base64');

process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
process.env.DODO_PAYMENTS_WEBHOOK_KEY = OUR_SECRET;
process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';

const { db, mockSetCustomClaims } = vi.hoisted(() => ({
  db: { current: null as any },
  mockSetCustomClaims: vi.fn(),
}));

function makeDb() {
  const store = new Map<string, Record<string, any>>();
  const key = (coll: string, id: string) => `${coll}/${id}`;
  const docRef = (coll: string, id: string) => ({
    __coll: coll,
    __id: id,
    async get() {
      const data = store.get(key(coll, id));
      return { id, exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
    },
    async update(patch: Record<string, any>) {
      store.set(key(coll, id), { ...(store.get(key(coll, id)) || {}), ...patch });
    },
    async set(data: Record<string, any>) { store.set(key(coll, id), { ...data }); },
    async delete() { store.delete(key(coll, id)); },
    async create(data: Record<string, any>) {
      if (store.has(key(coll, id))) { const e: any = new Error('ALREADY_EXISTS'); e.code = 6; throw e; }
      store.set(key(coll, id), { ...data });
    },
  });
  const collection = (coll: string) => {
    const filters: [string, any][] = [];
    const api: any = {
      doc: (id: string) => docRef(coll, id),
      where(field: string, _op: string, value: any) { filters.push([field, value]); return api; },
      limit() { return api; },
      async get() {
        const docs = [...store.entries()]
          .filter(([k]) => k.startsWith(`${coll}/`))
          .filter(([, data]) => filters.every(([f, v]) => data[f] === v))
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
        async commit() { for (const [ref, data] of writes) store.set(key(ref.__coll, ref.__id), { ...data }); },
      };
    },
  };
}

vi.mock('@/lib/firebase-admin', () => ({
  get adminDb() { return db.current; },
  adminAuth: { getUser: vi.fn().mockResolvedValue({ uid: 'uid_owner_1', email: 'pastor@grace.example' }) },
}));
vi.mock('@/lib/set-custom-claims', () => ({ setCustomClaims: mockSetCustomClaims }));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: vi.fn() }));

let POST: (req: NextRequest) => Promise<Response>;
let productIdFor: (plan: string, period: string) => string;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/dodo/webhook/route'));
  ({ productIdFor } = (await import('@/lib/dodo/catalogue')) as never);
});

function body() {
  return JSON.stringify({
    business_id: 'bus_test',
    type: 'subscription.active',
    timestamp: '2026-08-11T12:00:00Z',
    data: {
      payload_type: 'Subscription',
      subscription_id: 'sub_dodo_1',
      product_id: productIdFor('max', 'monthly'),
      status: 'active',
      created_at: '2026-08-11T12:00:00Z',
      customer: { customer_id: 'cus_1', email: 'pastor@grace.example', name: 'Grace' },
      metadata: {
        plan: 'max',
        billing: 'monthly',
        ministryName: 'Grace Community Church',
        userId: 'uid_owner_1',
        newTenant: 'true',
      },
    },
  });
}

function signedWith(secret: string, id: string, payload = body()) {
  const at = new Date();
  return new NextRequest('https://theharvest.app/api/dodo/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-signature': new Webhook(secret).sign(id, at, payload),
      'webhook-timestamp': String(Math.floor(at.getTime() / 1000)),
    },
    body: payload,
  });
}

const tenants = () => [...db.current.store.keys()].filter((k: string) => k.startsWith('tenants/'));
const privates = () => [...db.current.store.keys()].filter((k: string) => k.startsWith('tenant_private/'));

beforeEach(() => {
  vi.clearAllMocks();
  db.current = makeDb();
  db.current.store.set('users/uid_owner_1', { email: 'pastor@grace.example', role: 'user', signupInProgress: true });
});

describe('a signature failure provisions nothing', () => {
  it('creates no tenant for an unsigned request', async () => {
    const res = await POST(
      new NextRequest('https://theharvest.app/api/dodo/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body(),
      }),
    );

    expect(res.status).toBe(401);
    expect(tenants()).toEqual([]);
    expect(privates()).toEqual([]);
    expect(db.current.store.get('users/uid_owner_1').tenantId).toBeUndefined();
    expect(mockSetCustomClaims).not.toHaveBeenCalled();
  });

  it('creates no tenant for a request signed with the wrong secret', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const forged = 'whsec_' + Buffer.from('attacker-secret').toString('base64');

    const res = await POST(signedWith(forged, 'whk_forged'));

    expect(res.status).toBe(401);
    expect(tenants()).toEqual([]);
    err.mockRestore();
  });

  it('creates no tenant when the body was altered after signing', async () => {
    // The signature covers the exact bytes. A payload upgraded from Individual
    // to Ministry in flight must not be honoured.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const at = new Date();
    const signed = body();
    const tampered = signed.replace(productIdFor('max', 'monthly'), productIdFor('plus', 'monthly'));
    expect(tampered).not.toBe(signed);

    const res = await POST(
      new NextRequest('https://theharvest.app/api/dodo/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'webhook-id': 'whk_tampered',
          'webhook-signature': new Webhook(OUR_SECRET).sign('whk_tampered', at, signed),
          'webhook-timestamp': String(Math.floor(at.getTime() / 1000)),
        },
        body: tampered,
      }),
    );

    expect(res.status).toBe(401);
    expect(tenants()).toEqual([]);
    err.mockRestore();
  });

  it('DOES provision the same payload when it is correctly signed', async () => {
    // The control. Without it, all three assertions above would also pass
    // against a route that never provisions anything at all.
    const res = await POST(signedWith(OUR_SECRET, 'whk_genuine'));

    expect(res.status).toBe(200);
    expect(tenants()).toHaveLength(1);
    expect(privates()).toHaveLength(1);
    expect(db.current.store.get('users/uid_owner_1')).toMatchObject({ role: 'admin', plan: 'max' });
  });

  it('reserves the webhook-id in Firestore, so a redelivery is skipped end to end', async () => {
    await POST(signedWith(OUR_SECRET, 'whk_once'));
    await POST(signedWith(OUR_SECRET, 'whk_once'));

    expect(tenants()).toHaveLength(1);
    expect([...db.current.store.keys()].filter((k: string) => k.startsWith('dodo_webhook_events/')))
      .toEqual(['dodo_webhook_events/whk_once']);
  });
});

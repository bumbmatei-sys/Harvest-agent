import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE-212 — what the free tenant's upgrade does to its people, and who is
 * allowed to write the tier.
 *
 * ─── The founder's explicit decision ─────────────────────────────────────────
 *
 * 🔴 UPGRADING MUST NEVER REMOVE A MEMBER. A Forever Free tenant may hold 500
 * members; Individual's cap is 150. All 500 stay. The cap binds at ACCOUNT
 * CREATION — THE-201's gate refuses the 501st signup — and never retroactively.
 * That is the single most likely thing to get wrong on this path, because
 * "enforce the new tier's cap" reads like correctness and is a data loss.
 *
 * 🔴 THE WEBHOOK IS THE ONLY WRITER OF `plan`. The route that starts the
 * upgrade creates a Dodo Checkout and returns a URL; nothing about the tenant
 * changes until Dodo confirms the subscription and `subscription.active`
 * arrives. The UI re-reads after that, and never applies what it asked for.
 *
 * ⚠️ These assert the ABSENCE of writes, which is a claim a mock can only make
 * if it would have recorded them. So the Firestore double below records every
 * collection touched, every document written, and every delete — and the tests
 * check those recordings are empty rather than checking that one write looks
 * right.
 */

vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'live_mode';
});

const {
  touchedCollections, docWrites, docDeletes, docReads,
  mockTenantGet, mockPrivateGet, mockBatchUpdate, mockBatchSet, mockBatchCommit, mockCapture,
} = vi.hoisted(() => ({
  touchedCollections: [] as string[],
  docWrites: [] as { collection: string; id: string; op: string; data: unknown }[],
  docDeletes: [] as { collection: string; id: string }[],
  docReads: [] as { collection: string; id: string }[],
  mockTenantGet: vi.fn(),
  mockPrivateGet: vi.fn(),
  mockBatchUpdate: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchCommit: vi.fn().mockResolvedValue(undefined),
  mockCapture: vi.fn(),
}));

/**
 * A Firestore double that RECORDS rather than merely satisfies. Every read,
 * write and delete on any collection lands in one of the arrays above, so
 * "nothing else was touched" is a checkable statement.
 */
vi.mock('@/lib/firebase-admin', () => {
  const makeDoc = (collection: string, id: string) => ({
    id,
    collection,
    get: async () => {
      docReads.push({ collection, id });
      return collection === 'tenants' ? mockTenantGet() : { exists: false, data: () => ({}) };
    },
    set: async (data: unknown) => { docWrites.push({ collection, id, op: 'set', data }); },
    update: async (data: unknown) => { docWrites.push({ collection, id, op: 'update', data }); },
    delete: async () => { docDeletes.push({ collection, id }); },
  });
  /**
   * 🔴 THE ROSTER IS POPULATED, and that is what makes "nobody was removed"
   * checkable. A query double that returned an empty page would let code that
   * enumerates the members and deletes them past the cap pass this suite —
   * there would simply be nobody to delete. So a collection read hands back
   * 500 real member documents, each with a `ref` whose `delete` records.
   */
  const roster = (collection: string) => {
    const docs = Array.from({ length: 500 }, (_, i) => {
      const id = `member_${i}`;
      return { id, ref: makeDoc(collection, id), exists: true, data: () => ({ tenantId: 't1' }) };
    });
    return { docs, size: docs.length, empty: false, forEach: (fn: (d: unknown) => void) => docs.forEach(fn) };
  };
  return {
    adminDb: {
      collection: (name: string) => {
        touchedCollections.push(name);
        return {
          doc: (id: string) => makeDoc(name, id),
          get: async () => {
            docReads.push({ collection: name, id: '*' });
            return roster(name);
          },
          where: () => ({
            get: async () => { docReads.push({ collection: name, id: '*' }); return roster(name); },
            limit: () => ({ get: async () => { docReads.push({ collection: name, id: '*' }); return roster(name); } }),
          }),
        };
      },
      batch: () => ({
        update: (ref: { collection?: string; id?: string }, data: unknown) => {
          mockBatchUpdate(ref, data);
          docWrites.push({ collection: ref?.collection ?? 'unknown', id: ref?.id ?? 'unknown', op: 'batch.update', data });
        },
        set: (ref: { collection?: string; id?: string }, data: unknown) => {
          mockBatchSet(ref, data);
          docWrites.push({ collection: ref?.collection ?? 'tenant_private', id: ref?.id ?? 'unknown', op: 'batch.set', data });
        },
        delete: (ref: { collection?: string; id?: string }) => {
          docDeletes.push({ collection: ref?.collection ?? 'unknown', id: ref?.id ?? 'unknown' });
        },
        commit: mockBatchCommit,
      }),
    },
  };
});

vi.mock('@/lib/tenant-private', () => ({
  tenantPrivateRef: (id: string) => ({ collection: 'tenant_private', id, get: mockPrivateGet }),
}));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: mockCapture, captureHandledError: vi.fn() }));

const { attachFirstSubscriptionToTenant } = await import('@/lib/dodo/first-subscription');
const { DODO_ACTIVE_CATALOGUE } = await import('@/lib/dodo/catalogue');
const { PRICED_PLAN_ORDER, BILLING_TERMS } = await import('@/utils/plan-features');

/** The live product for a (plan, term) pair, read from the catalogue. */
const productFor = (plan: 'plus' | 'pro' | 'max', term: 'monthly' | 'quarterly' | 'yearly') =>
  DODO_ACTIVE_CATALOGUE[plan][term].productId as string;

const payload = (productId: string) => ({
  subscription_id: 'sub_first',
  product_id: productId,
  customer: { customer_id: 'cus_1' },
  metadata: { firstSubscription: 'true', tenantId: 't1', userId: 'buyer' },
});

beforeEach(() => {
  vi.clearAllMocks();
  touchedCollections.length = 0;
  docWrites.length = 0;
  docDeletes.length = 0;
  docReads.length = 0;
  mockBatchCommit.mockResolvedValue(undefined);
  // A free tenant holding 500 members — over Individual's 150 cap on purpose.
  mockTenantGet.mockReturnValue({ exists: true, data: () => ({ plan: 'free', name: 'Grace', memberCount: 500 }) });
  mockPrivateGet.mockResolvedValue({ exists: true, data: () => ({ adminEmails: ['pastor@grace.example'] }) });
});

// ── 7 ────────────────────────────────────────────────────────────────────────
describe('upgrading never removes or disables a member', () => {
  it('deletes nothing, on any tier and any term', async () => {
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        docDeletes.length = 0;
        await attachFirstSubscriptionToTenant(payload(productFor(plan, term)) as never);
        expect(docDeletes, `${plan}/${term} must delete nothing`).toEqual([]);
      }
    }
  });

  it('writes to exactly one user document — the buyer’s — and to no other', async () => {
    await attachFirstSubscriptionToTenant(payload(productFor('plus', 'monthly')) as never);

    const userWrites = docWrites.filter((w) => w.collection === 'users');
    expect(userWrites).toHaveLength(1);
    expect(userWrites[0].id).toBe('buyer');
    // Their MIRRORED plan only. Not their tenantId, not their role — they
    // already have both, and this is a purchase, not a provisioning.
    expect(Object.keys(userWrites[0].data as object).sort()).toEqual(['plan', 'updatedAt']);
  });

  it('never enumerates the members, so it cannot act on them', async () => {
    await attachFirstSubscriptionToTenant(payload(productFor('plus', 'monthly')) as never);

    // A collection-wide read is the shape that precedes an eviction. The one
    // user document this path touches is addressed by id, never found by query.
    expect(docReads.filter((r) => r.collection === 'users' && r.id === '*')).toEqual([]);
  });

  it('moves a 500-member free tenant to Individual (cap 150) and keeps all 500', async () => {
    const result = await attachFirstSubscriptionToTenant(payload(productFor('plus', 'monthly')) as never);

    expect(result).toMatchObject({ outcome: 'attached', plan: 'plus', period: 'monthly' });
    // The tenant write carries the tier and the add-on set. It carries no
    // member count, no roster, and no cap enforcement of any kind — the tenant
    // keeps the 500 it had.
    const tenantWrite = docWrites.find((w) => w.op === 'batch.update');
    expect(Object.keys(tenantWrite?.data as object).sort()).toEqual(['addons', 'plan', 'updatedAt']);
    expect(docDeletes).toEqual([]);
  });

  it('writes nothing at all when the attach is refused', async () => {
    // A tenant that already has a subscription. The refusal must be inert: the
    // dangerous version of this bug is a half-applied upgrade.
    mockPrivateGet.mockResolvedValue({ exists: true, data: () => ({ dodoSubscriptionId: 'sub_existing' }) });

    const result = await attachFirstSubscriptionToTenant(payload(productFor('max', 'yearly')) as never);

    expect(result).toMatchObject({ outcome: 'refused' });
    expect(docWrites).toEqual([]);
    expect(docDeletes).toEqual([]);
  });
});

// ── 8 ────────────────────────────────────────────────────────────────────────
describe('the webhook is still the only writer of plan', () => {
  it('the attach — which runs from subscription.active — is what writes the tier', async () => {
    await attachFirstSubscriptionToTenant(payload(productFor('pro', 'quarterly')) as never);

    const planWrites = docWrites.filter((w) => (w.data as Record<string, unknown>)?.plan !== undefined);
    // Exactly two: the tenant's tier and the buying user's mirror of it.
    expect(planWrites.map((w) => w.collection).sort()).toEqual(['tenants', 'users']);
    expect((planWrites.find((w) => w.collection === 'tenants')?.data as Record<string, unknown>).plan).toBe('pro');
  });

  it('takes the tier from the PRODUCT Dodo confirmed, not from anything requested', async () => {
    // 🔴 The payload names a product, and the product names the tier. Nothing
    // the browser asked for is trusted here: a request for Ministry that Dodo
    // fulfilled as Individual lands as Individual.
    await attachFirstSubscriptionToTenant(
      { ...payload(productFor('plus', 'yearly')), metadata: { firstSubscription: 'true', tenantId: 't1', userId: 'buyer', plan: 'max', billing: 'monthly' } } as never,
    );

    const tenantWrite = docWrites.find((w) => w.op === 'batch.update');
    expect((tenantWrite?.data as Record<string, unknown>).plan).toBe('plus');
  });

  it('is idempotent, so a redelivered event is not a second write', async () => {
    mockPrivateGet.mockResolvedValue({ exists: true, data: () => ({ dodoSubscriptionId: 'sub_first' }) });

    const result = await attachFirstSubscriptionToTenant(payload(productFor('plus', 'monthly')) as never);

    expect(result).toEqual({ outcome: 'already-attached', tenantId: 't1' });
    expect(docWrites).toEqual([]);
  });

  it('refuses to attach to a tenant that is no longer free, rather than rewriting its tier', async () => {
    mockTenantGet.mockReturnValue({ exists: true, data: () => ({ plan: 'pro', name: 'Grace' }) });

    const result = await attachFirstSubscriptionToTenant(payload(productFor('plus', 'monthly')) as never);

    expect(result).toMatchObject({ outcome: 'refused' });
    expect(docWrites).toEqual([]);
  });
});

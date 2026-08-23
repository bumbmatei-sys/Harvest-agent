import { describe, it, expect, vi, beforeEach } from 'vitest';

// `requirePlanForProduct` comes from the real provisioning module, which reaches
// ./catalogue -> ./config, and that config refuses to load without all three
// variables BY DESIGN — no fallback values, so a test can never silently bill
// the wrong catalogue. Hoisted above the imports, the same block every other
// Dodo suite carries.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

/**
 * A free tenant buys its FIRST subscription. (THE-203)
 *
 * 🔴 THE CLAIM THAT MATTERS MOST, AND THE ONE MOST LIKELY TO BE GOT WRONG:
 *
 *     UPGRADING NEVER REMOVES A MEMBER.
 *
 * A Forever Free tenant may hold 500 members. Individual's cap is 150. The
 * founder's explicit decision is that all 500 stay and only the 501st signup is
 * refused — the cap binds at ACCOUNT CREATION (THE-201's gate), never
 * retroactively. So the assertions below are not only "the plan changed": they
 * are that this path issues no delete, no disable, and no write to any user
 * document other than the single buyer's mirrored `plan`.
 *
 * The second claim: the double-charge guard is not weakened. `/api/dodo/checkout`
 * refuses a body carrying a tenantId; this path's guard is the exact inverse
 * (must have a tenant, that tenant must have NO subscription), so the two can
 * never both accept the same request, and a tenant that already has a
 * subscription — on EITHER processor — is refused here.
 */

const {
  mockTenantGet, mockPrivateGet, mockUserUpdate,
  mockBatchUpdate, mockBatchSet, mockBatchCommit,
  mockCapture, mockRequirePlan, mockCollection,
} = vi.hoisted(() => ({
  mockTenantGet: vi.fn(),
  mockPrivateGet: vi.fn(),
  mockUserUpdate: vi.fn().mockResolvedValue(undefined),
  mockBatchUpdate: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchCommit: vi.fn().mockResolvedValue(undefined),
  mockCapture: vi.fn(),
  mockRequirePlan: vi.fn(),
  mockCollection: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => {
      mockCollection(name);
      return {
        doc: (id: string) => ({
          id,
          get: name === 'tenants' ? mockTenantGet : vi.fn(),
          update: name === 'users' ? mockUserUpdate : vi.fn(),
        }),
      };
    },
    batch: () => ({ update: mockBatchUpdate, set: mockBatchSet, commit: mockBatchCommit }),
  },
}));
vi.mock('@/lib/tenant-private', () => ({
  tenantPrivateRef: (id: string) => ({ id: `tenant_private/${id}`, get: mockPrivateGet }),
}));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: mockCapture }));
vi.mock('@/lib/dodo/addons', () => ({
  readDodoAddonEntitlements: () => null,
  reportUnrecognisedDodoAddons: vi.fn(),
}));
vi.mock('@/lib/dodo/provisioning', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dodo/provisioning')>('@/lib/dodo/provisioning');
  return { ...actual, requirePlanForProduct: mockRequirePlan };
});

const { attachFirstSubscriptionToTenant, handleFirstSubscriptionAttach, readFirstSubscriptionMetadata } =
  await import('@/lib/dodo/first-subscription');

const FIRST_SUB_META = { firstSubscription: 'true', tenantId: 't1', userId: 'u1' };

const payload = (over: Record<string, unknown> = {}) => ({
  subscription_id: 'sub_new',
  product_id: 'prod_plus_monthly',
  customer: { customer_id: 'cus_1' },
  metadata: FIRST_SUB_META,
  ...over,
});

function tenantOn(plan: string) {
  mockTenantGet.mockResolvedValue({ exists: true, data: () => ({ plan, name: 'Grace Church' }) });
}
function privateDoc(data: Record<string, unknown> | null) {
  mockPrivateGet.mockResolvedValue({ exists: data !== null, data: () => data ?? {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePlan.mockReturnValue({ plan: 'plus', period: 'monthly' });
  mockBatchCommit.mockResolvedValue(undefined);
  mockUserUpdate.mockResolvedValue(undefined);
  tenantOn('free');
  privateDoc({ adminEmails: ['jim@example.com'] });
});

describe('the discriminator keeps the two signup shapes apart', () => {
  it('reads a first-subscription payload', () => {
    expect(readFirstSubscriptionMetadata(FIRST_SUB_META)).toEqual({ tenantId: 't1', userId: 'u1' });
  });

  it('is NOT a new-tenant signup, so the provisioner cannot build a second church', () => {
    expect(readFirstSubscriptionMetadata({ newTenant: 'true', userId: 'u1', ministryName: 'X' })).toBeNull();
  });

  it('🔴 refuses a payload carrying BOTH markers rather than guessing', () => {
    expect(readFirstSubscriptionMetadata({ ...FIRST_SUB_META, newTenant: 'true' })).toBeNull();
  });

  it('refuses a payload missing the tenant or the user', () => {
    expect(readFirstSubscriptionMetadata({ firstSubscription: 'true', userId: 'u1' })).toBeNull();
    expect(readFirstSubscriptionMetadata({ firstSubscription: 'true', tenantId: 't1' })).toBeNull();
  });
});

describe('attaching a first subscription to a free tenant', () => {
  it('writes the bought plan onto the tenant', async () => {
    const r = await attachFirstSubscriptionToTenant(payload() as any);
    expect(r).toMatchObject({ outcome: 'attached', tenantId: 't1', plan: 'plus' });
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ plan: 'plus' }),
    );
  });

  it('records the identifiers and the owning processor in the same batch', async () => {
    await attachFirstSubscriptionToTenant(payload() as any);
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dodoSubscriptionId: 'sub_new',
        dodoCustomerId: 'cus_1',
        dodoProductId: 'prod_plus_monthly',
        billingProcessor: 'dodo',
      }),
      expect.objectContaining({ merge: true }),
    );
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('merges the private doc, so the free tenant’s admin roster survives the upgrade', async () => {
    await attachFirstSubscriptionToTenant(payload() as any);
    const opts = mockBatchSet.mock.calls[0][2];
    expect(opts, 'a non-merge set would erase adminEmails and lock every admin out').toMatchObject({ merge: true });
  });

  it('mirrors the plan onto the buying user, without rewriting their tenant or role', async () => {
    await attachFirstSubscriptionToTenant(payload() as any);
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    const written = mockUserUpdate.mock.calls[0][0];
    expect(written).toMatchObject({ plan: 'plus' });
    expect(written).not.toHaveProperty('tenantId');
    expect(written).not.toHaveProperty('role');
  });
});

describe('🔴 upgrading never removes a member', () => {
  it('touches exactly ONE user document — the buyer’s — and no other', async () => {
    await attachFirstSubscriptionToTenant(payload() as any);
    // The whole claim in one assertion: a path that evicted members would have
    // to write to, or delete, other user docs. It writes one, and only one.
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
  });

  it('never queries the members collection at all, so it cannot count or cull', async () => {
    await attachFirstSubscriptionToTenant(payload() as any);
    const collections = mockCollection.mock.calls.map((c) => c[0]);
    // `users` is touched once, for the buyer. Nothing enumerates it: there is
    // no .where(), no .limit(), no listing — a cap is enforced at signup by
    // THE-201's gate and never retroactively.
    expect(collections.filter((c) => c === 'users')).toHaveLength(1);
  });

  it('a 500-member free tenant moving to a 150-cap tier keeps its plan write and nothing else', async () => {
    // The founder's explicit case. Nothing about the member count is read, so
    // the outcome cannot depend on it — which is exactly the property wanted.
    tenantOn('free');
    const r = await attachFirstSubscriptionToTenant(payload() as any);
    expect(r).toMatchObject({ outcome: 'attached', plan: 'plus' });
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 the double-charge guard is not weakened', () => {
  it('refuses a tenant that already has a Dodo subscription', async () => {
    privateDoc({ dodoSubscriptionId: 'sub_existing' });
    const r = await attachFirstSubscriptionToTenant(payload() as any);
    expect(r).toMatchObject({ outcome: 'refused', reason: 'tenant-already-has-a-subscription' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('refuses a tenant that already has a STRIPE subscription', async () => {
    // A Stripe-owned church is equally not a free tenant. Attaching a Dodo
    // subscription beside its Stripe one is the same defect wearing a
    // different processor's name.
    privateDoc({ stripeSubscriptionId: 'sub_stripe' });
    const r = await attachFirstSubscriptionToTenant(payload() as any);
    expect(r).toMatchObject({ outcome: 'refused', reason: 'tenant-already-has-a-subscription' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it.each(['plus', 'pro', 'max'])('refuses a tenant already on %s, even with no subscription id', async (plan) => {
    tenantOn(plan);
    privateDoc({});
    const r = await attachFirstSubscriptionToTenant(payload() as any);
    expect(r).toMatchObject({ outcome: 'refused' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('refuses a tenant that does not exist', async () => {
    mockTenantGet.mockResolvedValue({ exists: false, data: () => null });
    const r = await attachFirstSubscriptionToTenant(payload() as any);
    expect(r).toMatchObject({ outcome: 'refused', reason: 'tenant-not-found' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('refuses a payload with no subscription id, before resolving a product', async () => {
    const r = await attachFirstSubscriptionToTenant(payload({ subscription_id: '' }) as any);
    expect(r).toMatchObject({ outcome: 'refused', reason: 'missing-subscription-id' });
    expect(mockRequirePlan).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('throws on an unknown product BEFORE writing anything', async () => {
    mockRequirePlan.mockImplementation(() => { throw new Error('unknown product'); });
    await expect(attachFirstSubscriptionToTenant(payload() as any)).rejects.toThrow('unknown product');
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

describe('redelivery', () => {
  it('is a no-op when this exact subscription already landed', async () => {
    privateDoc({ dodoSubscriptionId: 'sub_new' });
    const r = await attachFirstSubscriptionToTenant(payload() as any);
    expect(r).toEqual({ outcome: 'already-attached', tenantId: 't1' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('leaves an ordinary paid signup alone entirely', async () => {
    const r = await attachFirstSubscriptionToTenant(
      payload({ metadata: { newTenant: 'true', userId: 'u1', ministryName: 'X' } }) as any,
    );
    expect(r).toEqual({ outcome: 'not-a-first-subscription' });
    expect(mockTenantGet).not.toHaveBeenCalled();
  });
});

describe('a refusal is never silent', () => {
  it('reports to Sentry when a church paid and did not get the tier', async () => {
    privateDoc({ dodoSubscriptionId: 'sub_existing' });
    await handleFirstSubscriptionAttach(payload() as any);
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'dodo-first-subscription-refused', level: 'error', tenantId: 't1' }),
    );
  });

  it('does not report on the ordinary success path', async () => {
    await handleFirstSubscriptionAttach(payload() as any);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('does not report for a payload that was never a first subscription', async () => {
    await handleFirstSubscriptionAttach(
      payload({ metadata: { newTenant: 'true', userId: 'u1' } }) as any,
    );
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

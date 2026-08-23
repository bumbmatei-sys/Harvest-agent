import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Forever Free provisioning. (THE-203)
 *
 * The claims under test, in order of what matters:
 *
 *  1. 🔴 NOTHING DODO-SHAPED IS WRITTEN. A free tenant has no customer, no
 *     subscription, no product and no `billingProcessor`. Asserting the ABSENCE
 *     of those keys is the point — writing `null` for them would make a free
 *     tenant indistinguishable from a paid one whose identifiers failed to
 *     write, and `billingProcessor` in particular is what every billing write
 *     path routes on.
 *  2. 🔴 `signupInProgress` IS CLEARED IN THIS REQUEST. No webhook is coming.
 *     A free tenant left flagged mid-signup is shown "Complete your payment"
 *     for a plan that cannot be paid for, forever.
 *  3. The tenant and its private doc land in ONE batch. A tenant without its
 *     private doc is a church whose every admin is locked out.
 *  4. Idempotent: a second call never builds a second church.
 */

const { mockGet, mockUpdate, mockBatchSet, mockBatchCommit, mockSetClaims, mockSubdomain } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUpdate: vi.fn().mockResolvedValue(undefined),
  mockBatchSet: vi.fn(),
  mockBatchCommit: vi.fn().mockResolvedValue(undefined),
  mockSetClaims: vi.fn().mockResolvedValue(undefined),
  mockSubdomain: vi.fn().mockResolvedValue('grace-church'),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({ doc: vi.fn((id: string) => ({ id, get: mockGet, update: mockUpdate })) })),
    batch: vi.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit })),
  },
}));
vi.mock('@/lib/set-custom-claims', () => ({ setCustomClaims: mockSetClaims }));
vi.mock('@/lib/tenant-private', () => ({
  tenantPrivateRef: (id: string) => ({ id: `tenant_private/${id}` }),
  TENANT_PRIVATE_COLLECTION: 'tenant_private',
}));
// 🔴 NOT '@/lib/dodo/provisioning'. THE-203 moved `generateUniqueSubdomain`
// out to a processor-neutral module precisely so free provisioning does not
// reach into the Dodo lib — the import fence in dodo-billing-flag.test.ts
// enforces that. Mocking the old location here would pass while the production
// import came from somewhere else entirely.
vi.mock('@/lib/tenant-subdomain', () => ({ generateUniqueSubdomain: mockSubdomain }));
vi.mock('@/lib/tenant-lifecycle', () => ({ TENANT_STATUS_ACTIVE: 'active' }));

const { provisionFreeTenant, FreeProvisioningError } = await import('@/lib/free-provisioning');

/** The two docs the batch wrote, by shape rather than by call order. */
const written = () => {
  const calls = mockBatchSet.mock.calls;
  const tenant = calls.find((c) => c[1] && 'subdomain' in c[1])?.[1];
  const priv = calls.find((c) => c[1] && 'adminEmails' in c[1])?.[1];
  return { tenant, priv };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSubdomain.mockResolvedValue('grace-church');
  mockGet.mockResolvedValue({ exists: false, data: () => null });
  mockBatchCommit.mockResolvedValue(undefined);
  mockUpdate.mockResolvedValue(undefined);
});

const run = () => provisionFreeTenant({
  userId: 'u1', ministryName: 'Grace Church', userEmail: 'jim@example.com',
});

describe('provisionFreeTenant — what it writes', () => {
  it('creates the tenant on the free plan', async () => {
    const r = await run();
    expect(r).toEqual({ outcome: 'created', tenantId: 'grace-church' });
    expect(written().tenant).toMatchObject({
      plan: 'free',
      subdomain: 'grace-church',
      status: 'active',
      ownerId: 'u1',
      setupCompleted: false,
    });
  });

  it('🔴 writes NO Dodo or Stripe identifier, and no billingProcessor', async () => {
    await run();
    const { priv } = written();
    // Absence, not null. A `null` here reads as "we tried and failed"; the
    // truth is "there is no subscription and never was".
    for (const key of [
      'dodoCustomerId', 'dodoSubscriptionId', 'dodoProductId', 'billingProcessor',
      'stripeCustomerId', 'stripeSubscriptionId',
    ]) {
      expect(priv, `free tenant private doc carries ${key}`).not.toHaveProperty(key);
    }
    expect(priv).toMatchObject({ adminEmails: ['jim@example.com'] });
  });

  it('writes the empty add-on set rather than omitting it (REP-5a)', async () => {
    await run();
    expect(written().tenant).toHaveProperty('addons');
    expect(Object.values(written().tenant!.addons as Record<string, unknown>).some(Boolean)).toBe(false);
  });

  it('lands both docs in ONE batch, so neither can exist without the other', async () => {
    await run();
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(written().tenant).toBeDefined();
    expect(written().priv).toBeDefined();
  });

  it('🔴 clears signupInProgress in this same request — no webhook is coming', async () => {
    await run();
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'grace-church',
      role: 'admin',
      plan: 'free',
      onboardingCompleted: true,
      signupInProgress: false,
    }));
  });

  it('mints the custom claim, or the new admin cannot read their own tenant', async () => {
    await run();
    expect(mockSetClaims).toHaveBeenCalledWith('u1');
  });

  it('records no admin email when the account has none, rather than a blank one', async () => {
    await provisionFreeTenant({ userId: 'u1', ministryName: 'Grace Church', userEmail: null });
    expect(written().priv).toMatchObject({ adminEmails: [] });
  });
});

describe('provisionFreeTenant — refusals', () => {
  it('🔴 never builds a second church for a user who already has one', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ tenantId: 'existing-church' }) });
    const r = await run();
    expect(r).toEqual({ outcome: 'already-provisioned', tenantId: 'existing-church' });
    // The real assertion: nothing was written at all.
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetClaims).not.toHaveBeenCalled();
  });

  it('refuses a ministry name too short to be one, before writing anything', async () => {
    await expect(provisionFreeTenant({ userId: 'u1', ministryName: ' a ', userEmail: null }))
      .rejects.toBeInstanceOf(FreeProvisioningError);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('refuses with no user id', async () => {
    await expect(provisionFreeTenant({ userId: '', ministryName: 'Grace Church', userEmail: null }))
      .rejects.toBeInstanceOf(FreeProvisioningError);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('trims the ministry name rather than storing the whitespace a form gave it', async () => {
    await provisionFreeTenant({ userId: 'u1', ministryName: '  Grace Church  ', userEmail: null });
    expect(mockSubdomain).toHaveBeenCalledWith('Grace Church');
    expect(written().tenant).toMatchObject({ name: 'Grace Church' });
  });
});

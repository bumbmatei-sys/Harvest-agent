import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks (must be defined before vi.mock calls) ───────────────────
const {
  mockConstructEvent,
  mockSubsRetrieve,
  mockSubsCancel,
  mockSubsUpdate,
  mockCustomersRetrieve,
  mockTransfersCreate,
  mockChargesRetrieve,
} = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockSubsRetrieve: vi.fn(),
  mockSubsCancel: vi.fn().mockResolvedValue(undefined),
  mockSubsUpdate: vi.fn().mockResolvedValue({ id: 'sub_updated' }),
  mockCustomersRetrieve: vi.fn().mockResolvedValue({ email: 'pastor@grace.org' }),
  mockTransfersCreate: vi.fn().mockResolvedValue({ id: 'tr_123' }),
  mockChargesRetrieve: vi.fn(),
}));

const {
  mockDocGet,
  mockDocSet,
  mockDocUpdate,
  mockDocDelete,
  mockCollGet,
  mockBatchUpdate,
  mockBatchCommit,
  mockAdd,
  mockGetUser,
} = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockDocUpdate: vi.fn().mockResolvedValue(undefined),
  mockDocDelete: vi.fn().mockResolvedValue(undefined),
  mockCollGet: vi.fn().mockResolvedValue({ docs: [], empty: true, forEach: vi.fn() }),
  mockBatchUpdate: vi.fn(),
  mockBatchCommit: vi.fn().mockResolvedValue(undefined),
  mockAdd: vi.fn().mockResolvedValue({ id: 'new-id' }),
  mockGetUser: vi.fn().mockResolvedValue({ uid: 'u1', email: 'pastor@grace.org' }),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mockConstructEvent };
    subscriptions = { retrieve: mockSubsRetrieve, cancel: mockSubsCancel, update: mockSubsUpdate };
    customers = { retrieve: mockCustomersRetrieve };
    transfers = { create: mockTransfersCreate };
    charges = { retrieve: mockChargesRetrieve };
  },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: mockDocGet,
        set: mockDocSet,
        update: mockDocUpdate,
        delete: mockDocDelete,
      })),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      get: mockCollGet,
      add: mockAdd,
    })),
    batch: vi.fn(() => ({
      update: mockBatchUpdate,
      delete: vi.fn(),
      commit: mockBatchCommit,
    })),
  },
  adminAuth: { verifyIdToken: vi.fn(), getUser: mockGetUser },
}));

vi.mock('@/lib/set-custom-claims', () => ({
  setCustomClaims: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: vi.fn((n: number) => ({ __increment: n })),
    arrayUnion: vi.fn((...a: unknown[]) => ({ __arrayUnion: a })),
  },
  getFirestore: vi.fn(),
}));

vi.mock('@/lib/ai-utils', () => ({
  generateAccessCode: vi.fn().mockReturnValue('CODE-1234'),
}));

vi.mock('@/lib/stripe-config', () => ({
  PLAN_PRICES: {
    plus: { monthly: 'price_plus_m', yearly: 'price_plus_y' },
    pro: { monthly: 'price_pro_m', yearly: 'price_pro_y' },
    max: { monthly: 'price_max_m', yearly: 'price_max_y' },
    ultra: { monthly: 'price_ultra_m', yearly: 'price_ultra_y' },
  },
  getPlanFromPriceId: vi.fn((id: string) => {
    const map: Record<string, string> = {
      price_pro_m: 'pro', price_pro_y: 'pro',
      price_ultra_m: 'ultra', price_ultra_y: 'ultra',
    };
    return map[id] || null;
  }),
}));

const { POST } = await import('../webhook/route');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body = '{}', sig: string | null = 'valid-sig'): NextRequest {
  const headers: Record<string, string> = {};
  if (sig !== null) headers['stripe-signature'] = sig;
  return new NextRequest('https://example.com/api/stripe/webhook', {
    method: 'POST',
    headers,
    body,
  });
}

function makeEvent(type: string, data: object, id = 'evt_001'): object {
  return { id, type, data: { object: data } };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
  // Default: new event (not duplicate)
  mockDocGet.mockResolvedValue({ exists: false });
  // Default: user collection empty
  mockCollGet.mockResolvedValue({ docs: [], empty: true, forEach: vi.fn() });
});

// ── Signature validation ───────────────────────────────────────────────────

describe('webhook signature validation', () => {
  it('returns 400 when stripe-signature header is missing', async () => {
    const res = await POST(makeRequest('{}', null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/missing signature/i);
  });

  it('returns 400 when constructEvent throws (invalid signature)', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found');
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid signature/i);
  });
});

// ── Idempotency ────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('skips duplicate events', async () => {
    mockDocGet.mockResolvedValue({ exists: true }); // already processed
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.updated', {}));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  it('undoes the idempotency marker and 500s when processing fails, so the retry re-processes', async () => {
    const session = { subscription: 'sub_new', customer: 'cus_001', amount_total: 9900 };
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', session));
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_new',
      metadata: { tenantId: 'tenant1', plan: 'pro', billing: 'monthly' },
      current_period_end: 1800000000,
    });
    // Dedup get → new event; tenant get → transient Firestore failure mid-processing.
    mockDocGet.mockResolvedValueOnce({ exists: false })
              .mockRejectedValueOnce(new Error('Firestore unavailable'));

    const res = await POST(makeRequest());
    expect(res.status).toBe(500); // Stripe retries on 5xx
    expect(mockDocDelete).toHaveBeenCalled(); // marker undone → redelivery is NOT skipped
  });

  it('does not delete a marker it did not write (dedup read fails)', async () => {
    // If the duplicate check itself fails, the marker (if any) belongs to a prior
    // successful run — deleting it would let the retry double-process the event.
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.updated', {}));
    mockDocGet.mockRejectedValueOnce(new Error('Firestore unavailable'));

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(mockDocDelete).not.toHaveBeenCalled();
  });
});

// ── checkout.session.completed ─────────────────────────────────────────────

describe('checkout.session.completed', () => {
  it('upgrades tenant plan and cancels old subscription', async () => {
    const session = {
      id: 'cs_001',
      subscription: 'sub_new',
      customer: 'cus_001',
      amount_total: 9900,
    };
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', session));
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_new',
      metadata: { tenantId: 'tenant1', plan: 'pro', billing: 'monthly' },
      current_period_end: 1800000000,
    });
    // Tenant has an old subscription
    mockDocGet.mockResolvedValueOnce({ exists: false }) // webhook_events not duplicate
                .mockResolvedValueOnce({ exists: true, data: () => ({ stripeSubscriptionId: 'sub_old', addOnAiAssistantCode: null }) }); // tenant doc

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockSubsCancel).toHaveBeenCalledWith('sub_old');
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'pro', status: 'active', stripeSubscriptionId: 'sub_new' })
    );
  });

  it('auto-generates AI assistant code when upgrading to ultra', async () => {
    const session = { subscription: 'sub_ultra', customer: 'cus_001', amount_total: 34900 };
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', session));
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_ultra',
      metadata: { tenantId: 'tenant1', plan: 'ultra', billing: 'monthly' },
      current_period_end: 1800000000,
    });
    mockDocGet.mockResolvedValueOnce({ exists: false }) // not duplicate
              .mockResolvedValueOnce({ exists: true, data: () => ({ stripeSubscriptionId: null, addOnAiAssistantCode: null }) });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'ultra', addOnAiAssistantCode: 'CODE-1234' })
    );
  });

  it('builds a new tenant when meta.newTenant is set (no existing tenantId)', async () => {
    const session = { id: 'cs_new', subscription: 'sub_new', customer: 'cus_new', amount_total: 11900 };
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', session));
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_new',
      metadata: { newTenant: 'true', userId: 'u1', plan: 'pro', billing: 'monthly', ministryName: 'Grace Church' },
    });
    // webhook_events dedup → not duplicate; subdomain availability → free.
    mockDocGet.mockResolvedValue({ exists: false });
    mockGetUser.mockResolvedValue({ uid: 'u1', email: 'pastor@grace.org' });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // Tenant doc created: active, gated for first-run, on the paid plan.
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        subdomain: 'grace-church',
        plan: 'pro',
        status: 'active',
        setupCompleted: false,
        adminEmails: ['pastor@grace.org'],
      })
    );
    // Paying user promoted to admin and signup marker cleared.
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'grace-church',
        role: 'admin',
        onboardingCompleted: true,
        signupInProgress: false,
      })
    );
    // Subscription tagged with the new tenant id WITHOUT clobbering the metadata
    // set at checkout — the merge preserves plan/billing (and referrerId when
    // present) so later lifecycle/commission events keep resolving.
    expect(mockSubsUpdate).toHaveBeenCalledWith('sub_new', {
      metadata: expect.objectContaining({ tenantId: 'grace-church', plan: 'pro', billing: 'monthly' }),
    });
  });

  it('pays the initial affiliate transfer with a per-subscription idempotency key (retry-safe)', async () => {
    const session = { subscription: 'sub_aff', customer: 'cus_1', amount_total: 11900 };
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', session));
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_aff',
      metadata: { tenantId: 'tenant1', plan: 'pro', billing: 'monthly', referrerId: 'refUser' },
      current_period_end: 1800000000,
    });
    mockDocGet
      .mockResolvedValueOnce({ exists: false }) // webhook_events dedup → new event
      .mockResolvedValueOnce({ exists: true, data: () => ({ stripeSubscriptionId: null, ownerId: 'someoneElse', addOnAiAssistantCode: null }) }) // tenant (owner != referrer)
      .mockResolvedValueOnce({ exists: true, data: () => ({ affiliateStripeAccountId: 'acct_ref', affiliateConnectStatus: 'active' }) }); // referrer w/ active Connect

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    // A retry of this event must not move money twice: Stripe dedups on the key.
    // Flat 15% of the $119 charge = 1785 cents (was 10% = 1190 under the old ladder).
    expect(mockTransfersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1785, destination: 'acct_ref' }),
      expect.objectContaining({ idempotencyKey: 'aff_initial_sub_aff' }),
    );
  });

  it('blocks self-referral commissions', async () => {
    const session = { subscription: 'sub_001', customer: 'cus_001', amount_total: 9900 };
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', session));
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_001',
      metadata: { tenantId: 'tenant1', plan: 'pro', billing: 'monthly', referrerId: 'owner1' },
      current_period_end: 1800000000,
    });
    // Tenant owner IS the referrer
    mockDocGet.mockResolvedValueOnce({ exists: false })
              .mockResolvedValueOnce({ exists: true, data: () => ({ stripeSubscriptionId: null, ownerId: 'owner1', addOnAiAssistantCode: null }) });

    await POST(makeRequest());

    // No affiliate commission should be created
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockTransfersCreate).not.toHaveBeenCalled();
  });
});

// ── customer.subscription.updated ─────────────────────────────────────────

describe('customer.subscription.updated', () => {
  it('updates tenant plan and syncs user docs', async () => {
    const subscription = {
      id: 'sub_001',
      status: 'active',
      metadata: { tenantId: 'tenant1', plan: 'max' },
      items: { data: [{ price: { id: 'price_max_m' } }] },
      current_period_end: 1800000000,
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.updated', subscription));
    // Dedup get → new event; tenant get → this IS the tenant's current subscription.
    mockDocGet.mockResolvedValue({ exists: false, data: () => ({ stripeSubscriptionId: 'sub_001' }) });
    mockCollGet.mockResolvedValue({
      docs: [{ ref: {}, data: () => ({}) }],
      empty: false,
      forEach: vi.fn(),
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'max', status: 'active' })
    );
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  it('marks tenant as past_due when subscription payment lags', async () => {
    const subscription = {
      id: 'sub_001',
      status: 'past_due',
      metadata: { tenantId: 'tenant1' },
      items: { data: [] },
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.updated', subscription));
    mockDocGet.mockResolvedValue({ exists: false, data: () => ({ stripeSubscriptionId: 'sub_001' }) });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'past_due' })
    );
  });

  it('ignores an update for a stale (non-current) subscription', async () => {
    // The old plan being cancelled during an upgrade fires an update for a sub
    // that is no longer the tenant's current one — it must not touch tenant state.
    const subscription = {
      id: 'sub_old',
      status: 'canceled',
      metadata: { tenantId: 'tenant1', plan: 'plus' },
      items: { data: [{ price: { id: 'price_plus_m' } }] },
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.updated', subscription));
    // Tenant's current sub is sub_new, not the sub_old this event is for.
    mockDocGet.mockResolvedValue({ exists: false, data: () => ({ stripeSubscriptionId: 'sub_new' }) });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ── customer.subscription.deleted ─────────────────────────────────────────

describe('customer.subscription.deleted', () => {
  it('downgrades tenant to plus on cancellation', async () => {
    const subscription = {
      id: 'sub_001',
      metadata: { tenantId: 'tenant1' },
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.deleted', subscription));
    // The cancelled sub IS the tenant's current one → the downgrade should apply.
    mockDocGet.mockResolvedValue({ exists: false, data: () => ({ stripeSubscriptionId: 'sub_001' }) });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'plus', status: 'cancelled', stripeSubscriptionId: null })
    );
  });

  it('ignores deletion of a stale (non-current) subscription', async () => {
    // During an upgrade the OLD sub is deliberately cancelled after the tenant has
    // already moved to the NEW sub. That stale deletion must NOT downgrade them.
    const subscription = {
      id: 'sub_old',
      metadata: { tenantId: 'tenant1' },
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.deleted', subscription));
    mockDocGet.mockResolvedValue({ exists: false, data: () => ({ stripeSubscriptionId: 'sub_new' }) });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  it('revokes AI assistant bindings when add-on is cancelled', async () => {
    const subscription = {
      id: 'sub_addon',
      metadata: { tenantId: 'tenant1', addOn: 'ai-assistant' },
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.deleted', subscription));
    // Dedup → new event; tenant doc → this sub IS the tenant's recorded add-on.
    mockDocGet.mockResolvedValueOnce({ exists: false })
              .mockResolvedValueOnce({ exists: true, data: () => ({ addOnAiAssistant: 'sub_addon' }) });
    // Simulate 2 existing bindings
    const fakeBindingRef = { ref: { delete: vi.fn() } };
    mockCollGet.mockResolvedValue({
      docs: [fakeBindingRef, fakeBindingRef],
      size: 2,
      forEach: vi.fn((cb: (d: typeof fakeBindingRef) => void) => {
        cb(fakeBindingRef);
        cb(fakeBindingRef);
      }),
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ addOnAiAssistant: null, addOnAiAssistantCode: null })
    );
  });

  it('does not clear tenant add-on state when a DIFFERENT admin\'s add-on is cancelled', async () => {
    const subscription = {
      id: 'sub_addon_b',
      metadata: { tenantId: 'tenant1', addOn: 'ai-assistant', userId: 'adminB' },
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.deleted', subscription));
    mockDocGet.mockResolvedValueOnce({ exists: false }) // dedup
              .mockResolvedValueOnce({ exists: true, data: () => ({ hasAIAssistant: true, aiAssistantSubscriptionItemId: 'sub_addon_b' }) }) // buyer
              .mockResolvedValueOnce({ exists: true, data: () => ({ addOnAiAssistant: 'sub_addon_a' }) }); // tenant records another sub

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    // The buyer's own entitlement is revoked (incl. Telegram unlink)…
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        hasAIAssistant: false,
        aiAssistantConnected: false,
        telegramUsername: null,
        telegramChatId: null,
        aiAssistantSubscriptionItemId: null,
      })
    );
    // …but the tenant's add-on state (another admin's subscription) survives.
    expect(mockDocUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ addOnAiAssistant: null })
    );
  });
});

// ── AI Assistant entitlement lifecycle (plan-included vs purchased) ─────────

describe('plan-included AI Assistant (ultra owner)', () => {
  it('grants the owner a plan-included assistant when checkout upgrades the tenant to ultra', async () => {
    const session = { subscription: 'sub_ultra', customer: 'cus_001', amount_total: 47900 };
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', session));
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_ultra',
      metadata: { tenantId: 'tenant1', plan: 'ultra', billing: 'monthly' },
    });
    mockDocGet.mockResolvedValueOnce({ exists: false }) // dedup
              .mockResolvedValueOnce({ exists: true, data: () => ({ stripeSubscriptionId: null, addOnAiAssistantCode: null, ownerId: 'owner1' }) }) // tenant
              .mockResolvedValueOnce({ exists: true, data: () => ({}) }); // owner user doc

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ hasAIAssistant: true, aiAssistantSource: 'plan' }),
      { merge: true },
    );
    expect(mockSubsCancel).not.toHaveBeenCalled();
  });

  it('grants the owner a plan-included assistant on a new ultra ministry signup', async () => {
    const session = { id: 'cs_new', subscription: 'sub_new', customer: 'cus_new', amount_total: 47900 };
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', session));
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_new',
      metadata: { newTenant: 'true', userId: 'u1', plan: 'ultra', billing: 'monthly', ministryName: 'Grace Church' },
    });
    mockDocGet.mockResolvedValue({ exists: false });
    mockGetUser.mockResolvedValue({ uid: 'u1', email: 'pastor@grace.org' });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ hasAIAssistant: true, aiAssistantSource: 'plan' }),
      { merge: true },
    );
  });

  it('cancels a previously PURCHASED add-on when the owner upgrades to ultra (no double charge)', async () => {
    const session = { subscription: 'sub_ultra', customer: 'cus_001', amount_total: 47900 };
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', session));
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_ultra',
      metadata: { tenantId: 'tenant1', plan: 'ultra', billing: 'monthly' },
    });
    mockDocGet.mockResolvedValueOnce({ exists: false }) // dedup
              .mockResolvedValueOnce({ exists: true, data: () => ({ stripeSubscriptionId: null, addOnAiAssistantCode: null, ownerId: 'owner1' }) }) // tenant
              .mockResolvedValueOnce({ exists: true, data: () => ({ hasAIAssistant: true, aiAssistantSubscriptionItemId: 'sub_ai_purchased' }) }); // owner bought the add-on

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    // Entitlement flips to plan-included BEFORE the cancel (so the resulting
    // deletion event won't revoke it), then the purchased sub is cancelled and
    // its pointer cleared.
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ hasAIAssistant: true, aiAssistantSource: 'plan' }),
      { merge: true },
    );
    expect(mockSubsCancel).toHaveBeenCalledWith('sub_ai_purchased');
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ aiAssistantSubscriptionItemId: null }),
      { merge: true },
    );
  });

  it('grants via customer.subscription.updated when the plan becomes ultra', async () => {
    const subscription = {
      id: 'sub_001',
      status: 'active',
      metadata: { tenantId: 'tenant1', plan: 'ultra' },
      items: { data: [{ price: { id: 'price_ultra_m' } }] },
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.updated', subscription));
    mockDocGet.mockResolvedValueOnce({ exists: false }) // dedup
              .mockResolvedValueOnce({ exists: true, data: () => ({ stripeSubscriptionId: 'sub_001', ownerId: 'owner1' }) }) // tenant
              .mockResolvedValueOnce({ exists: true, data: () => ({}) }); // owner user doc

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ hasAIAssistant: true, aiAssistantSource: 'plan' }),
      { merge: true },
    );
  });

  it('revokes the plan-included assistant when the plan leaves ultra', async () => {
    const subscription = {
      id: 'sub_001',
      status: 'active',
      metadata: { tenantId: 'tenant1', plan: 'pro' },
      items: { data: [{ price: { id: 'price_pro_m' } }] },
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.updated', subscription));
    mockDocGet.mockResolvedValueOnce({ exists: false }) // dedup
              .mockResolvedValueOnce({ exists: true, data: () => ({ stripeSubscriptionId: 'sub_001', ownerId: 'owner1' }) }) // tenant
              .mockResolvedValueOnce({ exists: true, data: () => ({ hasAIAssistant: true, aiAssistantSource: 'plan', aiAssistantConnected: true }) }); // owner (plan-included)

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        hasAIAssistant: false,
        aiAssistantConnected: false,
        telegramUsername: null,
        telegramChatId: null,
        aiAssistantSource: null,
      })
    );
  });

  it('leaves a PURCHASED assistant untouched when the plan leaves ultra', async () => {
    const subscription = {
      id: 'sub_001',
      status: 'active',
      metadata: { tenantId: 'tenant1', plan: 'pro' },
      items: { data: [{ price: { id: 'price_pro_m' } }] },
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.updated', subscription));
    mockDocGet.mockResolvedValueOnce({ exists: false }) // dedup
              .mockResolvedValueOnce({ exists: true, data: () => ({ stripeSubscriptionId: 'sub_001', ownerId: 'owner1' }) }) // tenant
              .mockResolvedValueOnce({ exists: true, data: () => ({ hasAIAssistant: true, aiAssistantSubscriptionItemId: 'sub_ai_1' }) }); // owner purchased separately

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ hasAIAssistant: false })
    );
  });

  it('revokes the plan-included assistant when the plan subscription is cancelled', async () => {
    const subscription = {
      id: 'sub_001',
      metadata: { tenantId: 'tenant1' },
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.deleted', subscription));
    mockDocGet.mockResolvedValueOnce({ exists: false }) // dedup
              .mockResolvedValueOnce({ exists: true, data: () => ({ stripeSubscriptionId: 'sub_001', ownerId: 'owner1' }) }) // tenant
              .mockResolvedValueOnce({ exists: true, data: () => ({ hasAIAssistant: true, aiAssistantSource: 'plan' }) }); // owner (plan-included)

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'plus', status: 'cancelled' })
    );
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ hasAIAssistant: false, aiAssistantConnected: false })
    );
  });
});

describe('per-admin AI Assistant add-on cancellation', () => {
  it('revokes the buyer\'s entitlement and unlinks Telegram when their add-on is cancelled', async () => {
    const subscription = {
      id: 'sub_ai_1',
      metadata: { tenantId: 'tenant1', addOn: 'ai-assistant', userId: 'u42' },
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.deleted', subscription));
    mockDocGet.mockResolvedValueOnce({ exists: false }) // dedup
              .mockResolvedValueOnce({ exists: true, data: () => ({ hasAIAssistant: true, aiAssistantConnected: true, aiAssistantSubscriptionItemId: 'sub_ai_1' }) }) // buyer
              .mockResolvedValueOnce({ exists: true, data: () => ({ addOnAiAssistant: null }) }); // tenant (no recorded add-on)

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        hasAIAssistant: false,
        aiAssistantConnected: false,
        telegramUsername: null,
        telegramChatId: null,
        aiAssistantSubscriptionItemId: null,
      })
    );
    // Never falls through to the tenant-downgrade path.
    expect(mockDocUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'plus' })
    );
  });

  it('does NOT revoke a plan-included entitlement when the (deliberately cancelled) purchased sub deletes', async () => {
    // 1c: owner bought the add-on, then upgraded to ultra — we cancelled the
    // purchased sub ourselves and converted the entitlement to plan-included.
    // The deletion event that follows must not claw the entitlement back.
    const subscription = {
      id: 'sub_ai_purchased',
      metadata: { tenantId: 'tenant1', addOn: 'ai-assistant', userId: 'owner1' },
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.deleted', subscription));
    mockDocGet.mockResolvedValueOnce({ exists: false }) // dedup
              .mockResolvedValueOnce({ exists: true, data: () => ({ hasAIAssistant: true, aiAssistantSource: 'plan', aiAssistantConnected: true }) }); // owner is plan-included now

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('ignores add-on subscription UPDATES for tenant plan/state (e.g. cancel_at_period_end)', async () => {
    const subscription = {
      id: 'sub_ai_1',
      status: 'active',
      cancel_at_period_end: true,
      metadata: { tenantId: 'tenant1', addOn: 'ai-assistant', userId: 'u42' },
      items: { data: [] },
    };
    mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.updated', subscription));
    mockDocGet.mockResolvedValueOnce({ exists: false }); // dedup

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ── invoice events ─────────────────────────────────────────────────────────

describe('invoice.payment_failed', () => {
  it('suspends the tenant when payment fails', async () => {
    const invoice = { id: 'in_001', subscription: 'sub_001' };
    mockConstructEvent.mockReturnValue(makeEvent('invoice.payment_failed', invoice));
    mockDocGet.mockResolvedValue({ exists: false });
    mockSubsRetrieve.mockResolvedValue({ metadata: { tenantId: 'tenant1' } });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'suspended' })
    );
  });
});

describe('invoice.payment_succeeded', () => {
  it('reactivates a suspended tenant on payment recovery', async () => {
    const invoice = {
      id: 'in_002',
      subscription: 'sub_001',
      amount_paid: 9900,
      billing_reason: 'subscription_cycle',
    };
    mockConstructEvent.mockReturnValue(makeEvent('invoice.payment_succeeded', invoice));
    mockDocGet.mockResolvedValueOnce({ exists: false }) // not duplicate
              .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'suspended' }) }); // tenant is suspended
    mockSubsRetrieve.mockResolvedValue({ metadata: { tenantId: 'tenant1' } });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' })
    );
  });

  it('does not reactivate an already-active tenant', async () => {
    const invoice = { id: 'in_003', subscription: 'sub_001', amount_paid: 9900, billing_reason: 'subscription_cycle' };
    mockConstructEvent.mockReturnValue(makeEvent('invoice.payment_succeeded', invoice));
    mockDocGet.mockResolvedValueOnce({ exists: false })
              .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'active' }) }); // already active
    mockSubsRetrieve.mockResolvedValue({ metadata: { tenantId: 'tenant1' } });

    await POST(makeRequest());
    // update should NOT be called (already active)
    expect(mockDocUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' })
    );
  });
});

// ── Flat 15% affiliate commission (replaces the per-plan ladder) ────────────
describe('flat 15% affiliate commission', () => {
  // [plan, amount_total (cents), expected 15% commission (cents)]. The old ladder
  // would have paid 490 / 1190 / 2985 / 6980 — only 'max' coincided with 15%.
  const PLANS: Array<[string, number, number]> = [
    ['plus', 4900, 735],
    ['pro', 11900, 1785],
    ['max', 19900, 2985],
    ['ultra', 34900, 5235],
  ];

  it.each(PLANS)(
    'initial commission is 15%% of the charge for the %s plan (%d cents -> %d)',
    async (plan, amountTotal, expected) => {
      const session = { subscription: 'sub_x', customer: 'cus_x', amount_total: amountTotal };
      mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', session));
      mockSubsRetrieve.mockResolvedValue({
        id: 'sub_x',
        metadata: { tenantId: 'tenant1', plan, billing: 'monthly', referrerId: 'refUser' },
        current_period_end: 1800000000,
      });
      mockDocGet
        .mockResolvedValueOnce({ exists: false }) // dedup → new event
        .mockResolvedValueOnce({ exists: true, data: () => ({ stripeSubscriptionId: null, ownerId: 'someoneElse', addOnAiAssistantCode: null }) }) // tenant (owner != referrer)
        .mockResolvedValueOnce({ exists: true, data: () => ({ affiliateStripeAccountId: 'acct_ref', affiliateConnectStatus: 'active' }) }); // referrer w/ active Connect

      const res = await POST(makeRequest());
      expect(res.status).toBe(200);
      // Same 15% for every tier — the rate no longer depends on the plan.
      expect(mockTransfersCreate).toHaveBeenCalledWith(
        expect.objectContaining({ amount: expected, destination: 'acct_ref' }),
        expect.objectContaining({ idempotencyKey: 'aff_initial_sub_x' }),
      );
    },
  );

  it('recurring commission is 15% of invoice.amount_paid', async () => {
    const invoice = { id: 'in_rec', subscription: 'sub_rec', amount_paid: 11900, billing_reason: 'subscription_cycle' };
    mockConstructEvent.mockReturnValue(makeEvent('invoice.payment_succeeded', invoice));
    mockSubsRetrieve.mockResolvedValue({ metadata: { tenantId: 'tenant1', plan: 'pro', referrerId: 'refUser' } });
    mockDocGet
      .mockResolvedValueOnce({ exists: false }) // dedup
      .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'active' }) }) // tenant (not suspended)
      .mockResolvedValueOnce({ exists: true, data: () => ({ affiliateStripeAccountId: 'acct_ref', affiliateConnectStatus: 'active' }) }); // referrer

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockTransfersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1785, // round(11900 * 0.15)
        destination: 'acct_ref',
        metadata: expect.objectContaining({ type: 'affiliate_commission_recurring' }),
      }),
    );
  });

  it('recurring commission follows the charged amount after the referred tenant upgrades', async () => {
    // Tenant upgraded (Stripe now charges the higher price), so amount_paid rises
    // and 15% is taken off the ACTUAL charge. A stale metadata.plan ('pro') does
    // not change the money — the rate is flat and the amount is authoritative.
    const invoice = { id: 'in_up', subscription: 'sub_up', amount_paid: 34900, billing_reason: 'subscription_cycle' };
    mockConstructEvent.mockReturnValue(makeEvent('invoice.payment_succeeded', invoice));
    mockSubsRetrieve.mockResolvedValue({ metadata: { tenantId: 'tenant1', plan: 'pro', referrerId: 'refUser' } });
    mockDocGet
      .mockResolvedValueOnce({ exists: false }) // dedup
      .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'active' }) }) // tenant
      .mockResolvedValueOnce({ exists: true, data: () => ({ affiliateStripeAccountId: 'acct_ref', affiliateConnectStatus: 'active' }) }); // referrer

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockTransfersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5235 }), // round(34900 * 0.15)
    );
  });

  it('new-tenant signup preserves referrerId/plan/billing while adding tenantId', async () => {
    // Regression: Stripe metadata updates REPLACE the object. A blind { tenantId }
    // write here wiped referrerId — which the recurring-commission path reads to
    // decide whether to pay at all — silently killing the affiliate's stream at
    // the first renewal, on the exact path where referrals live.
    const session = { id: 'cs_ref', subscription: 'sub_ref', customer: 'cus_ref', amount_total: 11900 };
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', session));
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_ref',
      metadata: {
        newTenant: 'true', userId: 'u1', plan: 'pro', billing: 'monthly',
        ministryName: 'Grace Church', referrerId: 'refUser',
      },
    });
    // Blanket not-exists WITH a data() so the referrer lookup in the initial-
    // commission path is benign (no Connect → pending, no transfer). We only
    // assert the metadata merge here.
    mockDocGet.mockResolvedValue({ exists: false, data: () => ({}) });
    mockGetUser.mockResolvedValue({ uid: 'u1', email: 'pastor@grace.org' });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockSubsUpdate).toHaveBeenCalledWith('sub_ref', {
      metadata: {
        newTenant: 'true', userId: 'u1', plan: 'pro', billing: 'monthly',
        ministryName: 'Grace Church', referrerId: 'refUser', tenantId: 'grace-church',
      },
    });
  });
});

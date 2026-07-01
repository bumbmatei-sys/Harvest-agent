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
    // Subscription tagged with the new tenant id for future lifecycle events.
    expect(mockSubsUpdate).toHaveBeenCalledWith('sub_new', { metadata: { tenantId: 'grace-church' } });
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
    mockDocGet.mockResolvedValue({ exists: false });
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks (must be defined before vi.mock calls) ───────────────────
const { mockConstructEvent } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
}));

const {
  mockDocGet,
  mockDocSet,
  mockDocDelete,
  mockCollGet,
  mockTenantUpdate,
} = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockDocDelete: vi.fn().mockResolvedValue(undefined),
  mockCollGet: vi.fn(),
  mockTenantUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mockConstructEvent };
  },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: mockDocGet,
        set: mockDocSet,
        delete: mockDocDelete,
      })),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: mockCollGet,
    })),
  },
}));

const { POST } = await import('../connect/webhook/route');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body = '{}', sig: string | null = 'valid-sig'): NextRequest {
  const headers: Record<string, string> = {};
  if (sig !== null) headers['stripe-signature'] = sig;
  return new NextRequest('https://example.com/api/stripe/connect/webhook', {
    method: 'POST',
    headers,
    body,
  });
}

function makeAccountEvent(account: object, id = 'evt_acct_001', type = 'account.updated'): object {
  return { id, type, data: { object: account } };
}

/** Build a QuerySnapshot-like object. Pass null for the not-found (empty) case. */
function tenantSnapshot(data: Record<string, unknown> | null, id = 'bumb') {
  if (data === null) return { empty: true, docs: [] };
  return {
    empty: false,
    docs: [{ id, data: () => data, ref: { update: mockTenantUpdate } }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_mock';
  // Default: new event (not a duplicate) for the webhook_events dedup read.
  mockDocGet.mockResolvedValue({ exists: false });
  // Default: no tenant matches (both lookups empty).
  mockCollGet.mockResolvedValue(tenantSnapshot(null));
});

// ── Signature validation (security boundary) ────────────────────────────────

describe('connect webhook signature validation', () => {
  it('returns 400 when the stripe-signature header is missing', async () => {
    const res = await POST(makeRequest('{}', null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/missing signature/i);
    // A forged/unsigned request must never touch a tenant doc or write a marker.
    expect(mockTenantUpdate).not.toHaveBeenCalled();
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  it('returns 400 and does NOT flip any tenant when the signature is invalid', async () => {
    // Security-critical: a forged account.updated must not reach the status write.
    mockConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found');
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid signature/i);
    expect(mockTenantUpdate).not.toHaveBeenCalled();
    expect(mockDocSet).not.toHaveBeenCalled();
    expect(mockCollGet).not.toHaveBeenCalled();
  });
});

// ── Configuration ───────────────────────────────────────────────────────────

describe('connect webhook configuration', () => {
  it('returns 500 and does no processing when STRIPE_CONNECT_WEBHOOK_SECRET is missing', async () => {
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
    // Never even attempts to verify or process.
    expect(mockConstructEvent).not.toHaveBeenCalled();
    expect(mockTenantUpdate).not.toHaveBeenCalled();
  });

  it('does not fall back to the main STRIPE_WEBHOOK_SECRET', async () => {
    // Only the connect secret is unset; the main secret being present must NOT
    // let this endpoint verify — it has its own signing secret.
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_main_mock';
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(mockConstructEvent).not.toHaveBeenCalled();
  });
});

// ── account.updated → status sync ───────────────────────────────────────────

describe('account.updated status sync', () => {
  it('sets stripeConnectStatus to active when charges and payouts are enabled', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet.mockResolvedValue(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(mockTenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stripeConnectStatus: 'active' }),
    );
  });

  it('sets stripeConnectStatus to restricted when requirements are currently_due', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123',
      charges_enabled: false,
      payouts_enabled: false,
      requirements: { currently_due: ['external_account'] },
    }));
    mockCollGet.mockResolvedValue(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockTenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stripeConnectStatus: 'restricted' }),
    );
  });

  it('sets pending when neither payout-ready nor requirements are due', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123',
      charges_enabled: false,
      payouts_enabled: false,
      requirements: { currently_due: [] },
    }));
    mockCollGet.mockResolvedValue(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockTenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stripeConnectStatus: 'pending' }),
    );
  });

  it('returns 200 with received:true and writes nothing when no tenant matches', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_unknown', charges_enabled: true, payouts_enabled: true,
    }));
    // The account id is not any tenant's canonical (donations) account.
    mockCollGet.mockResolvedValue(tenantSnapshot(null));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(mockTenantUpdate).not.toHaveBeenCalled();
  });
});

// ── Unified-account lens ─────────────────────────────────────────────────────

describe('account.updated unified-account mirror', () => {
  it('mirrors the account onto the tenant owner so the SAME account powers affiliate payouts', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet.mockResolvedValue(
      tenantSnapshot({ stripeConnectAccountId: 'acct_123', ownerId: 'owner1' }),
    );

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    // Donations status synced onto the tenant doc…
    expect(mockTenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stripeConnectStatus: 'active' }),
    );
    // …and the owner's affiliate-payout fields mirrored to the SAME account id/status
    // (the payout path reads users/{referrerId}.affiliateStripeAccountId / affiliateConnectStatus).
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ affiliateStripeAccountId: 'acct_123', affiliateConnectStatus: 'active' }),
      { merge: true },
    );
  });

  it('falls back to createdBy when the tenant has no ownerId', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet.mockResolvedValue(
      tenantSnapshot({ stripeConnectAccountId: 'acct_123', createdBy: 'creator9' }),
    );

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ affiliateStripeAccountId: 'acct_123', affiliateConnectStatus: 'active' }),
      { merge: true },
    );
  });

  it('does not mirror to a user doc when the tenant has neither ownerId nor createdBy', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet.mockResolvedValue(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockTenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stripeConnectStatus: 'active' }),
    );
    // Only the webhook_events marker set() — never an affiliate mirror.
    expect(mockDocSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ affiliateStripeAccountId: expect.anything() }),
      { merge: true },
    );
  });
});

// ── Idempotency (redelivery lens) ───────────────────────────────────────────

describe('connect webhook idempotency', () => {
  it('short-circuits a duplicate event id without a second write', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockDocGet.mockResolvedValue({ exists: true }); // already processed

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(mockTenantUpdate).not.toHaveBeenCalled();
    expect(mockDocSet).not.toHaveBeenCalled(); // no marker rewrite
  });

  it('undoes the marker and 500s when the tenant write fails, so the retry re-processes', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet.mockResolvedValue(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }));
    mockTenantUpdate.mockRejectedValueOnce(new Error('Firestore unavailable'));

    const res = await POST(makeRequest());
    expect(res.status).toBe(500); // Stripe retries on 5xx
    expect(mockDocDelete).toHaveBeenCalled(); // marker undone → redelivery not skipped
  });

  it('does not delete a marker it did not write when the dedup read fails', async () => {
    // A transient failure on the dedup read must not delete a marker left by a
    // prior successful run — that would let the retry double-process the event.
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockDocGet.mockRejectedValueOnce(new Error('Firestore unavailable'));

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(mockDocDelete).not.toHaveBeenCalled();
  });
});

// ── Defensive: non-account.updated events ───────────────────────────────────

describe('connect webhook other event types', () => {
  it('no-ops (200 received) for an event type other than account.updated', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent(
      { id: 'acct_123' }, 'evt_other', 'account.application.deauthorized',
    ));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(mockTenantUpdate).not.toHaveBeenCalled();
    expect(mockCollGet).not.toHaveBeenCalled();
  });
});

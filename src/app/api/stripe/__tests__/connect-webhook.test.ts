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
  mockBatchUpdate,
  mockBatchCommit,
} = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockDocDelete: vi.fn().mockResolvedValue(undefined),
  mockCollGet: vi.fn(),
  mockTenantUpdate: vi.fn().mockResolvedValue(undefined),
  mockBatchUpdate: vi.fn(),
  mockBatchCommit: vi.fn().mockResolvedValue(undefined),
}));

// The commission sweep lives in a separate, unit-tested helper (see
// src/lib/__tests__/affiliate-payout.test.ts). Here we mock it to verify WIRING:
// that the webhook calls it for each linked user on activation, skips it for
// non-active statuses, and never lets a sweep failure 500 the webhook.
const { mockSweep } = vi.hoisted(() => ({
  mockSweep: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mockConstructEvent };
  },
}));

vi.mock('@/lib/affiliate-payout', () => ({
  sweepPendingAffiliateCommissions: mockSweep,
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
    batch: vi.fn(() => ({
      update: mockBatchUpdate,
      commit: mockBatchCommit,
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

/** Build a users QuerySnapshot for the "reconcile affiliate status" batch update.
 *  Pass an array of user ids; each doc exposes a distinct ref for batch.update. */
function usersSnapshot(ids: string[]) {
  if (ids.length === 0) return { empty: true, docs: [] };
  return {
    empty: false,
    docs: ids.map((id) => ({ id, ref: { id }, data: () => ({}) })),
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
  // Default: sweep finds nothing to do (overridden per-test).
  mockSweep.mockResolvedValue({ total: 0, swept: 0 });
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

describe('account.updated unified-account reconcile', () => {
  it('reconciles affiliate status for EVERY user linked to the account (owner + other admins)', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    // 1st collGet → tenant lookup; 2nd collGet → users linked to this account.
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot({ stripeConnectAccountId: 'acct_123', ownerId: 'owner1' }))
      .mockResolvedValueOnce(usersSnapshot(['owner1', 'adminB']));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    // Donations status synced onto the tenant doc…
    expect(mockTenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stripeConnectStatus: 'active' }),
    );
    // …and affiliate status flipped for BOTH linked users to the same status.
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { id: 'owner1' },
      expect.objectContaining({ affiliateConnectStatus: 'active' }),
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { id: 'adminB' },
      expect.objectContaining({ affiliateConnectStatus: 'active' }),
    );
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  it('propagates a restricted status to linked users', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123',
      charges_enabled: false,
      payouts_enabled: false,
      requirements: { currently_due: ['external_account'] },
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }))
      .mockResolvedValueOnce(usersSnapshot(['owner1']));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { id: 'owner1' },
      expect.objectContaining({ affiliateConnectStatus: 'restricted' }),
    );
  });

  it('still 200s (donations status synced) when no user is linked to the account yet', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }))
      .mockResolvedValueOnce(usersSnapshot([]));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockTenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stripeConnectStatus: 'active' }),
    );
    // No linked users → no batch update.
    expect(mockBatchUpdate).not.toHaveBeenCalled();
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

  it('undoes the marker and 500s when the affiliate reconcile (batch) write fails', async () => {
    // The NEW owner→account status reconciliation runs after the tenant write. A
    // failure there must also bubble → 500 → marker undone, so the retry re-runs the
    // whole (idempotent) handler rather than skipping it as a duplicate.
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }))
      .mockResolvedValueOnce(usersSnapshot(['owner1']));
    mockBatchCommit.mockRejectedValueOnce(new Error('Firestore unavailable'));

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(mockTenantUpdate).toHaveBeenCalled(); // tenant status write happened first
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

// ── Pending-commission backfill (sweep on activation) ────────────────────────

describe('account.updated → pending affiliate commission sweep', () => {
  it('sweeps pending commissions for EVERY linked user when the account goes active', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }))
      .mockResolvedValueOnce(usersSnapshot(['owner1', 'adminB']));
    mockSweep.mockResolvedValue({ total: 1, swept: 1 });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // One sweep per linked user, each destined for THIS account (unified account).
    expect(mockSweep).toHaveBeenCalledTimes(2);
    expect(mockSweep).toHaveBeenCalledWith(
      expect.objectContaining({ referrerId: 'owner1', connectAccountId: 'acct_123' }),
    );
    expect(mockSweep).toHaveBeenCalledWith(
      expect.objectContaining({ referrerId: 'adminB', connectAccountId: 'acct_123' }),
    );
  });

  it('does NOT sweep when the account is restricted (not payout-ready)', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123',
      charges_enabled: false,
      payouts_enabled: false,
      requirements: { currently_due: ['external_account'] },
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }))
      .mockResolvedValueOnce(usersSnapshot(['owner1']));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    // Status still mirrored, but no money moved.
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { id: 'owner1' },
      expect.objectContaining({ affiliateConnectStatus: 'restricted' }),
    );
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('does NOT sweep when the account is still pending', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123',
      charges_enabled: false,
      payouts_enabled: false,
      requirements: { currently_due: [] },
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }))
      .mockResolvedValueOnce(usersSnapshot(['owner1']));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('does NOT sweep when no user is linked to the account', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }))
      .mockResolvedValueOnce(usersSnapshot([]));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('a sweep failure does NOT 500 the webhook — the status write still commits', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }))
      .mockResolvedValueOnce(usersSnapshot(['owner1']));
    mockSweep.mockRejectedValue(new Error('Stripe unavailable'));

    const res = await POST(makeRequest());
    // Webhook still succeeds: status update stuck, marker NOT undone (no retry storm).
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(mockTenantUpdate).toHaveBeenCalled();
    expect(mockBatchCommit).toHaveBeenCalled();
    expect(mockDocDelete).not.toHaveBeenCalled();
  });

  it("one user's sweep failure does not block the other linked users", async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }))
      .mockResolvedValueOnce(usersSnapshot(['owner1', 'adminB']));
    // owner1's sweep throws; adminB's must still be attempted.
    mockSweep
      .mockRejectedValueOnce(new Error('owner1 sweep failed'))
      .mockResolvedValueOnce({ total: 1, swept: 1 });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockSweep).toHaveBeenCalledTimes(2);
    expect(mockSweep).toHaveBeenCalledWith(
      expect.objectContaining({ referrerId: 'adminB', connectAccountId: 'acct_123' }),
    );
  });
});

// ── Decoupled tenant vs. affiliate lookups ───────────────────────────────────
// The regression: the tenant lookup early-returned when empty, so a standalone
// affiliate (NO tenant — the whole point of the affiliate track) never had their
// status synced OR their pending commissions swept on activation. These tests
// pin the two lookups as INDEPENDENT: tenant-only, affiliate-only, both, neither.
describe('account.updated decoupled tenant/affiliate lookups', () => {
  it('(a) tenant only, no linked affiliate users: updates tenant status, does NO affiliate work', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot({ stripeConnectAccountId: 'acct_123' }))
      .mockResolvedValueOnce(usersSnapshot([]));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockTenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stripeConnectStatus: 'active' }),
    );
    // No affiliate users → no status batch, no sweep.
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('(b) THE BUG: affiliate users but NO tenant → status synced AND pending commissions swept', async () => {
    // A standalone affiliate has no tenant row. The old early-return here skipped
    // both the status sync and the sweep, stranding them until the daily cron.
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_aff', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot(null)) // no tenant
      .mockResolvedValueOnce(usersSnapshot(['aff1'])); // standalone affiliate
    mockSweep.mockResolvedValue({ total: 1, swept: 1 });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);

    // No tenant doc was written…
    expect(mockTenantUpdate).not.toHaveBeenCalled();
    // …but the affiliate's status IS synced…
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { id: 'aff1' },
      expect.objectContaining({ affiliateConnectStatus: 'active' }),
    );
    expect(mockBatchCommit).toHaveBeenCalled();
    // …and their pending commissions ARE swept to THIS account on activation.
    expect(mockSweep).toHaveBeenCalledTimes(1);
    expect(mockSweep).toHaveBeenCalledWith(
      expect.objectContaining({ referrerId: 'aff1', connectAccountId: 'acct_aff' }),
    );
  });

  it('(c) both tenant and affiliate users: tenant status updated AND affiliate synced + swept', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot({ stripeConnectAccountId: 'acct_123', ownerId: 'owner1' }))
      .mockResolvedValueOnce(usersSnapshot(['owner1']));
    mockSweep.mockResolvedValue({ total: 2, swept: 2 });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockTenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stripeConnectStatus: 'active' }),
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { id: 'owner1' },
      expect.objectContaining({ affiliateConnectStatus: 'active' }),
    );
    expect(mockSweep).toHaveBeenCalledWith(
      expect.objectContaining({ referrerId: 'owner1', connectAccountId: 'acct_123' }),
    );
  });

  it('(d) neither tenant nor affiliate users: logs unknown, 200, writes nothing', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_unknown', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot(null))
      .mockResolvedValueOnce(usersSnapshot([]));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    // A genuinely unknown account touches nothing.
    expect(mockTenantUpdate).not.toHaveBeenCalled();
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('(e) affiliate users, NO tenant, status restricted: status synced but NO sweep', async () => {
    // Standalone affiliate whose account is not yet payout-ready — sync the status
    // so the dashboard reflects it, but move no money.
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_aff',
      charges_enabled: false,
      payouts_enabled: false,
      requirements: { currently_due: ['external_account'] },
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot(null))
      .mockResolvedValueOnce(usersSnapshot(['aff1']));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockTenantUpdate).not.toHaveBeenCalled();
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { id: 'aff1' },
      expect.objectContaining({ affiliateConnectStatus: 'restricted' }),
    );
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('(f) affiliate-only sweep failure still 200s the webhook (status write stuck, no retry storm)', async () => {
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_aff', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot(null))
      .mockResolvedValueOnce(usersSnapshot(['aff1']));
    mockSweep.mockRejectedValue(new Error('Stripe unavailable'));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockBatchCommit).toHaveBeenCalled(); // status sync stuck
    expect(mockDocDelete).not.toHaveBeenCalled(); // marker NOT undone
  });

  it('affiliate-only reconcile (batch) failure bubbles → 500 → marker undone', async () => {
    // The affiliate status write "must stick" even with no tenant present: a real
    // failure bubbles to the catch → 500 → Stripe retries the (idempotent) handler.
    mockConstructEvent.mockReturnValue(makeAccountEvent({
      id: 'acct_aff', charges_enabled: true, payouts_enabled: true,
    }));
    mockCollGet
      .mockResolvedValueOnce(tenantSnapshot(null))
      .mockResolvedValueOnce(usersSnapshot(['aff1']));
    mockBatchCommit.mockRejectedValueOnce(new Error('Firestore unavailable'));

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(mockTenantUpdate).not.toHaveBeenCalled(); // no tenant to write
    expect(mockDocDelete).toHaveBeenCalled(); // marker undone → redelivery re-processes
    expect(mockSweep).not.toHaveBeenCalled(); // never reached the sweep
  });
});

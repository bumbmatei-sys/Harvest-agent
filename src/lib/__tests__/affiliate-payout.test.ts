import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockCommissionsGet, mockBatchUpdate, mockBatchCommit } = vi.hoisted(() => ({
  mockCommissionsGet: vi.fn(),
  mockBatchUpdate: vi.fn(),
  mockBatchCommit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn((name: string) => {
      if (name === 'affiliate_commissions') {
        return { where: vi.fn().mockReturnThis(), get: mockCommissionsGet };
      }
      // users → doc() returns a stable, identifiable ref for batch.update assertions.
      return { doc: vi.fn((id: string) => ({ __userRef: id })) };
    }),
    batch: vi.fn(() => ({ update: mockBatchUpdate, commit: mockBatchCommit })),
  },
}));

// Match webhook.test.ts: FieldValue.increment returns a tagged object we can assert on.
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: vi.fn((n: number) => ({ __increment: n })) },
}));

const { sweepPendingAffiliateCommissions, affiliateSweepIdempotencyKey } = await import('../affiliate-payout');

// ── Helpers ──────────────────────────────────────────────────────────────────
const mockTransfersCreate = vi.fn();
const fakeStripe = () => ({ transfers: { create: mockTransfersCreate } }) as any;

/** A commission doc snapshot: identifiable id, data(), and a ref for batch.update. */
const commDoc = (id: string, data: Record<string, unknown>) => ({
  id,
  data: () => data,
  ref: { __commissionRef: id },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchCommit.mockResolvedValue(undefined);
  mockTransfersCreate.mockResolvedValue({ id: 'tr_default' });
  mockCommissionsGet.mockResolvedValue({ docs: [] });
});

// ── Idempotency key (the money-path invariant) ───────────────────────────────
describe('affiliateSweepIdempotencyKey', () => {
  it('is stable and unique per commission doc id', () => {
    expect(affiliateSweepIdempotencyKey('abc')).toBe('aff_sweep_abc');
    expect(affiliateSweepIdempotencyKey('abc')).toBe(affiliateSweepIdempotencyKey('abc'));
    expect(affiliateSweepIdempotencyKey('abc')).not.toBe(affiliateSweepIdempotencyKey('def'));
  });
});

// ── Core sweep ───────────────────────────────────────────────────────────────
describe('sweepPendingAffiliateCommissions — happy path', () => {
  it('transfers each pending commission, flips it to paid, and decrements pending payouts', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [
        commDoc('c1', { referrerId: 'ref1', status: 'pending', commission: 4580 }),
        commDoc('c2', { referrerId: 'ref1', status: 'pending', commission: 5000 }),
      ],
    });
    mockTransfersCreate
      .mockResolvedValueOnce({ id: 'tr_c1' })
      .mockResolvedValueOnce({ id: 'tr_c2' });

    const res = await sweepPendingAffiliateCommissions({
      stripe: fakeStripe(),
      referrerId: 'ref1',
      connectAccountId: 'acct_ref1',
    });

    expect(res).toEqual({ total: 2, swept: 2 });

    // Two transfers, correct amount/destination, each with the STABLE per-commission key.
    expect(mockTransfersCreate).toHaveBeenCalledTimes(2);
    expect(mockTransfersCreate).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        amount: 4580,
        currency: 'usd',
        destination: 'acct_ref1',
        metadata: expect.objectContaining({ referrerId: 'ref1', commissionId: 'c1', type: 'affiliate_commission_sweep' }),
      }),
      { idempotencyKey: 'aff_sweep_c1' },
    );
    expect(mockTransfersCreate).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ amount: 5000, destination: 'acct_ref1' }),
      { idempotencyKey: 'aff_sweep_c2' },
    );

    // Each commission flipped to paid with its transfer id + paidAt…
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { __commissionRef: 'c1' },
      expect.objectContaining({ status: 'paid', stripeTransferId: 'tr_c1', paidAt: expect.any(String) }),
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { __commissionRef: 'c2' },
      expect.objectContaining({ status: 'paid', stripeTransferId: 'tr_c2', paidAt: expect.any(String) }),
    );
    // …and pending payouts decremented by EXACTLY the commission (in cents).
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { __userRef: 'ref1' },
      expect.objectContaining({ affiliatePendingPayouts: { __increment: -4580 } }),
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { __userRef: 'ref1' },
      expect.objectContaining({ affiliatePendingPayouts: { __increment: -5000 } }),
    );
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
  });

  it('NEVER touches affiliateEarnings (lifetime) — pending→paid is not new earnings', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [commDoc('c1', { referrerId: 'ref1', status: 'pending', commission: 4580 })],
    });
    mockTransfersCreate.mockResolvedValue({ id: 'tr_c1' });

    await sweepPendingAffiliateCommissions({ stripe: fakeStripe(), referrerId: 'ref1', connectAccountId: 'acct_ref1' });

    for (const call of mockBatchUpdate.mock.calls) {
      expect(call[1]).not.toHaveProperty('affiliateEarnings');
    }
  });
});

// ── Skips + guardrails (double-pay / bad-amount lenses) ──────────────────────
describe('sweepPendingAffiliateCommissions — skips and guardrails', () => {
  it('only sweeps pending rows — paid/failed/cancelled are left untouched', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [
        commDoc('paid1', { referrerId: 'ref1', status: 'paid', commission: 5000 }),
        commDoc('failed1', { referrerId: 'ref1', status: 'failed', commission: 5000 }),
        commDoc('cancelled1', { referrerId: 'ref1', status: 'cancelled', commission: 0 }),
        commDoc('c1', { referrerId: 'ref1', status: 'pending', commission: 4580 }),
      ],
    });
    mockTransfersCreate.mockResolvedValue({ id: 'tr_c1' });

    const res = await sweepPendingAffiliateCommissions({ stripe: fakeStripe(), referrerId: 'ref1', connectAccountId: 'acct_ref1' });

    expect(res).toEqual({ total: 1, swept: 1 });
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(mockTransfersCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 4580 }), { idempotencyKey: 'aff_sweep_c1' });
  });

  it('never creates a zero or negative transfer', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [
        commDoc('zero', { referrerId: 'ref1', status: 'pending', commission: 0 }),
        commDoc('neg', { referrerId: 'ref1', status: 'pending', commission: -100 }),
        commDoc('c1', { referrerId: 'ref1', status: 'pending', commission: 4580 }),
      ],
    });
    mockTransfersCreate.mockResolvedValue({ id: 'tr_c1' });

    const res = await sweepPendingAffiliateCommissions({ stripe: fakeStripe(), referrerId: 'ref1', connectAccountId: 'acct_ref1' });

    expect(res).toEqual({ total: 1, swept: 1 });
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(mockTransfersCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 4580 }), expect.anything());
  });

  it('does nothing (no query, no transfer) when connectAccountId is missing', async () => {
    const res = await sweepPendingAffiliateCommissions({ stripe: fakeStripe(), referrerId: 'ref1', connectAccountId: '' });
    expect(res).toEqual({ total: 0, swept: 0 });
    expect(mockCommissionsGet).not.toHaveBeenCalled();
    expect(mockTransfersCreate).not.toHaveBeenCalled();
  });

  it('returns { total: 0, swept: 0 } when the affiliate has no pending commissions', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [commDoc('paid1', { referrerId: 'ref1', status: 'paid', commission: 5000 })],
    });
    const res = await sweepPendingAffiliateCommissions({ stripe: fakeStripe(), referrerId: 'ref1', connectAccountId: 'acct_ref1' });
    expect(res).toEqual({ total: 0, swept: 0 });
    expect(mockTransfersCreate).not.toHaveBeenCalled();
  });
});

// ── Partial failure (one bad transfer must not block the rest) ────────────────
describe('sweepPendingAffiliateCommissions — partial failure isolation', () => {
  it('leaves a failed-transfer commission pending and still sweeps the others', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [
        commDoc('c1', { referrerId: 'ref1', status: 'pending', commission: 4580 }),
        commDoc('c2', { referrerId: 'ref1', status: 'pending', commission: 5000 }),
      ],
    });
    // c1's transfer fails; c2's succeeds.
    mockTransfersCreate
      .mockRejectedValueOnce(new Error('Stripe: account not ready'))
      .mockResolvedValueOnce({ id: 'tr_c2' });

    const res = await sweepPendingAffiliateCommissions({ stripe: fakeStripe(), referrerId: 'ref1', connectAccountId: 'acct_ref1' });

    // Both attempted; only c2 swept.
    expect(res).toEqual({ total: 2, swept: 1 });
    expect(mockTransfersCreate).toHaveBeenCalledTimes(2);

    // c1 was NOT flipped to paid (no batch write against its ref); c2 was.
    const flippedRefs = mockBatchUpdate.mock.calls.map((c) => c[0]);
    expect(flippedRefs).not.toContainEqual({ __commissionRef: 'c1' });
    expect(flippedRefs).toContainEqual({ __commissionRef: 'c2' });
    // Only c2's pending payout was decremented.
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { __userRef: 'ref1' },
      expect.objectContaining({ affiliatePendingPayouts: { __increment: -5000 } }),
    );
  });
});

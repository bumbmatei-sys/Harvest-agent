import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The affiliate sweep's transfer failure is captured at `warning`: the commission
 * row is already durable and every attempt shares `affiliateSweepIdempotencyKey`,
 * so a failure means "not paid yet, will be safely re-attempted" rather than "the
 * ledger may have diverged". The webhook's first-attempt transfer is now `warning`
 * for exactly the same two reasons — it writes the row before paying and keys the
 * transfer through the same function. This suite pins the level and the unchanged
 * partial-failure isolation.
 */

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: mockCaptureException }));

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
      return { doc: vi.fn((id: string) => ({ __userRef: id })) };
    }),
    batch: vi.fn(() => ({ update: mockBatchUpdate, commit: mockBatchCommit })),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: vi.fn((n: number) => ({ __increment: n })) },
}));

const { sweepPendingAffiliateCommissions } = await import('../affiliate-payout');

const mockTransfersCreate = vi.fn();
const fakeStripe = () => ({ transfers: { create: mockTransfersCreate } }) as any;

const commDoc = (id: string, data: Record<string, unknown>) => ({
  id, data: () => data, ref: { __commissionRef: id },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchCommit.mockResolvedValue(undefined);
  mockTransfersCreate.mockResolvedValue({ id: 'tr_default' });
  mockCommissionsGet.mockResolvedValue({ docs: [] });
});

describe('sweepPendingAffiliateCommissions — Sentry capture', () => {
  it('captures a failed sweep transfer at warning level with the commission identifiers', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [commDoc('c1', { referrerId: 'ref1', status: 'pending', commission: 1500 })],
    });
    mockTransfersCreate.mockRejectedValue(new Error('account restricted'));

    await sweepPendingAffiliateCommissions({
      stripe: fakeStripe(), referrerId: 'ref1', connectAccountId: 'acct_1',
    });

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const [error, context] = mockCaptureException.mock.calls[0];
    expect((error as Error).message).toBe('account restricted');
    expect(context.level).toBe('warning');
    expect(context.tags).toEqual(expect.objectContaining({
      money_path: 'true', step: 'affiliate-commission-sweep',
    }));
    expect(context.contexts.money_path).toEqual({
      step: 'affiliate-commission-sweep',
      commissionId: 'c1', referrerId: 'ref1', connectAccountId: 'acct_1',
    });
  });

  it('still isolates the failure: the other commission sweeps and the result is unchanged', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [
        commDoc('c1', { referrerId: 'ref1', status: 'pending', commission: 1500 }),
        commDoc('c2', { referrerId: 'ref1', status: 'pending', commission: 2500 }),
      ],
    });
    mockTransfersCreate
      .mockRejectedValueOnce(new Error('account restricted'))
      .mockResolvedValueOnce({ id: 'tr_2' });

    const result = await sweepPendingAffiliateCommissions({
      stripe: fakeStripe(), referrerId: 'ref1', connectAccountId: 'acct_1',
    });

    expect(result).toEqual({ total: 2, swept: 1 });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('captures nothing when every transfer succeeds', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [commDoc('c1', { referrerId: 'ref1', status: 'pending', commission: 1500 })],
    });

    const result = await sweepPendingAffiliateCommissions({
      stripe: fakeStripe(), referrerId: 'ref1', connectAccountId: 'acct_1',
    });

    expect(result).toEqual({ total: 1, swept: 1 });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});

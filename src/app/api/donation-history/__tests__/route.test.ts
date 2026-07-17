import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockRequireAuth, mockOrderBy, mockLimit, mockGet } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockOrderBy: vi.fn(),
  mockLimit: vi.fn(),
  mockGet: vi.fn(),
}));

// adminDb.collection('tenants').doc(tid).collection('invoices').orderBy().limit().get()
function makeInvoicesCol(): any {
  const col: any = { get: mockGet };
  col.orderBy = (...args: unknown[]) => { mockOrderBy(...args); return col; };
  col.limit = (...args: unknown[]) => { mockLimit(...args); return col; };
  return col;
}
function makeTenantsCol(): any {
  return { doc: vi.fn(() => ({ collection: vi.fn(() => makeInvoicesCol()) })) };
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => makeTenantsCol()) },
}));
vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));

const { GET } = await import('../route');

function makeRequest(tenantId?: string): NextRequest {
  const url = tenantId
    ? `https://grace.theharvest.app/api/donation-history?tenantId=${tenantId}`
    : 'https://grace.theharvest.app/api/donation-history';
  return new NextRequest(url, { method: 'GET' });
}

// Firestore doc-snapshot shim.
const doc = (id: string, data: object) => ({ id, data: () => data });

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ uid: 'user_A', email: 'sam@example.com' });
});

describe('GET /api/donation-history', () => {
  it('401s when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await GET(makeRequest('t1'));
    expect(res.status).toBe(401);
  });

  it('400s when tenantId is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
  });

  it("returns ONLY the caller's own donation receipts — never another member's (the crux)", async () => {
    // A mixed bag in one tenant's invoices collection: the caller's own receipt,
    // another donor's receipt (must be excluded), and a non-donation invoice.
    mockGet.mockResolvedValue({
      docs: [
        doc('mine1', { type: 'donation_receipt', recipientEmail: 'sam@example.com', amount: 5000, currency: 'usd', description: 'Partnership', receiptNumber: 'R-1', tenantName: 'Grace', issuedAt: '2026-02-01T00:00:00.000Z', pdfUrl: 'receipts/t1/donations/R-1.pdf' }),
        doc('other1', { type: 'donation_receipt', recipientEmail: 'attacker@evil.com', amount: 999999, currency: 'usd', description: 'Someone else', receiptNumber: 'R-2', tenantName: 'Grace', issuedAt: '2026-03-01T00:00:00.000Z', pdfUrl: 'receipts/t1/donations/R-2.pdf' }),
        doc('bill1', { type: 'subscription_invoice', recipientEmail: 'sam@example.com', amount: 12000, currency: 'usd', description: 'Plan', issuedAt: '2026-01-01T00:00:00.000Z' }),
      ],
    });

    const res = await GET(makeRequest('t1'));
    expect(res.status).toBe(200);
    const { receipts, totals } = await res.json();

    expect(receipts).toHaveLength(1);
    expect(receipts[0].id).toBe('mine1');
    // Neither the other donor's row nor the non-donation invoice leaks through.
    expect(receipts.find((r: any) => r.id === 'other1')).toBeUndefined();
    expect(receipts.find((r: any) => r.id === 'bill1')).toBeUndefined();
    // No email or storage path on the wire.
    const wire = JSON.stringify({ receipts, totals });
    expect(wire).not.toContain('attacker@evil.com');
    expect(wire).not.toContain('receipts/t1');
    // Totals reflect only the caller's own giving.
    expect(totals.lifetimeCents).toBe(5000);
    expect(totals.count).toBe(1);
  });

  it('matches a MIXED-CASE stored recipientEmail (the case-insensitive contract, both sides)', async () => {
    // Firebase token email is lowercase; the donor typed mixed case at Stripe
    // checkout, so recipientEmail is stored mixed-case. A case-sensitive equality
    // query would miss this; the scan + normalized match finds it.
    mockRequireAuth.mockResolvedValue({ uid: 'user_A', email: 'bob.smith@example.com' });
    mockGet.mockResolvedValue({
      docs: [doc('mine1', { type: 'donation_receipt', recipientEmail: 'Bob.Smith@Example.COM', amount: 2500, currency: 'usd', description: 'Gift', receiptNumber: 'R-9', tenantName: 'Grace', issuedAt: '2026-05-01T00:00:00.000Z', pdfUrl: 'receipts/t1/donations/R-9.pdf' })],
    });

    const res = await GET(makeRequest('t1'));
    const { receipts, totals } = await res.json();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].id).toBe('mine1');
    expect(totals.lifetimeCents).toBe(2500);
    // Newest-first single-field scan of this tenant's invoices.
    expect(mockOrderBy).toHaveBeenCalledWith('issuedAt', 'desc');
  });

  it('sorts newest-first and buckets per-year totals', async () => {
    mockGet.mockResolvedValue({
      docs: [
        doc('a', { type: 'donation_receipt', recipientEmail: 'sam@example.com', amount: 1000, currency: 'usd', description: 'Old', receiptNumber: 'R-a', tenantName: 'Grace', issuedAt: '2024-06-01T00:00:00.000Z', pdfUrl: 'receipts/t1/donations/R-a.pdf' }),
        doc('b', { type: 'donation_receipt', recipientEmail: 'sam@example.com', amount: 3000, currency: 'usd', description: 'New', receiptNumber: 'R-b', tenantName: 'Grace', issuedAt: '2026-06-01T00:00:00.000Z', pdfUrl: 'receipts/t1/donations/R-b.pdf' }),
      ],
    });
    const res = await GET(makeRequest('t1'));
    const { receipts, totals } = await res.json();
    expect(receipts.map((r: any) => r.id)).toEqual(['b', 'a']); // newest first
    expect(totals.lifetimeCents).toBe(4000);
    expect(totals.byYear['2026']).toBe(3000);
    expect(totals.byYear['2024']).toBe(1000);
  });

  it('returns amounts in cents unchanged (client divides by 100) — no cents/dollar confusion', async () => {
    mockGet.mockResolvedValue({
      docs: [doc('mine1', { type: 'donation_receipt', recipientEmail: 'sam@example.com', amount: 105500, currency: 'usd', description: 'Big gift', receiptNumber: 'R-3', tenantName: 'Grace', issuedAt: '2026-04-01T00:00:00.000Z', pdfUrl: 'receipts/t1/donations/R-3.pdf' })],
    });
    const res = await GET(makeRequest('t1'));
    const { receipts, totals } = await res.json();
    // 105500 cents ($1,055.00) stays 105500 — not multiplied or divided by the route.
    expect(receipts[0].amountCents).toBe(105500);
    expect(totals.lifetimeCents).toBe(105500);
  });

  it('returns an empty history for a user with no donations — no error', async () => {
    mockGet.mockResolvedValue({ docs: [] });
    const res = await GET(makeRequest('t1'));
    expect(res.status).toBe(200);
    const { receipts, totals } = await res.json();
    expect(receipts).toEqual([]);
    expect(totals).toEqual({ lifetimeCents: 0, byYear: {}, count: 0 });
  });

  it('returns an empty history (and does not query) when the token carries no email', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'user_A', email: undefined });
    const res = await GET(makeRequest('t1'));
    expect(res.status).toBe(200);
    const { receipts, totals } = await res.json();
    expect(receipts).toEqual([]);
    expect(totals.lifetimeCents).toBe(0);
    // Never issued a query with an empty email (which could match a stored blank).
    expect(mockGet).not.toHaveBeenCalled();
  });
});

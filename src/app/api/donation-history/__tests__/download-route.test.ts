import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockRequireAuth, mockDocGet, mockFile, mockGetSignedUrl, mockBucket } = vi.hoisted(() => {
  const mockGetSignedUrl = vi.fn().mockResolvedValue(['https://signed.example/receipt?token=abc']);
  const mockFile = vi.fn(() => ({ getSignedUrl: mockGetSignedUrl }));
  const mockBucket = vi.fn(() => ({ file: mockFile }));
  return {
    mockRequireAuth: vi.fn(),
    mockDocGet: vi.fn(),
    mockFile,
    mockGetSignedUrl,
    mockBucket,
  };
});

// adminDb.collection('tenants').doc(tid).collection('invoices').doc(invId).get()
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({ get: mockDocGet })),
        })),
      })),
    })),
  },
  getReceiptsBucket: mockBucket,
}));
vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));

const { POST, SIGNED_URL_TTL_MS } = await import('../download/route');

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('https://grace.theharvest.app/api/donation-history/download', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** A stored invoice doc snapshot (exists), or a not-found one. */
const invoice = (data: object | null) =>
  data === null
    ? { exists: false, data: () => undefined }
    : { exists: true, data: () => data };

const OWN = {
  type: 'donation_receipt',
  recipientEmail: 'sam@example.com',
  amount: 5000,
  pdfUrl: 'receipts/t1/donations/R-1.pdf',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ uid: 'user_A', email: 'sam@example.com' });
  mockGetSignedUrl.mockResolvedValue(['https://signed.example/receipt?token=abc']);
});

describe('POST /api/donation-history/download', () => {
  it('401s when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(makeRequest({ tenantId: 't1', invoiceId: 'inv_1' }));
    expect(res.status).toBe(401);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('400s when tenantId or invoiceId is missing', async () => {
    expect((await POST(makeRequest({ invoiceId: 'inv_1' }))).status).toBe(400);
    expect((await POST(makeRequest({ tenantId: 't1' }))).status).toBe(400);
  });

  it("403s when the invoice belongs to another member — and never signs a url (the crux)", async () => {
    // User A asks to download an invoice whose recipientEmail is User B.
    mockDocGet.mockResolvedValue(invoice({
      type: 'donation_receipt',
      recipientEmail: 'victim@example.com',
      pdfUrl: 'receipts/t1/donations/R-victim.pdf',
    }));
    const res = await POST(makeRequest({ tenantId: 't1', invoiceId: 'inv_victim' }));
    expect(res.status).toBe(403);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
    expect(mockFile).not.toHaveBeenCalled();
  });

  it('signs a SHORT-LIVED v4 read url scoped to the ONE invoice the caller owns', async () => {
    mockDocGet.mockResolvedValue(invoice(OWN));
    const before = Date.now();
    const res = await POST(makeRequest({ tenantId: 't1', invoiceId: 'inv_1' }));
    const after = Date.now();
    expect(res.status).toBe(200);
    const { url } = await res.json();
    expect(url).toBe('https://signed.example/receipt?token=abc');

    // Signed exactly one object: the invoice doc's OWN pdfUrl path.
    expect(mockFile).toHaveBeenCalledTimes(1);
    expect(mockFile).toHaveBeenCalledWith('receipts/t1/donations/R-1.pdf');
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);

    const opts = mockGetSignedUrl.mock.calls[0][0];
    expect(opts.version).toBe('v4');
    expect(opts.action).toBe('read');
    // Short-lived: expiry is now + TTL (15 min), not permanent.
    expect(SIGNED_URL_TTL_MS).toBe(15 * 60 * 1000);
    expect(opts.expires).toBeGreaterThanOrEqual(before + SIGNED_URL_TTL_MS);
    expect(opts.expires).toBeLessThanOrEqual(after + SIGNED_URL_TTL_MS);
  });

  it('matches ownership case-insensitively (stored mixed-case email)', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'user_A', email: 'sam@example.com' });
    mockDocGet.mockResolvedValue(invoice({ ...OWN, recipientEmail: 'Sam@Example.COM' }));
    const res = await POST(makeRequest({ tenantId: 't1', invoiceId: 'inv_1' }));
    expect(res.status).toBe(200);
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('404s when the invoice does not exist', async () => {
    mockDocGet.mockResolvedValue(invoice(null));
    const res = await POST(makeRequest({ tenantId: 't1', invoiceId: 'nope' }));
    expect(res.status).toBe(404);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it("404s with the TRANSIENT copy when the caller's own receipt has no PDF yet", async () => {
    mockDocGet.mockResolvedValue(invoice({ ...OWN, pdfUrl: null }));
    const res = await POST(makeRequest({ tenantId: 't1', invoiceId: 'inv_1' }));
    expect(res.status).toBe(404);
    // "not available yet" — distinct from the legacy/malformed copy below.
    expect((await res.json()).error).toBe('Receipt PDF is not available yet');
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('404s with a DISTINCT, honest message for a legacy full-URL pdfUrl (fix-forward, no migration)', async () => {
    // The 7 legacy prod rows stored a full public URL here (pre private-file hardening)
    // instead of a bare `receipts/...` path. The guard correctly refuses to sign it; the
    // member sees an honest "older format, contact the church" message — NOT the transient
    // "not available yet", which would read as "your receipt never existed".
    mockDocGet.mockResolvedValue(invoice({
      ...OWN,
      pdfUrl: 'https://storage.googleapis.com/harvest-receipts-233a1/tenants/bumb/invoices/inv_1.pdf',
    }));
    const res = await POST(makeRequest({ tenantId: 't1', invoiceId: 'inv_1' }));
    expect(res.status).toBe(404);
    const { error } = await res.json();
    expect(error).toContain('older format');
    expect(error).not.toBe('Receipt PDF is not available yet');
    // Never signs a legacy/off-prefix path.
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
    expect(mockFile).not.toHaveBeenCalled();
  });

  it('403s when the doc is not a donation receipt (even with a matching email)', async () => {
    mockDocGet.mockResolvedValue(invoice({
      type: 'subscription_invoice',
      recipientEmail: 'sam@example.com',
      pdfUrl: 'receipts/t1/donations/R-1.pdf',
    }));
    const res = await POST(makeRequest({ tenantId: 't1', invoiceId: 'inv_1' }));
    expect(res.status).toBe(403);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses to sign an off-prefix or traversal path (defense-in-depth)', async () => {
    for (const badPath of ['../../etc/passwd', 'tenants/t1/secret.pdf', 'receipts/t1/../../x.pdf']) {
      vi.clearAllMocks();
      mockRequireAuth.mockResolvedValue({ uid: 'user_A', email: 'sam@example.com' });
      mockDocGet.mockResolvedValue(invoice({ ...OWN, pdfUrl: badPath }));
      const res = await POST(makeRequest({ tenantId: 't1', invoiceId: 'inv_1' }));
      expect(res.status).toBe(404);
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    }
  });

  it('403s when the token carries no email', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'user_A', email: undefined });
    mockDocGet.mockResolvedValue(invoice(OWN));
    const res = await POST(makeRequest({ tenantId: 't1', invoiceId: 'inv_1' }));
    expect(res.status).toBe(403);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });
});

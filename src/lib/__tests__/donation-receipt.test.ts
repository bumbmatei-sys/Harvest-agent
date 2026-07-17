import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockSave, mockFile, mockBucket, mockEmailSend } = vi.hoisted(() => {
  const mockSave = vi.fn().mockResolvedValue(undefined);
  const mockFile = vi.fn(() => ({ save: mockSave }));
  const mockBucket = vi.fn(() => ({ file: mockFile }));
  const mockEmailSend = vi.fn().mockResolvedValue({ data: { id: 'em_1' }, error: null });
  return { mockSave, mockFile, mockBucket, mockEmailSend };
});

vi.mock('@/lib/firebase-admin', () => ({ getReceiptsBucket: mockBucket }));
vi.mock('resend', () => ({ Resend: class { emails = { send: mockEmailSend }; } }));

const { issueDonationReceipt } = await import('../donation-receipt');

/** A fake invoice doc ref with spied get/update, defaulting to a pending invoice. */
function makeInvoiceRef(data: Record<string, unknown> = { status: 'pending' }) {
  return {
    get: vi.fn().mockResolvedValue({ exists: true, data: () => data }),
    update: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function baseInput(over: Record<string, unknown> = {}) {
  return {
    tenantId: 't1',
    recipientName: 'Sam Donor',
    donorEmail: 'sam@example.com',
    amountCents: 5000,
    currency: 'usd',
    receiptNumber: 'R-123-ABC',
    tenantName: 'Grace Church',
    issuedAt: '2026-07-14T00:00:00.000Z',
    description: 'Partnership donation',
    invoiceRef: makeInvoiceRef(),
    ...over,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
  mockEmailSend.mockResolvedValue({ data: { id: 'em_1' }, error: null });
});

describe('issueDonationReceipt', () => {
  it('generates a PDF, stores it to R2, emails the donor, and marks the invoice sent', async () => {
    process.env.RESEND_API_KEY = 'rk_test';
    const input = baseInput();

    await issueDonationReceipt(input);

    // EXACTLY ONE PDF per donation. issueDonationReceipt is the single authoritative
    // generator now that the generateSingleReceipt Cloud Function (which produced a
    // duplicate PDF on the same invoice create) has been retired.
    expect(mockSave).toHaveBeenCalledTimes(1);
    // PDF stored at the donations path, as an application/pdf buffer.
    expect(mockFile).toHaveBeenCalledWith('receipts/t1/donations/R-123-ABC.pdf');
    const [buf, opts] = mockSave.mock.calls[0];
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-'); // it really is a PDF
    expect(opts).toEqual({ metadata: { contentType: 'application/pdf' } });

    // Donor emailed with the PDF attached.
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    const emailArg = mockEmailSend.mock.calls[0][0];
    expect(emailArg.to).toBe('sam@example.com');
    expect(emailArg.from).toBe('Harvest <noreply@theharvest.app>');
    expect(emailArg.subject).toContain('Grace Church');
    expect(emailArg.attachments[0].filename).toBe('donation-receipt-R-123-ABC.pdf');
    expect(typeof emailArg.attachments[0].content).toBe('string'); // base64

    // Invoice completed: pdfUrl set + status 'sent'. Amount stays cents (never restored to invoice).
    expect(input.invoiceRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ pdfUrl: 'receipts/t1/donations/R-123-ABC.pdf', status: 'sent' }),
    );
  });

  it('without RESEND_API_KEY: stores the PDF and marks the invoice stored, no email', async () => {
    delete process.env.RESEND_API_KEY;
    const input = baseInput();

    await issueDonationReceipt(input);

    expect(mockSave).toHaveBeenCalledTimes(1);      // PDF still stored
    expect(mockEmailSend).not.toHaveBeenCalled();   // email skipped gracefully
    expect(input.invoiceRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ pdfUrl: 'receipts/t1/donations/R-123-ABC.pdf', status: 'stored' }),
    );
  });

  it('is idempotent: an already-sent invoice is not regenerated or re-emailed', async () => {
    process.env.RESEND_API_KEY = 'rk_test';
    const input = baseInput({ invoiceRef: makeInvoiceRef({ status: 'sent' }) });

    await issueDonationReceipt(input);

    expect(mockSave).not.toHaveBeenCalled();
    expect(mockEmailSend).not.toHaveBeenCalled();
    expect(input.invoiceRef.update).not.toHaveBeenCalled();
  });

  it('is best-effort: an R2 failure does not throw (webhook stays 200)', async () => {
    process.env.RESEND_API_KEY = 'rk_test';
    mockSave.mockRejectedValueOnce(new Error('R2 down'));
    const input = baseInput();

    await expect(issueDonationReceipt(input)).resolves.toBeUndefined();
    // Storage failed before email/update — invoice left as-is for a later retry, no crash.
    expect(input.invoiceRef.update).not.toHaveBeenCalled();
  });

  it('is best-effort: an email failure still stores the PDF and completes the invoice', async () => {
    process.env.RESEND_API_KEY = 'rk_test';
    mockEmailSend.mockResolvedValueOnce({ data: null, error: { message: 'bad address' } });
    const input = baseInput();

    await issueDonationReceipt(input);

    expect(mockSave).toHaveBeenCalledTimes(1);
    // Email failed → status falls back to 'stored', PDF path still recorded.
    expect(input.invoiceRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'stored' }),
    );
  });
});

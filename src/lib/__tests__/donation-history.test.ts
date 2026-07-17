import { describe, it, expect } from 'vitest';
import {
  normalizeEmail,
  formatCents,
  computeTotals,
  invoiceToRow,
  type DonationReceiptRow,
} from '../donation-history';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Sam@Example.COM ')).toBe('sam@example.com');
  });
  it('returns empty string for null/undefined/empty', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail('')).toBe('');
  });
  it('makes two differently-cased addresses compare equal', () => {
    expect(normalizeEmail('John.Doe@Church.org')).toBe(normalizeEmail('john.doe@church.ORG'));
  });
});

describe('formatCents (cents ÷ 100 — the AdminAccounting bug guard)', () => {
  it('renders cents as dollars', () => {
    expect(formatCents(5000)).toBe('$50.00');
    expect(formatCents(105500)).toBe('$1,055.00'); // NOT $10,550,000
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(1)).toBe('$0.01');
  });
  it('renders non-finite input as $0.00 rather than NaN', () => {
    expect(formatCents(NaN)).toBe('$0.00');
    expect(formatCents(Infinity)).toBe('$0.00');
  });
});

describe('computeTotals', () => {
  const row = (over: Partial<DonationReceiptRow>): DonationReceiptRow => ({
    id: 'i', receiptNumber: 'R', date: null, amountCents: 0, currency: 'usd',
    description: 'Donation', tenantName: 'Grace', hasPdf: false, ...over,
  });

  it('sums lifetime cents and buckets by calendar year', () => {
    const totals = computeTotals([
      row({ amountCents: 5000, date: '2025-03-01T00:00:00.000Z' }),
      row({ amountCents: 2500, date: '2025-11-01T00:00:00.000Z' }),
      row({ amountCents: 10000, date: '2026-01-15T00:00:00.000Z' }),
    ]);
    expect(totals.lifetimeCents).toBe(17500);
    expect(totals.byYear['2025']).toBe(7500);
    expect(totals.byYear['2026']).toBe(10000);
    expect(totals.count).toBe(3);
  });

  it('counts an undated row toward lifetime but not any year', () => {
    const totals = computeTotals([row({ amountCents: 3000, date: null })]);
    expect(totals.lifetimeCents).toBe(3000);
    expect(Object.keys(totals.byYear)).toHaveLength(0);
  });

  it('is empty for no receipts', () => {
    expect(computeTotals([])).toEqual({ lifetimeCents: 0, byYear: {}, count: 0 });
  });
});

describe('invoiceToRow', () => {
  it('maps an invoice to a client-safe row and never leaks email or storage path', () => {
    const row = invoiceToRow('inv_1', {
      type: 'donation_receipt',
      recipientEmail: 'Sam@Example.com',
      recipientName: 'Sam',
      amount: 5000,
      currency: 'usd',
      description: 'Monthly partnership donation',
      receiptNumber: 'R-1-ABC',
      tenantName: 'Grace Church',
      issuedAt: '2026-07-14T00:00:00.000Z',
      pdfUrl: 'receipts/t1/donations/R-1-ABC.pdf',
    });
    expect(row).toEqual({
      id: 'inv_1',
      receiptNumber: 'R-1-ABC',
      date: '2026-07-14T00:00:00.000Z',
      amountCents: 5000,
      currency: 'usd',
      description: 'Monthly partnership donation',
      tenantName: 'Grace Church',
      hasPdf: true,
    });
    // The two secrets must never appear on the wire.
    expect(JSON.stringify(row)).not.toContain('Sam@Example.com');
    expect(JSON.stringify(row)).not.toContain('receipts/t1');
  });

  it('reports hasPdf=false when pdfUrl is missing/null', () => {
    expect(invoiceToRow('i', { type: 'donation_receipt', pdfUrl: null }).hasPdf).toBe(false);
    expect(invoiceToRow('i', { type: 'donation_receipt' }).hasPdf).toBe(false);
  });

  it('defaults amount to 0 cents and coerces bad shapes safely', () => {
    const row = invoiceToRow('i', { type: 'donation_receipt' });
    expect(row.amountCents).toBe(0);
    expect(row.currency).toBe('usd');
    expect(row.description).toBe('Donation');
    expect(row.tenantName).toBe('Harvest');
    expect(row.date).toBeNull();
  });
});

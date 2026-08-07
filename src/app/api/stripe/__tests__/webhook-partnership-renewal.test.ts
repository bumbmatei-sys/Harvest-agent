import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Monthly partnership RENEWALS (invoice.payment_succeeded, billing_reason
 * 'subscription_cycle') must record a real donation, not just an affiliate
 * commission + campaign credit:
 *
 *   • a `donation_receipt` invoice in CENTS  — the annual giving statement (the tax
 *     document carrying the ministry's EIN) sums these, so a $50/mo partner has to
 *     end the year with twelve 5000-cent receipts, not one;
 *   • `totalDonated` incremented in DOLLARS  — the CRM/Profile unit (BUG 2);
 *   • a 'donation' contactActivities timeline entry.
 *
 * The two units are deliberately different in the SAME code path; the $50 → 5000 /
 * 50 assertions below are the point of this file.
 */

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockConstructEvent, mockSubsRetrieve } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockSubsRetrieve: vi.fn(),
}));
const { mockDocGet, mockDocSet, mockDocUpdate, mockDocDelete, mockCollGet, mockAdd, mockIssueReceipt } =
  vi.hoisted(() => ({
    mockDocGet: vi.fn(),
    mockDocSet: vi.fn().mockResolvedValue(undefined),
    mockDocUpdate: vi.fn().mockResolvedValue(undefined),
    mockDocDelete: vi.fn().mockResolvedValue(undefined),
    mockCollGet: vi.fn(),
    mockAdd: vi.fn(),
    mockIssueReceipt: vi.fn().mockResolvedValue(undefined),
  }));

// Path-aware Firestore double: every mock call is tagged with the collection/doc
// path, so assertions read `mockAdd('tenants/t1/invoices', {...})` instead of
// guessing at call ordering.
function makeCollRef(path: string): any {
  const filters: Array<[string, string, unknown]> = [];
  const coll: any = {
    doc: vi.fn((id: string) => makeDocRef(`${path}/${id}`)),
    add: vi.fn((data: any) => mockAdd(path, data)),
    get: vi.fn(() => mockCollGet(path, filters)),
  };
  coll.where = vi.fn((f: string, op: string, v: unknown) => { filters.push([f, op, v]); return coll; });
  coll.limit = vi.fn(() => coll);
  coll.orderBy = vi.fn(() => coll);
  return coll;
}
function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: vi.fn(() => mockDocGet(path)),
    set: vi.fn((d: any) => mockDocSet(path, d)),
    update: vi.fn((d: any) => mockDocUpdate(path, d)),
    delete: vi.fn(() => mockDocDelete(path)),
    collection: vi.fn((sub: string) => makeCollRef(`${path}/${sub}`)),
  };
}

vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mockConstructEvent };
    subscriptions = { retrieve: mockSubsRetrieve, cancel: vi.fn(), update: vi.fn() };
    customers = { retrieve: vi.fn() };
    transfers = { create: vi.fn() };
    charges = { retrieve: vi.fn() };
    refunds = { create: vi.fn() };
  },
}));

// Batched writes replay through the same path-aware doc refs on commit, so a
// batched update is indistinguishable from a direct one in the assertions below —
// and, like a real batch, nothing is applied until commit().
function makeBatch(): any {
  const ops: Array<{ type: 'set' | 'update'; ref: any; data: any }> = [];
  return {
    set: (ref: any, data: any) => { ops.push({ type: 'set', ref, data }); },
    update: (ref: any, data: any) => { ops.push({ type: 'update', ref, data }); },
    commit: async () => {
      for (const op of ops) {
        if (op.type === 'set') await op.ref.set(op.data);
        else await op.ref.update(op.data);
      }
    },
  };
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn((name: string) => makeCollRef(name)), batch: vi.fn(() => makeBatch()) },
  adminAuth: { getUser: vi.fn(), getUserByEmail: vi.fn(), createUser: vi.fn(), createCustomToken: vi.fn() },
  getReceiptsBucket: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TS'), increment: vi.fn((n: number) => ({ __increment: n })) },
  getFirestore: vi.fn(),
}));

vi.mock('@/lib/set-custom-claims', () => ({ setCustomClaims: vi.fn() }));
vi.mock('@/lib/ai-utils', () => ({ generateAccessCode: vi.fn(() => 'CODE-1') }));
vi.mock('@/lib/billing', () => ({ PLAN_PRICES: {}, getPlanFromPriceId: vi.fn() }));
vi.mock('@/lib/donation-receipt', () => ({ issueDonationReceipt: mockIssueReceipt }));
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn() } })) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,x') } }));

const { POST } = await import('../webhook/route');

function makeRequest(): NextRequest {
  return new NextRequest('https://example.com/api/stripe/webhook', {
    method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}',
  });
}

const DONOR_EMAIL = 'partner@example.com';

/** Subscription metadata written by /api/stripe/donate's monthly branch. */
const PARTNERSHIP_META = {
  type: 'partnership', tenantId: 't1', donationType: 'monthly', plan: 'pro',
  campaignId: 'camp1', donorName: 'Pat Partner',
  donorEmail: DONOR_EMAIL, donorUserId: 'u1',
  donationChurchName: 'Grace Chapel',
};

/** A church's OWN plan subscription — no partnership metadata. */
const PLAN_META = { type: 'plan', tenantId: 't1', plan: 'pro', userId: 'owner1' };

function invoiceEvent(over: Record<string, unknown> = {}, id = 'evt_inv_1') {
  return {
    id, type: 'invoice.payment_succeeded',
    data: {
      object: {
        id: 'in_1', subscription: 'sub_partner', amount_paid: 5000, currency: 'usd',
        billing_reason: 'subscription_cycle', ...over,
      },
    },
  };
}

// ── Assertion helpers (path-scoped) ──────────────────────────────────────────
const receiptWrites = () =>
  mockAdd.mock.calls
    .filter(([p, d]) => p === 'tenants/t1/invoices' && (d as any)?.type === 'donation_receipt')
    .map(([, d]) => d as any);
const activityWrites = () =>
  mockAdd.mock.calls.filter(([p]) => p === 'contactActivities').map(([, d]) => d as any);
const totalDonatedUpdates = () =>
  mockDocUpdate.mock.calls.filter(([, d]) => (d as any)?.totalDonated !== undefined).map(([p, d]) => [p, d] as const);
const raisedUpdates = () =>
  mockDocUpdate.mock.calls.filter(([, d]) => (d as any)?.raised !== undefined);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';

  mockAdd.mockResolvedValue({ id: 'inv_new' });
  mockIssueReceipt.mockResolvedValue(undefined);

  mockSubsRetrieve.mockResolvedValue({
    id: 'sub_partner', currency: 'usd', metadata: { ...PARTNERSHIP_META },
    items: { data: [{ price: { unit_amount: 5000 } }] },
  });

  mockDocGet.mockImplementation(async (path: string) => {
    if (path === 'tenants/t1') return { exists: true, data: () => ({ status: 'active', name: 'Grace Chapel' }) };
    if (path === 'users/u1') return { exists: true, data: () => ({ tenantId: 't1', displayName: 'Pat Partner' }) };
    if (path === 'campaigns/camp1') return { exists: true, data: () => ({ tenantId: 't1', goal: 5000 }) };
    return { exists: false, data: () => undefined }; // webhook_events dedup → new event
  });

  // No pre-existing receipts, no pre-existing contacts/commissions.
  mockCollGet.mockResolvedValue({ docs: [], empty: true });
});

describe('webhook — monthly partnership renewal is recorded as a donation', () => {
  it('writes a donation_receipt in CENTS and credits totalDonated in DOLLARS ($50 → 5000 / 50)', async () => {
    mockConstructEvent.mockReturnValue(invoiceEvent());

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // ── The tax line: CENTS. 5000, never 50. ──
    const receipts = receiptWrites();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].amount).toBe(5000);
    expect(receipts[0]).toMatchObject({
      type: 'donation_receipt',
      recipientName: 'Pat Partner',
      recipientEmail: DONOR_EMAIL,
      currency: 'usd',
      description: 'Monthly partnership donation',
      relatedId: 'in_1',            // the INVOICE id — one distinct receipt per month
      tenantName: 'Grace Chapel',
      pdfUrl: null,
      status: 'pending',
    });
    expect(receipts[0].receiptNumber).toMatch(/^R-\d+-[A-Z0-9]{1,6}$/);
    expect(typeof receipts[0].issuedAt).toBe('string');

    // ── The CRM: DOLLARS. 50, never 5000. ──
    const totals = totalDonatedUpdates();
    expect(totals).toHaveLength(1);
    expect(totals[0][0]).toBe('users/u1');
    expect(totals[0][1]).toMatchObject({ totalDonated: { __increment: 50 } });

    // ── The timeline entry, also DOLLARS. ──
    const activities = activityWrites();
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      contactId: 'u1', tenantId: 't1', type: 'donation', amount: 50, createdBy: 'system',
    });

    // ── Existing behaviour preserved: campaign still credited in dollars. ──
    expect(raisedUpdates()).toHaveLength(1);
    expect(raisedUpdates()[0][1]).toMatchObject({ raised: { __increment: 50 } });

    // Thank-you PDF/email gets cents too.
    expect(mockIssueReceipt).toHaveBeenCalledTimes(1);
    expect(mockIssueReceipt.mock.calls[0][0]).toMatchObject({
      tenantId: 't1', donorEmail: DONOR_EMAIL, amountCents: 5000, currency: 'usd',
    });
  });

  it('records a GENERAL partnership renewal (no campaignId) — the common case', async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_partner', currency: 'usd',
      metadata: { ...PARTNERSHIP_META, campaignId: '' },
      items: { data: [{ price: { unit_amount: 5000 } }] },
    });
    mockConstructEvent.mockReturnValue(invoiceEvent());

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    expect(receiptWrites()).toHaveLength(1);
    expect(receiptWrites()[0].amount).toBe(5000);
    expect(totalDonatedUpdates()).toHaveLength(1);
    expect(raisedUpdates()).toHaveLength(0); // no campaign to credit
  });

  it('does NOT double-record the opening month: subscription_create is skipped', async () => {
    // finalizePartnershipSubscription already wrote the first month's receipt + CRM
    // credit from checkout.session.completed — a DIFFERENT event id, so the
    // webhook_events marker cannot dedup across the two.
    mockConstructEvent.mockReturnValue(invoiceEvent({ billing_reason: 'subscription_create' }));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    expect(receiptWrites()).toHaveLength(0);
    expect(totalDonatedUpdates()).toHaveLength(0);
    expect(activityWrites()).toHaveLength(0);
    expect(mockIssueReceipt).not.toHaveBeenCalled();
  });

  it('is idempotent: a retry of the same renewal invoice writes no second receipt and does not double-count', async () => {
    mockConstructEvent.mockReturnValue(invoiceEvent());

    // The `relatedId == in_1` lookup finds the receipt the first delivery wrote.
    mockCollGet.mockImplementation(async (path: string, filters: Array<[string, string, unknown]>) => {
      const onInvoiceId = filters.some(([f, , v]) => f === 'relatedId' && v === 'in_1');
      if (path === 'tenants/t1/invoices' && onInvoiceId) {
        return { docs: [{ id: 'inv_prev', data: () => ({ type: 'donation_receipt', relatedId: 'in_1', amount: 5000 }) }], empty: false };
      }
      return { docs: [], empty: true };
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    expect(receiptWrites()).toHaveLength(0);
    expect(totalDonatedUpdates()).toHaveLength(0);
    expect(activityWrites()).toHaveLength(0);
    expect(mockIssueReceipt).not.toHaveBeenCalled();

    // The gate is scoped to the donation block — the campaign credit is guarded
    // separately by the webhook_events marker and still runs.
    expect(raisedUpdates()).toHaveLength(1);
  });

  it('the idempotency gate ignores non-receipt invoices sharing the relatedId', async () => {
    mockConstructEvent.mockReturnValue(invoiceEvent());
    mockCollGet.mockImplementation(async (path: string) => {
      if (path === 'tenants/t1/invoices') {
        return { docs: [{ id: 'x', data: () => ({ type: 'platform_fee', relatedId: 'in_1' }) }], empty: false };
      }
      return { docs: [], empty: true };
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(receiptWrites()).toHaveLength(1);
    expect(totalDonatedUpdates()).toHaveLength(1);
  });

  it('a church PLAN renewal (non-partnership) writes no donation receipt and no totalDonated', async () => {
    mockSubsRetrieve.mockResolvedValue({ id: 'sub_plan', currency: 'usd', metadata: { ...PLAN_META }, items: { data: [] } });
    mockConstructEvent.mockReturnValue(invoiceEvent({ subscription: 'sub_plan', amount_paid: 9900 }, 'evt_plan_1'));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    expect(receiptWrites()).toHaveLength(0);
    expect(totalDonatedUpdates()).toHaveLength(0);
    expect(activityWrites()).toHaveLength(0);
    expect(raisedUpdates()).toHaveLength(0);
  });

  it('records nothing (but still 200s) when the subscription metadata carries no donorEmail', async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_partner', currency: 'usd',
      metadata: { ...PARTNERSHIP_META, donorEmail: '', donorUserId: '' },
      items: { data: [{ price: { unit_amount: 5000 } }] },
    });
    mockConstructEvent.mockReturnValue(invoiceEvent());

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    expect(receiptWrites()).toHaveLength(0);
    expect(totalDonatedUpdates()).toHaveLength(0);
    expect(raisedUpdates()).toHaveLength(1); // campaign credit unaffected
  });

  it('skips a $0 renewal invoice (100% coupon / proration credit)', async () => {
    mockConstructEvent.mockReturnValue(invoiceEvent({ amount_paid: 0 }));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(receiptWrites()).toHaveLength(0);
    expect(totalDonatedUpdates()).toHaveLength(0);
  });

  it('a $250 renewal writes 25000 cents and increments totalDonated by 250', async () => {
    mockConstructEvent.mockReturnValue(invoiceEvent({ amount_paid: 25000 }));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    expect(receiptWrites()[0].amount).toBe(25000);
    expect(totalDonatedUpdates()[0][1]).toMatchObject({ totalDonated: { __increment: 250 } });
  });

  it('a cross-church donor gets a fresh donor contact credited in DOLLARS, no users-doc stamp', async () => {
    // Donor's own users doc points at another tenant → not a member of t1.
    mockDocGet.mockImplementation(async (path: string) => {
      if (path === 'tenants/t1') return { exists: true, data: () => ({ status: 'active', name: 'Grace Chapel' }) };
      if (path === 'users/u1') return { exists: true, data: () => ({ tenantId: 't2', displayName: 'Pat Partner' }) };
      if (path === 'campaigns/camp1') return { exists: true, data: () => ({ tenantId: 't1' }) };
      return { exists: false, data: () => undefined };
    });
    mockConstructEvent.mockReturnValue(invoiceEvent());

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    expect(receiptWrites()[0].amount).toBe(5000);
    // No FieldValue.increment on the donor's own users doc (cross-tenant).
    expect(totalDonatedUpdates()).toHaveLength(0);
    // A new donor contact in t1, seeded with DOLLARS.
    const contacts = mockAdd.mock.calls.filter(([p]) => p === 'contacts').map(([, d]) => d as any);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ email: DONOR_EMAIL, tenantId: 't1', type: 'donor', totalDonated: 50 });
  });
});

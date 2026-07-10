import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockConstructEvent, mockSubsRetrieve, mockSubsCancel } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockSubsRetrieve: vi.fn(),
  mockSubsCancel: vi.fn().mockResolvedValue(undefined),
}));
const { mockDocGet, mockDocSet, mockDocUpdate, mockDocDelete, mockCollGet, mockAdd } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockDocUpdate: vi.fn().mockResolvedValue(undefined),
  mockDocDelete: vi.fn().mockResolvedValue(undefined),
  mockCollGet: vi.fn().mockResolvedValue({ docs: [] }),
  mockAdd: vi.fn().mockResolvedValue({ id: 'new1' }),
}));

function makeCollRef(): any {
  const coll: any = { doc: vi.fn(() => makeDocRef()), add: mockAdd, get: mockCollGet };
  coll.where = vi.fn(() => coll);
  coll.limit = vi.fn(() => coll);
  coll.orderBy = vi.fn(() => coll);
  return coll;
}
function makeDocRef(): any {
  return {
    get: mockDocGet, set: mockDocSet, update: mockDocUpdate, delete: mockDocDelete,
    collection: vi.fn(() => makeCollRef()),
  };
}

vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mockConstructEvent };
    subscriptions = { retrieve: mockSubsRetrieve, cancel: mockSubsCancel, update: vi.fn() };
    customers = { retrieve: vi.fn() };
    transfers = { create: vi.fn() };
    charges = { retrieve: vi.fn() };
    refunds = { create: vi.fn() };
  },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => makeCollRef()) },
  adminAuth: { getUser: vi.fn(), getUserByEmail: vi.fn(), createUser: vi.fn(), createCustomToken: vi.fn() },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TS'), increment: vi.fn((n: number) => ({ __increment: n })) },
  getFirestore: vi.fn(),
}));

vi.mock('@/lib/set-custom-claims', () => ({ setCustomClaims: vi.fn() }));
vi.mock('@/lib/ai-utils', () => ({ generateAccessCode: vi.fn(() => 'CODE-1') }));
vi.mock('@/lib/stripe-config', () => ({ PLAN_PRICES: {}, getPlanFromPriceId: vi.fn() }));
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn() } })) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,x') } }));

const { POST } = await import('../webhook/route');

function makeRequest(): NextRequest {
  return new NextRequest('https://example.com/api/stripe/webhook', {
    method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}',
  });
}

// Monthly partnership subscription metadata (set by /api/stripe/donate). NOTE `plan`
// is the TENANT'S plan (fee tier) — the webhook must NOT treat it as a plan change.
const PARTNER_SUB_META = {
  type: 'partnership', tenantId: 't1', plan: 'pro', donationType: 'monthly',
  donorUserId: 'donor1', donorEmail: 'donor@grace.org', donorName: 'Dana Donor',
  donationChurchName: 'Grace',
};
function completedSubSession(over: Record<string, unknown> = {}) {
  return {
    id: 'cs_p1', subscription: 'sub_partner', mode: 'subscription',
    amount_total: 5000, customer_details: { email: 'donor@grace.org' },
    metadata: { tenantId: 't1' }, ...over,
  };
}
function subEvent(over: Record<string, unknown> = {}, id = 'evt_p1') {
  return { id, type: 'checkout.session.completed', data: { object: completedSubSession(over) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
  delete process.env.RESEND_API_KEY;
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollGet.mockResolvedValue({ docs: [] });
  mockSubsRetrieve.mockResolvedValue({
    id: 'sub_partner', currency: 'usd', metadata: PARTNER_SUB_META,
    items: { data: [{ price: { unit_amount: 5000 } }] }, // $50/mo
  });
});

describe('webhook — monthly partnership subscription (BUG 3/4)', () => {
  it('writes the partnership pointer (dollars) to the donor users doc — Profile shows active partnership', async () => {
    mockConstructEvent.mockReturnValue(subEvent());
    mockDocGet
      .mockResolvedValueOnce({ exists: false }) // webhook_events dedup → new
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Grace' }) }) // tenant (churchName)
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't1', displayName: 'Dana Donor' }) }); // donor user (member of t1)

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // Partnership pointer on the donor's OWN users doc → cancel-partnership can find
    // the subscription. donationAmount is DOLLARS (50, NOT 5000 cents).
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        donationSubscriptionId: 'sub_partner',
        donationAmount: 50,
        donationChurchName: 'Grace',
        donationChurchId: 't1',
      }),
    );
  });

  it('NEVER mistakes a monthly donation for a plan change (does not cancel the tenant plan sub)', async () => {
    mockConstructEvent.mockReturnValue(subEvent());
    mockDocGet
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Grace' }) }) // tenant
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't1' }) }); // donor user

    await POST(makeRequest());

    // The plan-change path would cancel/replace the tenant's real subscription —
    // intercepting partnership BEFORE it must prevent that entirely.
    expect(mockSubsCancel).not.toHaveBeenCalled();
    expect(mockDocUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ stripeSubscriptionId: 'sub_partner' }),
    );
  });

  it('runs CRM donor-linkage for the first payment (member stamp + donation activity, dollars)', async () => {
    mockConstructEvent.mockReturnValue(subEvent({}, 'evt_p2'));
    mockDocGet
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Grace' }) }) // tenant
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't1', displayName: 'Dana Donor' }) }); // donor user

    await POST(makeRequest());

    // users doc stamped with totalDonated in DOLLARS…
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ totalDonated: { __increment: 50 } }),
    );
    // …and a tenant-scoped 'donation' timeline activity, in dollars.
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'donation', amount: 50, tenantId: 't1', contactId: 'donor1' }),
    );
  });

  it('prefers the subscription price over amount_total for the monthly amount', async () => {
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_partner', currency: 'usd', metadata: PARTNER_SUB_META,
      items: { data: [{ price: { unit_amount: 2500 } }] }, // $25/mo, authoritative
    });
    mockConstructEvent.mockReturnValue(subEvent({ amount_total: 9999 }, 'evt_p3'));
    mockDocGet
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Grace' }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't1' }) });

    await POST(makeRequest());
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ donationSubscriptionId: 'sub_partner', donationAmount: 25 }),
    );
  });

  it('is idempotent on redelivery (dedup — no double write)', async () => {
    mockConstructEvent.mockReturnValue(subEvent());
    mockDocGet.mockResolvedValueOnce({ exists: true }); // already processed

    const res = await POST(makeRequest());
    expect((await res.json()).duplicate).toBe(true);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });
});

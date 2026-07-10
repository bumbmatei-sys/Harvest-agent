import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockConstructEvent } = vi.hoisted(() => ({ mockConstructEvent: vi.fn() }));
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
    subscriptions = { retrieve: vi.fn(), cancel: vi.fn(), update: vi.fn() };
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
function donationEvent(meta: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    id: 'evt_don_1', type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_1', amount_received: 5000, currency: 'usd', metadata: meta, ...over } },
  };
}
// A CRM contact doc with a spied .ref.update so we can assert the upgrade.
function contactDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data, ref: { update: vi.fn().mockResolvedValue(undefined) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
  delete process.env.RESEND_API_KEY;
  mockDocGet.mockResolvedValue({ exists: false }); // default: new event / missing doc
  mockCollGet.mockResolvedValue({ docs: [] });
});

describe('webhook payment_intent.succeeded — donation CRM linkage (ISSUE 5)', () => {
  it('links via metadata.donorEmail even when receipt_email is null', async () => {
    // Logged-in member of THIS tenant, no existing manual contact.
    mockConstructEvent.mockReturnValue(donationEvent(
      { type: 'partnership', tenantId: 't1', donorUserId: 'member1', donorEmail: 'member@grace.org', donorName: 'Sam Member' },
      { receipt_email: null },
    ));
    mockDocGet
      .mockResolvedValueOnce({ exists: false }) // webhook_events dedup → new
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't1', displayName: 'Sam Member' }) }) // donor user doc
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Grace' }) }); // tenant (for receipt)

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // Member of this tenant with no manual contact → stamp the users doc so the CRM
    // synthetic row + profile show donor status. No duplicate donor contact created.
    // totalDonated is stored in DOLLARS (BUG 2): $50 gift (5000 cents) → increment 50.
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ totalDonated: { __increment: 50 } }),
    );
    const madeDonorContact = mockAdd.mock.calls.some(([arg]) => (arg as any)?.type === 'donor');
    expect(madeDonorContact).toBe(false);
    // CRM timeline activity carries tenantId (else useContactActivities filters it out)
    // and attaches to the synthetic contact id (= the member's uid). Amount in DOLLARS.
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'member1', tenantId: 't1', type: 'donation', amount: 50 }),
    );
  });

  it('upgrades an existing contact matched by userId: member → both', async () => {
    const existing = contactDoc('c1', { tenantId: 't1', type: 'member', userId: 'member1', email: 'member@grace.org' });
    mockConstructEvent.mockReturnValue(donationEvent(
      { type: 'partnership', tenantId: 't1', donorUserId: 'member1', donorEmail: 'member@grace.org' },
    ));
    mockDocGet
      .mockResolvedValueOnce({ exists: false }) // dedup
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't1' }) }) // donor user
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Grace' }) }); // tenant
    mockCollGet.mockResolvedValueOnce({ docs: [existing] }); // contacts.where(userId==) hit

    await POST(makeRequest());
    // totalDonated increment is DOLLARS (BUG 2): 5000 cents → 50.
    expect(existing.ref.update).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'both', totalDonated: { __increment: 50 } }),
    );
  });

  it('falls back to email match and backfills the userId link', async () => {
    const existing = contactDoc('c2', { tenantId: 't1', type: 'member', email: 'member@grace.org', userId: '' });
    mockConstructEvent.mockReturnValue(donationEvent(
      { type: 'partnership', tenantId: 't1', donorUserId: 'member1', donorEmail: 'member@grace.org' },
    ));
    mockDocGet
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't1' }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Grace' }) });
    mockCollGet
      .mockResolvedValueOnce({ docs: [] })          // by userId → miss
      .mockResolvedValueOnce({ docs: [existing] }); // by email → hit

    await POST(makeRequest());
    expect(existing.ref.update).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'both', userId: 'member1' }),
    );
  });

  it('does NOT stamp the users doc for a cross-tenant donor (creates a recipient-tenant donor contact)', async () => {
    mockConstructEvent.mockReturnValue(donationEvent(
      { type: 'partnership', tenantId: 't1', donorUserId: 'member2', donorEmail: 'x@y.co', donorName: 'Cross Giver' },
    ));
    mockDocGet
      .mockResolvedValueOnce({ exists: false }) // dedup
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't2' }) }) // donor belongs to a DIFFERENT tenant
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Grace' }) }); // recipient tenant
    // no existing contact in recipient tenant
    mockCollGet.mockResolvedValue({ docs: [] });

    await POST(makeRequest());
    // Donation lands in the RECIPIENT tenant CRM as a donor contact, uid recorded,
    // totalDonated in DOLLARS (5000 cents → 50)…
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'donor', tenantId: 't1', userId: 'member2', email: 'x@y.co', totalDonated: 50 }),
    );
    // …and the donor's own (t2) users doc is never stamped — no cross-tenant CRM leak.
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  it('skips redelivered events (idempotency — no double count)', async () => {
    mockConstructEvent.mockReturnValue(donationEvent(
      { type: 'partnership', tenantId: 't1', donorUserId: 'member1', donorEmail: 'member@grace.org' },
    ));
    mockDocGet.mockResolvedValueOnce({ exists: true }); // already processed

    const res = await POST(makeRequest());
    expect((await res.json()).duplicate).toBe(true);
    expect(mockDocUpdate).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

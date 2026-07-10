import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// PLATFORM_TENANT_ID is read at module load — pin it before importing the route.
process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID = 'harvest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockVerifyAuth } = vi.hoisted(() => ({ mockVerifyAuth: vi.fn() }));
const { mockSessionsCreate } = vi.hoisted(() => ({
  mockSessionsCreate: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe/x' }),
}));
const { mockTenantGet } = vi.hoisted(() => ({ mockTenantGet: vi.fn() }));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockSessionsCreate } };
  },
}));

vi.mock('@/lib/api-auth', () => ({ verifyAuth: mockVerifyAuth }));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: mockTenantGet })) })) },
}));

vi.mock('@/lib/stripe-config', () => ({
  PLATFORM_FEE_MAP: { plus: 0, pro: 0.1, max: 0.15, ultra: 0.2 },
}));

const { POST } = await import('../donate/route');

function makeRequest(body: object, authed = false): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authed) headers['authorization'] = 'Bearer tok';
  return new NextRequest('https://example.com/api/stripe/donate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const lastSessionArgs = () => mockSessionsCreate.mock.calls[0][0] as any;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'theharvest.app';
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';
  mockVerifyAuth.mockResolvedValue(null); // anonymous by default
  mockTenantGet.mockResolvedValue({ exists: true, data: () => ({ stripeConnectAccountId: 'acct_T', plan: 'pro' }) });
  mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe/x' });
});

describe('POST /api/stripe/donate — return URL (ISSUE 4)', () => {
  it('returns the donor to the TENANT subdomain, not the apex', async () => {
    const res = await POST(makeRequest({ amount: 5000, tenantId: 'bumb', donationType: 'one-time', donorEmail: 'd@x.co' }));
    expect(res.status).toBe(200);
    const args = lastSessionArgs();
    expect(args.success_url).toBe('https://bumb.theharvest.app/?donation=success');
    expect(args.cancel_url).toBe('https://bumb.theharvest.app/?donation=cancel');
  });

  it('keeps platform/apex donations on the apex', async () => {
    await POST(makeRequest({ amount: 5000, tenantId: 'harvest', donationType: 'one-time', donorEmail: 'd@x.co' }));
    const args = lastSessionArgs();
    expect(args.success_url).toBe('https://theharvest.app/?donation=success');
  });

  it('applies the same subdomain redirect to monthly donations', async () => {
    await POST(makeRequest({ amount: 5000, tenantId: 'bumb', donationType: 'monthly', donorEmail: 'd@x.co' }));
    const args = lastSessionArgs();
    expect(args.success_url).toBe('https://bumb.theharvest.app/?donation=success');
  });
});

describe('POST /api/stripe/donate — donor identity for CRM linkage (ISSUE 5)', () => {
  it('passes a logged-in donor’s email + uid into the payment intent metadata', async () => {
    mockVerifyAuth.mockResolvedValue({ uid: 'member1', email: 'member@grace.org' });
    await POST(makeRequest({ amount: 5000, tenantId: 'bumb', donationType: 'one-time' }, true));
    const args = lastSessionArgs();
    expect(args.payment_intent_data.metadata).toMatchObject({
      type: 'partnership',
      tenantId: 'bumb',
      donorEmail: 'member@grace.org',
      donorUserId: 'member1',
    });
    expect(args.customer_email).toBe('member@grace.org');
  });

  it('falls back to the body donorEmail for an anonymous donor (no uid)', async () => {
    await POST(makeRequest({ amount: 5000, tenantId: 'bumb', donationType: 'one-time', donorEmail: 'anon@x.co' }));
    const args = lastSessionArgs();
    expect(args.payment_intent_data.metadata.donorEmail).toBe('anon@x.co');
    expect(args.payment_intent_data.metadata.donorUserId).toBe('');
  });

  it('carries donor identity on the subscription metadata for monthly gifts', async () => {
    mockVerifyAuth.mockResolvedValue({ uid: 'member1', email: 'member@grace.org' });
    await POST(makeRequest({ amount: 5000, tenantId: 'bumb', donationType: 'monthly' }, true));
    const args = lastSessionArgs();
    expect(args.subscription_data.metadata).toMatchObject({
      donorEmail: 'member@grace.org',
      donorUserId: 'member1',
    });
  });
});

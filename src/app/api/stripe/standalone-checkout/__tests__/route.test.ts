import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The standalone-checkout route sold the AI (Telegram) Assistant add-on to
// marketing-site visitors. The add-on is retired, so the route must refuse to
// create any checkout session. AI_TELEGRAM_ASSISTANT_ENABLED is the real (false)
// constant here — that's exactly the state under test.

const { mockSessionsCreate, mockCustomersCreate, mockCustomersList } = vi.hoisted(() => ({
  mockSessionsCreate: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe/x' }),
  mockCustomersCreate: vi.fn().mockResolvedValue({ id: 'cus_created' }),
  mockCustomersList: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockSessionsCreate } };
    customers = { create: mockCustomersCreate, list: mockCustomersList };
  },
}));

vi.mock('@/lib/stripe-config', () => ({ AI_ASSISTANT_MONTHLY: 'price_ai_m' }));

const { POST } = await import('../route');

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/stripe/standalone-checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://theharvest.site' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';
});

describe('POST /api/stripe/standalone-checkout — retired add-on', () => {
  it('returns 410 "no longer available" and never creates a Stripe session', async () => {
    const res = await POST(makeRequest({ email: 'buyer@example.com' }));
    expect(res.status).toBe(410);

    const body = await res.json();
    expect(body.error).toMatch(/no longer available/i);

    // No customer lookup/creation and no checkout session for the retired add-on.
    expect(mockSessionsCreate).not.toHaveBeenCalled();
    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(mockCustomersList).not.toHaveBeenCalled();
  });

  it('keeps the CORS header on the disabled response (marketing-site origin)', async () => {
    const res = await POST(makeRequest({ email: 'buyer@example.com' }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://theharvest.site');
  });
});

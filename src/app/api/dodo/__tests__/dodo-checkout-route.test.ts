import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * REP-4 PR 2, test 5: `referrerId` survives into Dodo's subscription metadata.
 *
 * ⚠️ The affiliate PROGRAMME is hidden (`AFFILIATE_PROGRAM_ENABLED === false`)
 * but CAPTURE IS DELIBERATELY STILL LIVE: every `?ref=` link already shared has
 * to keep attributing. Subscription metadata is the ONLY place either webhook
 * can read a referrer from, and nothing retries a checkout that was already
 * created — so a signup that checks out without this stamp is unattributable
 * forever. Moving processors is exactly when that would break silently.
 */

process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_' + Buffer.from('checkout-secret').toString('base64');
process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';

const { mockCreatePlanCheckout, mockRequireAuth, mockCollGet } = vi.hoisted(() => ({
  mockCreatePlanCheckout: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockCollGet: vi.fn(),
}));

// The route refuses with 503 while `DODO_BILLING_ENABLED` is false, which is how
// it is shipped. Everything in this file is about what the route DOES when it is
// serving, so the flag is stubbed on here rather than pinned to whatever the
// shipped value happens to be — otherwise the whole file would silently reduce
// to "it 503s" the moment the cutover is switched off, and the behaviour it
// guards would go untested exactly while it is waiting to be turned on.
// `dodo-billing-flag.test.ts` owns the shipped position of the switch.
vi.mock('@/utils/plan-features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/plan-features')>()),
  DODO_BILLING_ENABLED: true,
}));

vi.mock('@/lib/dodo/dodo-provider', () => ({
  dodoBillingProvider: { id: 'dodo', createPlanCheckout: mockCreatePlanCheckout },
}));
vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: mockCollGet,
    })),
  },
  adminAuth: {},
}));

let POST: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/dodo/checkout/route'));
});

function request(body: Record<string, unknown>) {
  return new NextRequest('https://theharvest.app/api/dodo/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://theharvest.app' },
    body: JSON.stringify(body),
  });
}

const SIGNUP = { plan: 'max', billing: 'monthly', ministryName: 'Grace Community Church' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({
    uid: 'uid_owner_1',
    email: 'pastor@grace.example',
    tenantId: null,
    isSuperAdmin: false,
    isAdmin: false,
  });
  mockCollGet.mockResolvedValue({ empty: true, docs: [] });
  mockCreatePlanCheckout.mockResolvedValue({
    url: 'https://test.checkout.dodopayments.com/session/cks_1',
    reference: 'cks_1',
  });
});

const metadataOf = () => mockCreatePlanCheckout.mock.calls[0][0].metadata;

// ── Test 5 ───────────────────────────────────────────────────────────────────

describe('referrerId survives into Dodo subscription metadata', () => {
  it('stamps a full uid straight through', async () => {
    const res = await POST(request({ ...SIGNUP, referrerId: 'uid_affiliate_abcdefghijklmnop' }));

    expect(res.status).toBe(200);
    expect(metadataOf()).toMatchObject({ referrerId: 'uid_affiliate_abcdefghijklmnop' });
  });

  it('RESOLVES a short affiliate code to the affiliate uid before stamping', async () => {
    // The webhook treats `referrerId` as a user id. Forwarding the raw code
    // credits nobody, silently and permanently.
    mockCollGet.mockResolvedValue({ empty: false, docs: [{ id: 'uid_affiliate_9' }] });

    await POST(request({ ...SIGNUP, referrerId: 'GRACE10' }));

    expect(metadataOf().referrerId).toBe('uid_affiliate_9');
  });

  it('omits referrerId entirely when there is no referral', async () => {
    // An empty string in metadata would look like an attributed signup whose
    // referrer is nobody. Absent is the honest representation.
    await POST(request(SIGNUP));
    expect(metadataOf()).not.toHaveProperty('referrerId');
  });

  it('still forwards a code that resolves to nobody, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCollGet.mockResolvedValue({ empty: true, docs: [] });

    await POST(request({ ...SIGNUP, referrerId: 'NOSUCH' }));

    expect(metadataOf().referrerId).toBe('NOSUCH');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NOSUCH'));
    warn.mockRestore();
  });

  it('carries everything else provisioning needs, since there is no tenant yet', async () => {
    await POST(request({ ...SIGNUP, referrerId: 'uid_affiliate_abcdefghijklmnop' }));

    expect(metadataOf()).toEqual({
      plan: 'max',
      billing: 'monthly',
      ministryName: 'Grace Community Church',
      userId: 'uid_owner_1',
      // The discriminator the provisioner keys on — the same one the Stripe
      // handler uses. Without it, a paid signup provisions nothing.
      newTenant: 'true',
      referrerId: 'uid_affiliate_abcdefghijklmnop',
    });
  });
});

describe('the checkout it asks Dodo for', () => {
  it('sends the plan and period, and lets the PRODUCT own the trial length', async () => {
    await POST(request({ plan: 'pro', billing: 'yearly', ministryName: 'X' }));

    const arg = mockCreatePlanCheckout.mock.calls[0][0];
    expect(arg.plan).toBe('pro');
    expect(arg.period).toBe('yearly');
    // Omitted, not undefined: the catalogue's configured trial applies, and the
    // trial length is deliberately not restated at the call site.
    expect('trialDays' in arg).toBe(false);
  });

  it('returns the customer to the SAME origin they signed up on', async () => {
    // Firebase auth is per-origin. Sending them to the canonical host instead
    // would drop the session they need to finish setup.
    await POST(request(SIGNUP));

    const arg = mockCreatePlanCheckout.mock.calls[0][0];
    expect(arg.returnUrl).toBe('https://theharvest.app/?dodo=success');
    expect(arg.cancelUrl).toBe('https://theharvest.app/?dodo=cancel');
  });

  it('rejects a plan or period it does not sell, before calling Dodo', async () => {
    for (const body of [
      { plan: 'ultra', billing: 'monthly' },
      { plan: 'max', billing: 'weekly' },
      { plan: 'max' },
      {},
    ]) {
      const res = await POST(request(body));
      expect(res.status).toBe(400);
    }
    expect(mockCreatePlanCheckout).not.toHaveBeenCalled();
  });

  it('refuses a request carrying a tenantId — that is the Stripe plan-change path', async () => {
    // Falling through would create a SECOND subscription on a second processor
    // for a church that already has one.
    const res = await POST(request({ ...SIGNUP, tenantId: 'grace' }));

    expect(res.status).toBe(400);
    expect(mockCreatePlanCheckout).not.toHaveBeenCalled();
  });

  it('refuses a user who already belongs to an organization', async () => {
    mockRequireAuth.mockResolvedValue({
      uid: 'uid_member', email: 'm@x.example', tenantId: 'other-church', isSuperAdmin: false,
    });

    const res = await POST(request(SIGNUP));

    expect(res.status).toBe(400);
    expect(mockCreatePlanCheckout).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    mockRequireAuth.mockResolvedValue(new Response('nope', { status: 401 }));

    const res = await POST(request(SIGNUP));

    expect(res.status).toBe(401);
    expect(mockCreatePlanCheckout).not.toHaveBeenCalled();
  });

  it('500s when Dodo will not create a session — the top of the money path', async () => {
    mockCreatePlanCheckout.mockRejectedValue(new Error('dodo unavailable'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(request(SIGNUP));

    expect(res.status).toBe(500);
    err.mockRestore();
  });
});

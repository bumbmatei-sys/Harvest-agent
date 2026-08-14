import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-144 — a donation must settle as the CHURCH, not as Harvest.
 *
 * Both donate branches create destination charges into the church's connected
 * account. Neither set `on_behalf_of`, and Stripe is explicit about what that
 * means: "If `on_behalf_of` is omitted, the platform is the business of record
 * for the payment." So every donation to every church settled with Harvest as
 * the business of record — settling in the PLATFORM's country and currency (a
 * verified sandbox gift charged usd and settled RON) and printing the PLATFORM's
 * statement descriptor on the donor's card.
 *
 * 🔴 WHAT THIS SUITE DOES NOT CLAIM. `on_behalf_of` does not move dispute or
 * refund liability. Stripe, verbatim: "For destination charges, with or without
 * `on_behalf_of`, Stripe debits dispute amounts and fees from your platform
 * account." Nothing below asserts otherwise, and nothing should be added that
 * does — that is the direct- vs destination-charge question, which is separate.
 *
 * ─── What is real here and what is faked ────────────────────────────────────
 *
 * Mocked: the Stripe client, Firebase, `verifyAuth` (which is Firebase token
 * verification), and `@sentry/nextjs`.
 *
 * NOT mocked, deliberately:
 *   - `@/lib/stripe-connect` — the REAL `PLATFORM_FEE_MAP`. The no-regression
 *     test below is worthless against a fabricated fee table; it has to pin the
 *     rate a donor is actually charged.
 *   - `@/lib/tenant-lifecycle` — the REAL giving gate and status resolution, so
 *     these donations get through the same door a live one does.
 *   - `@/lib/money-path-sentry` — so the tag/context shape that actually reaches
 *     Sentry is what gets asserted, not a stand-in. (Same approach as
 *     webhook-sentry-capture.test.ts.)
 *
 * Targets are named by LABEL, never by value pattern. A regex for `acct_` would
 * match `transfer_data.destination` just as happily as `on_behalf_of` — and
 * those two being equal is the entire point, so a pattern match cannot tell a
 * passing implementation from a broken one.
 */

// PLATFORM_TENANT_ID is read at module load — pin it before importing the route.
process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID = 'harvest';

// ── The two accounts, named so assertions read as claims ─────────────────────
/** The church's own Stripe Connect account — who the gift should settle as. */
const CHURCH_ACCOUNT = 'acct_church_grace';
/** A church on a live subdomain. */
const CHURCH_TENANT = 'bumb';
/** The platform/apex "tenant" — not a real subdomain. */
const PLATFORM_TENANT = 'harvest';
/** $50.00, in MINOR UNITS. The route takes cents; the receipt renders dollars. */
const GIFT_CENTS = 5000;

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: mockCaptureException }));

const { mockVerifyAuth } = vi.hoisted(() => ({ mockVerifyAuth: vi.fn() }));
const { mockSessionsCreate } = vi.hoisted(() => ({ mockSessionsCreate: vi.fn() }));
const { docs } = vi.hoisted(() => ({
  docs: { tenants: new Map<string, any>(), tenant_private: new Map<string, any>() } as Record<string, Map<string, any>>,
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockSessionsCreate } };
  },
}));

vi.mock('@/lib/api-auth', () => ({ verifyAuth: mockVerifyAuth }));

// Dispatches on COLLECTION, so `tenants/{id}` and `tenant_private/{id}` are
// genuinely separate documents. The route reads the Connect account id off the
// private doc and the Connect STATUS off the public one — a shared stub would
// let a route that read the wrong doc pass.
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = docs[name]?.get(id);
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  },
}));

const { POST } = await import('../donate/route');

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/stripe/donate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const lastSessionArgs = () => mockSessionsCreate.mock.calls[0][0] as any;

/**
 * Seed a church. `connectStatus` is what the Connect `account.updated` webhook
 * mirrored onto the public tenant doc; the account id lives on the private doc.
 */
function seedChurch(opts: { tenantId?: string; plan?: string; connectStatus?: string | undefined } = {}) {
  const { tenantId = CHURCH_TENANT, plan = 'pro' } = opts;
  // `in`, not a default parameter: a church whose tenant doc carries NO
  // stripeConnectStatus at all is a case under test, and `connectStatus =
  // 'active'` would silently turn that caller into the healthy path.
  const connectStatus = 'connectStatus' in opts ? opts.connectStatus : 'active';
  docs.tenants.set(tenantId, {
    name: 'Grace Community Church',
    plan,
    status: 'active',
    ...(connectStatus === undefined ? {} : { stripeConnectStatus: connectStatus }),
  });
  docs.tenant_private.set(tenantId, { stripeConnectAccountId: CHURCH_ACCOUNT });
}

/** Every money-path capture Sentry actually received. */
const moneyPathCaptures = () =>
  mockCaptureException.mock.calls.filter(([, ctx]: any[]) => ctx?.tags?.money_path === 'true');

beforeEach(() => {
  vi.clearAllMocks();
  docs.tenants.clear();
  docs.tenant_private.clear();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'theharvest.app';
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';
  mockVerifyAuth.mockResolvedValue(null); // anonymous donor by default
  mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe/x' });
  seedChurch();
});

describe('POST /api/stripe/donate — the business of record (THE-144)', () => {
  it('a one-time donation names the church as the business of record', async () => {
    const res = await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    expect(res.status).toBe(200);

    const paymentIntent = lastSessionArgs().payment_intent_data;
    // The church is the SETTLEMENT MERCHANT: its country, its settlement
    // currency, its statement descriptor on the donor's card.
    expect(paymentIntent.on_behalf_of).toBe(CHURCH_ACCOUNT);
    // ...and it is still a DESTINATION charge, which is what `on_behalf_of`
    // qualifies rather than replaces. Losing either one is a different bug.
    expect(paymentIntent.transfer_data.destination).toBe(CHURCH_ACCOUNT);
  });

  it('a monthly donation names the church as the business of record', async () => {
    const res = await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly' }));
    expect(res.status).toBe(200);

    // A monthly partner's card is charged every month forever — an unfamiliar
    // name on a recurring line is worse than on a one-off, not better.
    const subscription = lastSessionArgs().subscription_data;
    expect(subscription.on_behalf_of).toBe(CHURCH_ACCOUNT);
    expect(subscription.transfer_data.destination).toBe(CHURCH_ACCOUNT);
  });

  it('the platform fee is still zero on both paths', async () => {
    // 🔴 THE NO-REGRESSION TEST. PLATFORM_FEE_MAP is the REAL one — every tier is
    // 0, and `on_behalf_of` must not have disturbed that on any of them. It picks
    // the settlement merchant; it is not a fee parameter.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      mockSessionsCreate.mockClear();
      seedChurch({ plan });
      await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
      expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(0);

      mockSessionsCreate.mockClear();
      await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly' }));
      expect(lastSessionArgs().subscription_data.application_fee_percent).toBe(0);
    }

    // And zero is a RATE, not a rounding artifact: at any of the old rates a
    // $10,000 gift would carry a four-figure fee that Math.round cannot hide.
    mockSessionsCreate.mockClear();
    seedChurch({ plan: 'max' });
    await POST(makeRequest({ amount: 1_000_000, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(0);
  });

  it('the one-time path still uses a fixed fee and the monthly path a percent', async () => {
    // The two branches take DIFFERENT fee mechanisms deliberately:
    // `application_fee_amount` is only valid on one-time PaymentIntents, and
    // Checkout subscriptions take `application_fee_percent`. Unifying them
    // breaks the monthly branch outright, so pin that they stay distinct.
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    const paymentIntent = lastSessionArgs().payment_intent_data;
    expect(paymentIntent).toHaveProperty('application_fee_amount');
    expect(paymentIntent).not.toHaveProperty('application_fee_percent');

    mockSessionsCreate.mockClear();
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly' }));
    const subscription = lastSessionArgs().subscription_data;
    expect(subscription).toHaveProperty('application_fee_percent');
    expect(subscription).not.toHaveProperty('application_fee_amount');
  });

  it('an account without the payments capability is handled as decided, and visibly', async () => {
    // Stripe supports `on_behalf_of` "only for connected accounts with a payments
    // capability such as card_payments". The capability is not stored anywhere,
    // and this route will not spend a Stripe call per donation to ask — so it
    // relies on the mirrored `stripeConnectStatus`, which is 'active' exactly
    // when Stripe reports charges_enabled && payouts_enabled.
    //
    // DECIDED: fall back to omitting `on_behalf_of` rather than refusing. Refusing
    // would take a working donate page away from every church that is merely
    // mid-onboarding, because the mirrored status cannot tell "capability lapsed"
    // from "payouts not enabled yet".
    //
    // 🔴 AND THE FALLBACK IS NEVER SILENT — a church quietly reverting to settling
    // as Harvest is the exact defect this ticket exists to fix.
    for (const connectStatus of ['pending', 'restricted', undefined]) {
      mockSessionsCreate.mockClear();
      mockCaptureException.mockClear();
      seedChurch({ connectStatus });

      // Handled as decided: the donation still WORKS...
      const res = await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ url: 'https://checkout.stripe/x' });

      // ...settling as Harvest, exactly as it does today — the church still
      // receives the whole gift via the unchanged destination transfer.
      const paymentIntent = lastSessionArgs().payment_intent_data;
      expect(paymentIntent.on_behalf_of).toBeUndefined();
      expect(paymentIntent.transfer_data.destination).toBe(CHURCH_ACCOUNT);

      // ...and VISIBLY. Not a bare catch: a real money-path signal naming the
      // tenant and the status that produced it, so this church can be found and
      // finished rather than discovered by a donor reading their statement.
      const captures = moneyPathCaptures();
      expect(captures).toHaveLength(1);
      const [, ctx] = captures[0];
      expect(ctx.level).toBe('warning');
      expect(ctx.tags.step).toBe('donate-settlement-merchant-fallback');
      expect(ctx.contexts.money_path).toMatchObject({
        tenantId: CHURCH_TENANT,
        connectAccountId: CHURCH_ACCOUNT,
        // Defaulted, not dropped: "no status recorded at all" is the case most
        // worth seeing, and falsy ids are otherwise discarded.
        connectStatus: connectStatus ?? 'unset',
      });
    }

    // The monthly branch falls back on the same signal, not a second rule.
    mockSessionsCreate.mockClear();
    seedChurch({ connectStatus: 'pending' });
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly' }));
    expect(lastSessionArgs().subscription_data.on_behalf_of).toBeUndefined();

    // And a payments-capable church raises NOTHING — an alert that fires on the
    // healthy path is an alert nobody reads.
    mockSessionsCreate.mockClear();
    mockCaptureException.mockClear();
    seedChurch({ connectStatus: 'active' });
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    expect(moneyPathCaptures()).toHaveLength(0);
  });

  it('every metadata key the webhook reads is unchanged', async () => {
    mockVerifyAuth.mockResolvedValue({ uid: 'member1', email: 'member@grace.org' });

    // One-time: the webhook's payment_intent.succeeded handler reads these to
    // record the gift and link the donor to their CRM contact.
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time', campaignId: 'c1', donorName: 'Ada' }));
    expect(lastSessionArgs().payment_intent_data.metadata).toEqual({
      tenantId: CHURCH_TENANT,
      type: 'partnership',
      donationType: 'one-time',
      campaignId: 'c1',
      donorName: 'Ada',
      donorEmail: 'member@grace.org',
      donorUserId: 'member1',
    });

    mockSessionsCreate.mockClear();
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly', campaignId: 'c1', donorName: 'Ada' }));
    const subscriptionMetadata = lastSessionArgs().subscription_data.metadata;
    expect(subscriptionMetadata).toEqual({
      // 🔴 `type: 'partnership'` must survive: checkout.session.completed has to
      // recognise this as a donation BEFORE the plan-change path, which would
      // otherwise read `plan` and cancel the tenant's own subscription.
      type: 'partnership',
      tenantId: CHURCH_TENANT,
      donationType: 'monthly',
      plan: 'pro',
      campaignId: 'c1',
      donorName: 'Ada',
      donorEmail: 'member@grace.org',
      donorUserId: 'member1',
      donationChurchName: 'Grace Community Church',
    });

    // Nothing about the settlement merchant leaked into metadata — it is a
    // top-level Stripe parameter, not a key the webhook has to learn.
    expect(subscriptionMetadata).not.toHaveProperty('on_behalf_of');
  });

  it('amounts are still sent in minor units', async () => {
    // This has shipped as a 100× error before. `unit_amount` is CENTS; the
    // receipt is what renders dollars.
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    expect(lastSessionArgs().line_items[0].price_data.unit_amount).toBe(GIFT_CENTS);

    mockSessionsCreate.mockClear();
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly' }));
    const monthlyPrice = lastSessionArgs().line_items[0].price_data;
    expect(monthlyPrice.unit_amount).toBe(GIFT_CENTS);
    expect(monthlyPrice.recurring).toEqual({ interval: 'month' });
  });

  it('the platform tenant branch is unchanged', async () => {
    // The platform/apex "tenant" has no real subdomain, so its donations stay on
    // the apex while a church's return to its own subdomain. `on_behalf_of` sits
    // well away from this and must not have perturbed it.
    seedChurch({ tenantId: PLATFORM_TENANT });
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: PLATFORM_TENANT, donationType: 'one-time' }));
    let args = lastSessionArgs();
    expect(args.success_url).toBe('https://theharvest.app/?donation=success');
    expect(args.cancel_url).toBe('https://theharvest.app/?donation=cancel');

    mockSessionsCreate.mockClear();
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    args = lastSessionArgs();
    expect(args.success_url).toBe('https://bumb.theharvest.app/?donation=success');
    expect(args.cancel_url).toBe('https://bumb.theharvest.app/?donation=cancel');
  });
});

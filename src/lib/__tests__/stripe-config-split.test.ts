import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The Stripe/Dodo boundary.
 *
 * `stripe-config.ts` held two unrelated concerns in one 60-line module: the
 * Connect application-fee rate (donations and paid event tickets, staying on
 * Stripe forever) and the subscription price IDs (moving to Dodo Payments).
 * A single module spanning both means the Dodo migration edits the file the
 * donation routes import. It was split into:
 *
 *   stripe-connect.ts — PLATFORM_FEE_MAP, and nothing else
 *   billing.ts        — PLAN_PRICES, the AI price IDs, getPlanFromPriceId
 *
 * This file pins the boundary itself: that each side exports what it owns, that
 * the old module is gone with no re-export shim papering over which side you are
 * on, and — the part that matters — that moving the fee map to a new file did
 * not move a single cent. The last describe re-derives the application fee
 * through the REAL routes on both money paths, because the map reading zero and
 * the church actually keeping the whole amount are two different claims.
 */

// ── 1. The Connect side ──────────────────────────────────────────────────────

describe('stripe-connect — the Stripe Connect side of the split', () => {
  it('exports PLATFORM_FEE_MAP as { plus: 0, pro: 0, max: 0 }', async () => {
    const { PLATFORM_FEE_MAP } = await import('../stripe-connect');
    expect(PLATFORM_FEE_MAP).toEqual({ plus: 0, pro: 0, max: 0 });
  });

  it('carries no subscription price config — that is billing.ts, and it is leaving', async () => {
    const mod = await import('../stripe-connect');
    expect(Object.keys(mod)).toEqual(['PLATFORM_FEE_MAP']);
  });
});

// ── 2. The subscription side ─────────────────────────────────────────────────

describe('billing — the subscription side of the split', () => {
  it('resolves all six plan price IDs back to their plan', async () => {
    const { PLAN_PRICES, getPlanFromPriceId } = await import('../billing');

    // Six: three plans × monthly/yearly. Derived from the map rather than
    // hardcoded, so a plan added without a reverse lookup fails here.
    const pairs = Object.entries(PLAN_PRICES).flatMap(([plan, prices]) => [
      [prices.monthly, plan],
      [prices.yearly, plan],
    ]);
    expect(pairs).toHaveLength(6);

    for (const [priceId, plan] of pairs) {
      expect(getPlanFromPriceId(priceId)).toBe(plan);
    }
  });

  it('returns null for an unknown price ID', async () => {
    const { getPlanFromPriceId } = await import('../billing');
    expect(getPlanFromPriceId('price_not_ours')).toBeNull();
    expect(getPlanFromPriceId('')).toBeNull();
  });

  it('carries no platform fee rate — that is stripe-connect.ts, and it is staying', async () => {
    const mod = await import('../billing');
    expect(mod).not.toHaveProperty('PLATFORM_FEE_MAP');
  });
});

// ── 3. The old module is gone, with no shim ──────────────────────────────────

describe('stripe-config.ts is gone', () => {
  const srcRoot = resolve(__dirname, '../..');

  it('no longer exists on disk', () => {
    expect(existsSync(join(srcRoot, 'lib/stripe-config.ts'))).toBe(false);
    expect(existsSync(join(srcRoot, 'lib/stripe-config.tsx'))).toBe(false);
  });

  it('is imported by nothing — a re-export shim would defeat the split', () => {
    // A shim would keep every importer compiling while hiding which side of the
    // Stripe/Dodo line it is on, which is the one thing the split exists to make
    // visible. Scan the real source tree rather than trusting the compiler: a
    // shim would typecheck fine.
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(full)) continue;
        if (full === __filename) continue; // this file names it on purpose
        const body = readFileSync(full, 'utf8');
        // Match import/mock targets only, not prose mentioning the old name.
        if (/from\s+['"][^'"]*stripe-config['"]|vi\.mock\(\s*['"][^'"]*stripe-config['"]/.test(body)) {
          offenders.push(full.slice(srcRoot.length + 1));
        }
      }
    };
    walk(srcRoot);

    expect(offenders).toEqual([]);
  });
});

// ── 4. The split moved code, not money ───────────────────────────────────────

const { mockCheckoutCreate } = vi.hoisted(() => ({ mockCheckoutCreate: vi.fn() }));
const { mockVerifyAuth } = vi.hoisted(() => ({ mockVerifyAuth: vi.fn() }));
const { mockGetTenantPrivate } = vi.hoisted(() => ({ mockGetTenantPrivate: vi.fn() }));
const { mockDocGet, mockDocDelete, mockCollGet, mockAdd } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocDelete: vi.fn().mockResolvedValue(undefined),
  mockCollGet: vi.fn().mockResolvedValue({ docs: [] }),
  mockAdd: vi.fn(),
}));

// Recursive doc/collection mock so nested subcollections resolve for the event
// route, while the donation route's flat tenants/{id}.get() lands on the same
// mockDocGet.
function makeCollRef(): any {
  const coll: any = {
    doc: vi.fn(() => makeDocRef()),
    add: mockAdd,
    get: mockCollGet,
  };
  coll.where = vi.fn(() => coll);
  coll.limit = vi.fn(() => coll);
  coll.orderBy = vi.fn(() => coll);
  return coll;
}
function makeDocRef(): any {
  return {
    get: mockDocGet,
    set: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: mockDocDelete,
    collection: vi.fn(() => makeCollRef()),
  };
}

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockCheckoutCreate } };
  },
}));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn(() => makeCollRef()) } }));
vi.mock('@/lib/tenant-private', () => ({
  getTenantPrivate: mockGetTenantPrivate,
  DODO_ON_HOLD_FIELD: 'dodoOnHoldAt',
}));
vi.mock('@/lib/api-auth', () => ({ verifyAuth: mockVerifyAuth }));
vi.mock('@/lib/twilio', () => ({ sendAutomatedSms: vi.fn().mockResolvedValue(undefined) }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    increment: vi.fn((n: number) => ({ __increment: n })),
  },
}));
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn() } })) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,x') } }));
// @/lib/stripe-connect is deliberately NOT mocked — the real map is the subject.

const { POST: donatePOST } = await import('@/app/api/stripe/donate/route');
const { POST: ticketPOST } = await import('@/app/api/event-registration/submit/route');

const PAID_EVENT = {
  status: 'published',
  registrationEnabled: true,
  title: 'Benefit Gala',
  ticketTypes: [{ id: 'tt1', name: 'General', price: 5000, capacity: null, order: 0 }],
  waitlistEnabled: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'theharvest.app';
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';
  delete process.env.RESEND_API_KEY;
  mockVerifyAuth.mockResolvedValue(null);
  mockGetTenantPrivate.mockResolvedValue({ stripeConnectAccountId: 'acct_T' });
  mockCollGet.mockResolvedValue({ docs: [] });
  mockAdd.mockResolvedValue({ id: 'pending1', delete: mockDocDelete });
  mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1' });
});

const lastSessionArgs = () => mockCheckoutCreate.mock.calls.at(-1)![0] as any;

describe('the split moved code, not money — real fee on both Connect paths', () => {
  it.each(['plus', 'pro', 'max'] as const)(
    'a one-time donation of 10000 cents on %s still sends an application_fee_amount of 0',
    async (plan) => {
      mockDocGet.mockResolvedValue({ exists: true, data: () => ({ plan }) });

      const res = await donatePOST(
        new NextRequest('https://example.com/api/stripe/donate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ amount: 10000, tenantId: 'bumb', donationType: 'one-time' }),
        }),
      );

      expect(res.status).toBe(200);
      expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(0);
    },
  );

  it.each(['plus', 'pro', 'max'] as const)(
    'a paid event ticket of 5000 cents on %s still sends an application_fee_amount of 0',
    async (plan) => {
      mockDocGet
        .mockResolvedValueOnce({ exists: true, data: () => PAID_EVENT })
        .mockResolvedValueOnce({ exists: true, data: () => ({ stripeConnectAccountId: 'acct_T', plan }) });

      const res = await ticketPOST(
        new NextRequest('https://grace.theharvest.app/api/event-registration/submit', {
          method: 'POST',
          headers: { 'content-type': 'application/json', host: 'grace.theharvest.app' },
          body: JSON.stringify({
            tenantId: 't1', eventId: 'e1', ticketTypeId: 'tt1',
            firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com',
          }),
        }),
      );

      expect(res.status).toBe(200);
      expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(0);
    },
  );

  it('takes nothing from a $10,000 gift either — 0% is a rate, not a rounding artifact', async () => {
    // At any of the rates this map has historically carried (2.5%, 1.5%, 1%)
    // this would be 10000–25000 cents, so a fee creeping back cannot hide
    // inside Math.round.
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'max' }) });

    await donatePOST(
      new NextRequest('https://example.com/api/stripe/donate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 1_000_000, tenantId: 'bumb', donationType: 'one-time' }),
      }),
    );

    expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(0);
  });
});

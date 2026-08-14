import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Test 8 — `stripe-connect.ts` is untouched, and a donation still keeps 100%.
 *
 * ⚠️ DONATIONS DO NOT MOVE. Giving and paid event tickets are Stripe Connect
 * destination charges into each church's own account, at a 0% platform fee, and
 * they stay that way. The `stripe-connect.ts` / `billing.ts` split exists so the
 * Dodo migration never edits the module the donation routes import — this file
 * is that boundary, restated from the Dodo side.
 *
 * Two claims, because "the file did not change" and "the money did not change"
 * are different things and only the second one matters to a church:
 *
 *  1. The module still exports exactly one thing, and it is still all zeroes.
 *  2. The fee is re-derived through the REAL donation route, on every tier.
 *
 * Section 2 deliberately duplicates `stripe-config-split.test.ts`. A migration
 * that quietly reintroduced a platform cut would be the most expensive possible
 * regression in this repo, and it should fail in the Dodo suite too rather than
 * relying on someone remembering that another file already covers it.
 */

const SRC = resolve(__dirname, '../../..');

// ── 1. The module itself ─────────────────────────────────────────────────────

describe('stripe-connect.ts is untouched by the Dodo migration', () => {
  it('still exports PLATFORM_FEE_MAP and nothing else', async () => {
    const mod = await import('@/lib/stripe-connect');
    expect(Object.keys(mod)).toEqual(['PLATFORM_FEE_MAP']);
  });

  it('is still 0% on every tier', async () => {
    const { PLATFORM_FEE_MAP } = await import('@/lib/stripe-connect');
    expect(PLATFORM_FEE_MAP).toEqual({ plus: 0, pro: 0, max: 0 });
  });

  it('has gained no Dodo import, reference, or provider abstraction', () => {
    // ⚠️ A second abstraction layer over stripe-connect is explicitly not wanted:
    // donations are not swappable and never will be. An interface here would
    // create exactly the coupling the split was made to prevent.
    const source = readFileSync(join(SRC, 'lib/stripe-connect.ts'), 'utf8');
    expect(source).not.toMatch(/\bdodo\b/i);
    expect(source).not.toContain('Provider');
    expect(source).not.toContain('import');
  });
});

describe('the Dodo module does not reach into the donation path', () => {
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) sourceFiles(full, out);
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
  }

  it('no file under src/lib/dodo imports stripe-connect', () => {
    // Comments are stripped: provider.ts explains the split in prose on purpose,
    // and naming the boundary in a docblock is the opposite of crossing it.
    const offenders = sourceFiles(join(SRC, 'lib/dodo'))
      .filter((file) => !/__tests__/.test(file))
      .filter((file) =>
        /stripe-connect/.test(
          readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^[ \t]*\/\/.*$/gm, ''),
        ),
      )
      .map((file) => file.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  it('the Dodo provider interface has no donation or ticketing method', async () => {
    // Named methods only — the seam covers subscriptions and must stay that way.
    const provider = readFileSync(join(SRC, 'lib/dodo/provider.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    for (const forbidden of ['donation', 'donate', 'ticket', 'Connect', 'applicationFee']) {
      expect(provider.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

// ── 2. The money, re-derived through the real routes ─────────────────────────

const { mockCheckoutCreate } = vi.hoisted(() => ({ mockCheckoutCreate: vi.fn() }));
const { mockVerifyAuth } = vi.hoisted(() => ({ mockVerifyAuth: vi.fn() }));
const { mockGetTenantPrivate } = vi.hoisted(() => ({ mockGetTenantPrivate: vi.fn() }));
const { mockDocGet, mockDocDelete, mockCollGet, mockAdd } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocDelete: vi.fn().mockResolvedValue(undefined),
  mockCollGet: vi.fn().mockResolvedValue({ docs: [] }),
  mockAdd: vi.fn(),
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

describe('a donation still computes a 0% fee, with the Dodo module present', () => {
  it.each(['plus', 'pro', 'max'] as const)(
    'a $100 gift on %s still sends application_fee_amount 0',
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

  it('takes nothing from a $10,000 gift either', async () => {
    // Large enough that any historic rate (2.5% / 1.5% / 1%) would be 10,000–25,000
    // cents — a fee creeping back cannot hide inside a rounding error.
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

  it('still routes the charge to the church’s own connected account', async () => {
    // 0% of a charge on the CHURCH'S OWN account is the whole point: the money
    // lands in the church's Stripe account, not Harvest's, and Dodo is nowhere
    // near it. THE-145 changed HOW it gets there — a direct charge created as the
    // connected account, rather than a destination charge swept to it — but not
    // WHERE it ends up, which is what this test has always been about.
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'pro' }) });

    await donatePOST(
      new NextRequest('https://example.com/api/stripe/donate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 5000, tenantId: 'bumb', donationType: 'one-time' }),
      }),
    );

    // The session is created AS the church (Stripe-Account header), so the funds
    // are the church's from the moment the card clears — there is no transfer.
    expect(mockCheckoutCreate.mock.calls.at(-1)![1]).toEqual({ stripeAccount: 'acct_T' });
    expect(lastSessionArgs().payment_intent_data).not.toHaveProperty('transfer_data');
  });
});

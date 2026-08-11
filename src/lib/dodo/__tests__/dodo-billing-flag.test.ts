import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DODO_BILLING_ENABLED } from '@/utils/plan-features';
import { SIGNUP_CHECKOUT_ENDPOINT, isReturningFromCheckout } from '@/utils/signup-checkout';

/**
 * REP-4 PR 2, tests 6 and 7 — the cutover, and the rollback that undoes it.
 *
 * 🔴 This file replaces #290's "the flag is false and nothing reads it". That
 * test existed to prove #290 changed nothing; this one proves the opposite claim
 * with the same rigour — that flipping the flag moves signup COMPLETELY, and
 * flipping it back moves it COMPLETELY BACK.
 *
 * "Completely" is the whole point. A rollback that leaves one signup call site
 * on the new processor is worse than no rollback: a customer who abandoned a
 * Dodo checkout would be restarted on Stripe, or the reverse, and could end up
 * paying twice.
 */

const SRC = resolve(__dirname, '../../..');
const FLAG = 'DODO_BILLING_ENABLED';

/** Every .ts/.tsx file under src/. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const isTestFile = (path: string) => /__tests__|\.test\.tsx?$/.test(path);
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * The signup endpoint the app would build with the flag in a given position.
 *
 * Both flag positions are exercised, not asserted about: `signup-checkout.ts` is
 * re-imported with `DODO_BILLING_ENABLED` stubbed, so what is checked is the
 * module the app would actually build — never a restatement of its ternary. That
 * is what keeps "the cutover is one line away" a tested claim rather than a
 * comment, in whichever position the shipped flag happens to be sitting.
 */
async function endpointWithFlag(enabled: boolean): Promise<string> {
  vi.resetModules();
  vi.doMock('@/utils/plan-features', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/utils/plan-features')>()),
    DODO_BILLING_ENABLED: enabled,
  }));
  const mod = await import('@/utils/signup-checkout');
  const endpoint = mod.SIGNUP_CHECKOUT_ENDPOINT;
  vi.doUnmock('@/utils/plan-features');
  vi.resetModules();
  return endpoint;
}

// ── The flag itself ──────────────────────────────────────────────────────────

describe('DODO_BILLING_ENABLED is off', () => {
  it('is false', () => {
    // The cutover is built, merged and tested — and OFF, until a real sandbox
    // signup has proven that a paid Dodo subscription carries the checkout
    // metadata provisioning reads. Everything below exercises BOTH positions of
    // the switch through the real modules, so this line is the only thing that
    // has to change to turn it on, and turning it on is a reviewable one-liner.
    expect(DODO_BILLING_ENABLED).toBe(false);
  });

  it('is a literal in plan-features.ts, not a computed or env-driven value', () => {
    // A switch derived from an environment variable is a switch that can be
    // flipped without a code review — for the highest-risk path in the product.
    expect(read('utils/plan-features.ts')).toMatch(/export const DODO_BILLING_ENABLED = (true|false);/);
  });
});

// ── Test 7: with the flag TRUE, signup posts to Dodo ──────────────────────────

describe('with the flag true, signup posts to Dodo and no Stripe checkout is created', () => {
  it('resolves the signup endpoint to /api/dodo/checkout', async () => {
    // Asserted through the module rebuilt with the flag stubbed on, not through
    // the shipped constant — the cutover has to stay provably one line away
    // while it is switched off, or "flip the flag" becomes an untested claim.
    expect(await endpointWithFlag(true)).toBe('/api/dodo/checkout');
  });

  it('routes BOTH signup call sites through the one switch', () => {
    // ChurchOnboarding is the first attempt; OnboardingGate's restartCheckout is
    // the same signup after an abandoned payment. Either one hard-coding a
    // processor is a half-cutover — and, on the way back, a half-rollback.
    for (const file of ['components/ChurchOnboarding.tsx', 'components/OnboardingGate.tsx']) {
      const source = read(file);
      expect(source, `${file} must post to SIGNUP_CHECKOUT_ENDPOINT`).toContain('SIGNUP_CHECKOUT_ENDPOINT');
      expect(source, `${file} must not hard-code a checkout route`).not.toMatch(
        /fetch\(\s*['"]\/api\/(stripe|dodo)\/checkout['"]/,
      );
    }
  });

  it('creates no Stripe checkout session on the signup path', async () => {
    // The claim under test is about CALLS, not about strings: with the flag on,
    // a signup must not reach stripe.checkout.sessions.create at all.
    vi.resetModules();
    const sessionsCreate = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe/x' });
    const dodoCreate = vi.fn().mockResolvedValue({ url: 'https://checkout.dodo/x', reference: 'cks_1' });

    vi.doMock('@/utils/plan-features', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/utils/plan-features')>()),
      DODO_BILLING_ENABLED: true,
    }));
    vi.doMock('stripe', () => ({
      default: class MockStripe {
        checkout = { sessions: { create: sessionsCreate } };
        customers = { create: vi.fn(), list: vi.fn().mockResolvedValue({ data: [] }), retrieve: vi.fn() };
      },
    }));
    vi.doMock('@/lib/dodo/dodo-provider', () => ({
      dodoBillingProvider: { id: 'dodo', createPlanCheckout: dodoCreate },
    }));
    vi.doMock('@/lib/api-auth', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        uid: 'uid_1', email: 'a@b.example', tenantId: null, isSuperAdmin: false,
      }),
    }));
    vi.doMock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: vi.fn() }));
    vi.doMock('@/lib/firebase-admin', () => ({
      adminDb: {
        collection: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
          doc: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), update: vi.fn() })),
        })),
      },
      adminAuth: {},
    }));

    process.env.DODO_PAYMENTS_API_KEY = 'k';
    process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_' + Buffer.from('x').toString('base64');
    process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';

    const { NextRequest } = await import('next/server');
    const { POST } = await import('@/app/api/dodo/checkout/route');
    const res = await POST(
      new NextRequest('https://theharvest.app/api/dodo/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: 'max', billing: 'monthly', ministryName: 'X' }),
      }) as never,
    );

    expect(res.status).toBe(200);
    expect(dodoCreate).toHaveBeenCalledTimes(1);
    expect(sessionsCreate).not.toHaveBeenCalled();

    vi.doUnmock('stripe');
    vi.doUnmock('@/utils/plan-features');
    vi.resetModules();
  });
});

// ── Test 6: with the flag FALSE, signup posts to Stripe and calls no Dodo ─────

describe('with the flag false, signup posts to Stripe and no Dodo call is made', () => {
  it('sends signup back to /api/stripe/checkout — completely', async () => {
    expect(await endpointWithFlag(false)).toBe('/api/stripe/checkout');
  });

  it('is what the SHIPPED build does, since the flag is off', () => {
    // The one assertion that reads the real constant rather than a stub: as
    // shipped, every signup goes to Stripe. If this and `is false` above ever
    // disagree, the switch has stopped being the only thing that decides.
    expect(SIGNUP_CHECKOUT_ENDPOINT).toBe('/api/stripe/checkout');
  });

  it('leaves NO Dodo call on the rolled-back path: /api/dodo/checkout refuses outright', async () => {
    // The client picks the endpoint, but a stale browser tab holding the old
    // bundle keeps posting to whatever it was built with. Without this refusal
    // the rollback would be partial — a live Dodo path nobody thinks is open.
    vi.resetModules();
    vi.doMock('@/utils/plan-features', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/utils/plan-features')>()),
      DODO_BILLING_ENABLED: false,
    }));
    const dodoCreate = vi.fn();
    vi.doMock('@/lib/dodo/dodo-provider', () => ({
      dodoBillingProvider: { id: 'dodo', createPlanCheckout: dodoCreate },
    }));
    vi.doMock('@/lib/api-auth', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        uid: 'uid_1', email: 'a@b.example', tenantId: null, isSuperAdmin: false,
      }),
    }));
    vi.doMock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: vi.fn() }));
    vi.doMock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn() }, adminAuth: {} }));

    const { NextRequest } = await import('next/server');
    const { POST } = await import('@/app/api/dodo/checkout/route');
    const res = await POST(
      new NextRequest('https://theharvest.app/api/dodo/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: 'max', billing: 'monthly', ministryName: 'X' }),
      }) as never,
    );

    expect(res.status).toBe(503);
    expect(dodoCreate).not.toHaveBeenCalled();

    vi.doUnmock('@/utils/plan-features');
    vi.resetModules();
  });

  it('keeps the Stripe signup path intact and reachable', () => {
    // The rollback target has to still exist. The Stripe route's new-ministry
    // branch, its 7-day trial and its newTenant marker are untouched by this PR.
    const stripeRoute = read('app/api/stripe/checkout/route.ts');
    expect(stripeRoute).toContain('trial_period_days: 7');
    expect(stripeRoute).toContain("newTenant: 'true'");
    const stripeWebhook = read('app/api/stripe/webhook/route.ts');
    expect(stripeWebhook).toContain("case 'checkout.session.completed'");
    expect(stripeWebhook).toContain("meta.newTenant === 'true'");
  });
});

// ── The Dodo webhook must NOT be gated by the flag ───────────────────────────

describe('the Dodo webhook honours an already-paid subscription regardless of the flag', () => {
  it('does not read the flag anywhere in the webhook or provisioning path', () => {
    // Turning the flag off must not strand a customer who was mid-checkout when
    // it happened: they paid, and they must get their church. The flag gates
    // whether new checkouts are CREATED, never whether a payment is honoured.
    for (const file of [
      'app/api/dodo/webhook/route.ts',
      'lib/dodo/webhook-dispatch.ts',
      'lib/dodo/provisioning.ts',
    ]) {
      // Comments about the flag are welcome — an IMPORT of it is not, because
      // only an import can become a branch.
      expect(read(file), `${file} must not import ${FLAG}`).not.toMatch(
        new RegExp(`import[^;]*\\b${FLAG}\\b[^;]*from`, 's'),
      );
      // …and it must not be referenced as a value anywhere outside a comment.
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${file} must not branch on ${FLAG}`).not.toContain(FLAG);
    }
  });
});

// ── Returning from either processor ──────────────────────────────────────────

describe('the first-run gate recognises a return from EITHER processor', () => {
  it.each([
    ['?stripe=success', true],
    ['?dodo=success', true],
    ['?dodo=success&session_id=cks_1', true],
    ['?stripe=cancel', false],
    ['?dodo=cancel', false],
    ['', false],
  ])('%s → %s', (search, expected) => {
    expect(isReturningFromCheckout(search)).toBe(expected);
  });

  it('matters because the alternative is inviting a second payment', () => {
    // OnboardingGate shows "Complete your payment" when a signup looks
    // abandoned. A payer returning with the OTHER processor's marker — because
    // the flag moved while they were in checkout — must not see that button.
    const gate = read('components/OnboardingGate.tsx');
    expect(gate).toContain('isReturningFromCheckout');
    expect(gate).not.toContain("get('stripe') === 'success'");
  });
});

// ── The Dodo module is now deliberately wired in ─────────────────────────────

describe('the Dodo module is wired into exactly the paths this PR names', () => {
  it('is imported only by the dodo lib, the dodo routes, and one named exception', () => {
    const dodoLib = join(SRC, 'lib/dodo');
    const dodoRoute = join(SRC, 'app/api/dodo');

    /**
     * The ONLY file outside the Dodo module allowed to import it.
     *
     * `/api/stripe/portal` is the "Manage subscription" button, and it is the
     * only way an admin cancels, replaces a card, or reads an invoice — Harvest
     * has no cancel control of its own. It therefore has to serve BOTH
     * processors: refusing a Dodo-owned tenant here would trap a church in a
     * subscription it cannot exit, which is worse than the double billing THE-79
     * fixes. The alternative — a separate Dodo endpoint the client picks between
     * — puts the choice back in a bundle that a stale browser tab may not have,
     * on the one route that must never be unavailable.
     *
     * ⚠️ This is a named exception, not a widening. Every other file is still
     * held to the original rule, and a new entry here needs the same argument:
     * the app reaches Dodo through its routes, and picks a processor in one
     * place — now `resolveBillingOwnership`, per tenant, rather than a constant.
     */
    const ALLOWED_OUTSIDE_IMPORTERS = ['app/api/stripe/portal/route.ts'];

    const outsiders = sourceFiles(SRC)
      .filter((file) => !isTestFile(file))
      .filter((file) => !file.startsWith(dodoLib) && !file.startsWith(dodoRoute))
      .filter((file) => /from\s+['"](@\/lib\/dodo\/|\.\.?\/dodo\/)/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1))
      .filter((file) => !ALLOWED_OUTSIDE_IMPORTERS.includes(file));

    expect(outsiders).toEqual([]);
  });

  it('the one exception imports Dodo ONLY to open a portal, never to charge', () => {
    // The exception above is granted for cancellation. It must not become a
    // doorway for checkout or plan changes — those go through the Dodo routes.
    const portal = read('app/api/stripe/portal/route.ts');
    expect(portal).toContain('createCustomerPortal');
    expect(portal).not.toContain('createPlanCheckout');
    expect(portal).not.toContain('changePlan');
  });

  it('leaves the existing-tenant plan-change screens on Stripe', () => {
    // Plan changes modify a live Stripe subscription. Moving them is REP-4 PR 6.
    for (const file of ['components/settings/PlanUpgradeSection.tsx', 'components/AdminUpgradePage.tsx']) {
      expect(read(file)).toContain("'/api/stripe/checkout'");
    }
  });

  it('leaves donations completely alone', () => {
    // stripe-connect.ts is untouched, always. Giving runs on Stripe Connect at a
    // 0% platform fee and is not part of this migration in any direction.
    const connect = read('lib/stripe-connect.ts');
    expect(connect).not.toContain('dodo');
    expect(connect).not.toContain('Dodo');
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

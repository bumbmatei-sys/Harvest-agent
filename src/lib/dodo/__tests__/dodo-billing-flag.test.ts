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

describe('DODO_BILLING_ENABLED is on', () => {
  it('is true', () => {
    // The cutover is built, merged, tested — and now ON. Everything below still
    // exercises BOTH positions of the switch through the real modules, so this
    // line remains the only thing that has to change to roll back, and rolling
    // back stays a reviewable one-liner.
    expect(DODO_BILLING_ENABLED).toBe(true);
  });

  it('is what the SHIPPED build does, since the flag is on', () => {
    // The one assertion that reads the real constant rather than a stub: as
    // shipped, every signup goes to Dodo. If this and `is true` above ever
    // disagree, the switch has stopped being the only thing that decides.
    expect(SIGNUP_CHECKOUT_ENDPOINT).toBe('/api/dodo/checkout');
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
  it('is imported only by the dodo lib, the dodo routes, and two named exceptions', () => {
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
     *
     * ─── The SECOND exception: the giving gate, added for the grace timer ────
     *
     * `/api/stripe/donate` is the one server-side money gate, and REP-4 part 3
     * gave it a deadline to enforce: a failed renewal starts a 21-day grace
     * window, and when it closes the tenant must be archived for real rather
     * than left `active`-but-refused on every request.
     *
     * 🔴 THE ARGUMENT, which is the portal's argument in a different key. Dodo
     * emits NOTHING after its recovery window — no `cancelled`, no `expired`,
     * no terminal event — so there is no later Dodo webhook to converge on and
     * no scheduled job in this repo to run (`functions/` does not deploy on
     * merge). The first request that consults the deadline is therefore the
     * only reactive trigger that exists, and that request lands here. Refusing
     * to let this route converge does not keep the state clean; it guarantees
     * a tenant whose recorded status permanently disagrees with what every
     * surface enforces.
     *
     * ⚠️ And it is the same NARROW shape the portal exception is held to: the
     * route imports exactly one function, that function refuses anything
     * `resolveBillingOwnership` does not resolve to Dodo, and it can only
     * archive — it never charges, provisions, or reads a catalogue. The test
     * below pins that.
     *
     * ─── The THIRD exception: the grace-status read (THE-125) ───────────────
     *
     * `/api/tenants/grace-status` is the church's only view of its own grace
     * window. The deadline lives on `tenant_private`, which is `allow read,
     * write: if false`, so no client can read it and — until this route — no
     * owner could be told their card had failed before their donate page went
     * dark.
     *
     * 🔴 IT TAKES THE EXCEPTION FOR THE SAME REASON THE GIVING GATE DOES, and
     * fixes the same gap from the other side. Convergence had exactly two
     * triggers: a donation attempt past the deadline, and a repeat
     * `subscription.on_hold`. A lapsed church with NO donate traffic therefore
     * kept `status: 'active'` — and kept publishing and sending — indefinitely.
     * Admins load the admin far more reliably than donors hit a donate page, so
     * this read is the cheapest reliable trigger that exists without a scheduler.
     *
     * ⚠️ And it is held to the same narrowness: one imported function, which
     * refuses anything `resolveBillingOwnership` does not resolve to Dodo, and
     * which can only archive. The test below pins that, and a further test pins
     * that this route exposes no payment action of its own.
     */
    const ALLOWED_OUTSIDE_IMPORTERS = [
      'app/api/stripe/portal/route.ts',
      'app/api/stripe/donate/route.ts',
      'app/api/tenants/grace-status/route.ts',
    ];

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

  it('the giving gate imports Dodo ONLY to converge an expired grace window', () => {
    // 🔴 The second exception, held to the same narrowness. The donate route may
    // ask Harvest's own timer to write down a state it is ALREADY enforcing. It
    // may not reach Dodo for anything else — no checkout, no plan change, no
    // provisioning, no catalogue.
    const donate = read('app/api/stripe/donate/route.ts');
    expect(donate).toContain('convergeExpiredDodoGrace');
    for (const forbidden of [
      'createPlanCheckout',
      'createCustomerPortal',
      'changePlan',
      'provisionTenant',
      'dodoBillingProvider',
      'DODO_PRODUCTS',
    ]) {
      expect(donate, forbidden).not.toContain(forbidden);
    }
  });

  it('imports exactly ONE symbol from the Dodo module into the giving gate', () => {
    // The exception is one function wide. A second symbol is a widening and has
    // to argue for itself here first.
    const donate = read('app/api/stripe/donate/route.ts');
    const imports = [...donate.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@\/lib\/dodo\/[^'"]+['"]/g)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
    expect(imports).toEqual(['convergeExpiredDodoGrace']);
  });

  it('the grace-status read imports Dodo ONLY to converge, and exposes no payment action', () => {
    // 🔴 The third exception, held to the same one-function width. This route is
    // a READ that admins hit on every dashboard load; a second Dodo symbol here
    // would put the checkout/portal/provisioning surface behind the most
    // frequently called route in the app.
    const graceStatus = read('app/api/tenants/grace-status/route.ts');
    const imports = [...graceStatus.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@\/lib\/dodo\/[^'"]+['"]/g)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
    expect(imports).toEqual(['convergeExpiredDodoGrace']);

    // ⚠️ NO PAYMENT ACTION. Dodo has already charged or attempted to charge, and
    // its dunning email already links to the customer portal. A charge path here
    // would be a second way to be billed for one subscription.
    for (const forbidden of [
      'createPlanCheckout',
      'createCustomerPortal',
      'changePlan',
      'provisionTenant',
      'dodoBillingProvider',
      'DODO_PRODUCTS',
    ]) {
      expect(graceStatus, forbidden).not.toContain(forbidden);
    }
  });

  it('keeps the Stripe plan-change path intact and routes Dodo tenants by processor (THE-89)', () => {
    // A Stripe tenant's plan change still modifies its live Stripe subscription
    // through /api/stripe/checkout — that literal must survive. A Dodo tenant's
    // goes through the runDodoPlanChange flow (utils/plan-change.ts →
    // /api/dodo/change-plan), picked from the `processor` the client reads off
    // /api/billing/invoices. Losing either half strands one processor's
    // tenants: no Stripe literal breaks every existing church; no Dodo branch
    // sends Dodo churches back to the 409.
    for (const file of ['components/settings/PlanUpgradeSection.tsx', 'components/AdminUpgradePage.tsx']) {
      expect(read(file)).toContain("'/api/stripe/checkout'");
      expect(read(file)).toContain('runDodoPlanChange');
    }
    expect(read('utils/plan-change.ts')).toContain("'/api/dodo/change-plan'");
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

// @vitest-environment node
//
// A route handler runs on the server, and this file exercises one end to end —
// including the `origin` header the return URL is built from. happy-dom (this
// repo's default environment) enforces the browser's forbidden-header rules and
// silently DROPS `Origin` from a constructed Request, which would make the
// return-URL assertions below pass against the fallback branch no matter what
// the route did with an origin. Node's fetch primitives keep the header, which
// is also what Vercel hands the real handler.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BILLING_TERMS, PLAN_ORDER } from '@/utils/plan-features';

/* ═══════════════════════════════════════════════════════════════════════════
   THE-199 — `/api/dodo/checkout` refused every quarterly signup with a 400.

   The founder chose a quarterly plan, sat on "Setting up your account…", fell
   through to "Complete your payment", and clicking through repeated it. Three
   POSTs to `/api/dodo/checkout`, all 400, no 500s and no exceptions: the route
   never reached Dodo at all.

   `readPeriod` compared the request's `billing` against the string literals
   'monthly' and 'yearly' — a hand-kept copy of the term list, written when
   there were two terms and never touched when THE-195 shipped the third. So
   'quarterly' resolved to `null`, took the `!plan || !period` branch, and was
   answered `Invalid plan/billing: plus/quarterly`.

   ⚠️ It typechecked the whole time, and that is the part worth defending
   against rather than the two words themselves. `BillingPeriod` is an alias for
   `BillingTerm`; widening that union from two members to three cannot make a
   literal comparison ill-typed, because `null` stays a perfectly valid
   `BillingPeriod | null` however many members the union gains. No compiler was
   ever going to find this. A test that DRIVES the term list is, which is what
   the structural group below does.
   ═══════════════════════════════════════════════════════════════════════════ */

process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_' + Buffer.from('quarterly-secret').toString('base64');
process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';

const mockCreatePlanCheckout = vi.fn();
const mockRequireAuth = vi.fn();
const mockCollGet = vi.fn();

type Post = (req: NextRequest) => Promise<Response>;

/**
 * Load the route with its collaborators stubbed, optionally against a DIFFERENT
 * term list than the one this build sells.
 *
 * The `billingTerms` override is the whole point of loading it this way. A
 * literal comparison and a `BILLING_TERMS` lookup are indistinguishable while
 * the constant holds exactly the three words the literals would have named;
 * they differ only when the constant says something else. Handing the route a
 * fourth term — and, separately, a shorter list — is how this suite tells them
 * apart TODAY, rather than the next time someone adds a term and discovers it
 * the way the founder did.
 *
 * `DODO_BILLING_ENABLED` is stubbed on for the same reason
 * `dodo-checkout-route.test.ts` stubs it on: this file is about what the route
 * does when it is serving, and `dodo-billing-flag.test.ts` owns the shipped
 * position of the switch.
 */
async function loadCheckoutRoute(billingTerms?: readonly string[]): Promise<Post> {
  vi.resetModules();
  vi.doMock('@/utils/plan-features', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/plan-features')>();
    return {
      ...actual,
      DODO_BILLING_ENABLED: true,
      ...(billingTerms ? { BILLING_TERMS: billingTerms } : {}),
    };
  });
  vi.doMock('@/lib/dodo/dodo-provider', () => ({
    dodoBillingProvider: { id: 'dodo', createPlanCheckout: mockCreatePlanCheckout },
  }));
  vi.doMock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));
  vi.doMock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: vi.fn() }));
  vi.doMock('@/lib/firebase-admin', () => ({
    adminDb: {
      collection: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: mockCollGet,
      })),
    },
    adminAuth: {},
  }));
  const mod = await import('@/app/api/dodo/checkout/route');
  return mod.POST as Post;
}

function request(body: Record<string, unknown>, origin = 'https://theharvest.app') {
  return new NextRequest('https://theharvest.app/api/dodo/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
}

/** The founder's request, as production logged it: a quarterly Individual plan. */
const QUARTERLY_SIGNUP = {
  plan: 'plus',
  billing: 'quarterly',
  ministryName: 'Grace Community Church',
};

let POST: Post;

beforeEach(async () => {
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
    url: 'https://test.checkout.dodopayments.com/session/cks_quarterly',
    reference: 'cks_quarterly',
  });
  POST = await loadCheckoutRoute();
});

/** What the route asked Dodo for, or `undefined` if it never asked. */
const checkoutArg = () => mockCreatePlanCheckout.mock.calls[0]?.[0];

/* ─── TEST 1 ──────────────────────────────────────────────────────────────── */
describe('a quarterly checkout request is accepted', () => {
  it('🔴 reaches Dodo carrying the quarterly term — the request the founder made', async () => {
    const res = await POST(request(QUARTERLY_SIGNUP));

    expect(res.status).toBe(200);
    expect(mockCreatePlanCheckout).toHaveBeenCalledTimes(1);
    expect(checkoutArg().period).toBe('quarterly');
  });

  it('🔴 no longer answers that request with the 400 that stranded him', async () => {
    const res = await POST(request(QUARTERLY_SIGNUP));
    const body = await res.json();

    // The exact response production returned three times over: the message the
    // signup screen could do nothing with, so it fell back to "Complete your
    // payment" and offered the same dead end again.
    expect(body).not.toMatchObject({ error: 'Invalid plan/billing: plus/quarterly' });
    expect(body.url).toBe('https://test.checkout.dodopayments.com/session/cks_quarterly');
  });

  it.each(PLAN_ORDER)('every tier can be bought quarterly, not just one — %s', async (plan) => {
    const res = await POST(request({ ...QUARTERLY_SIGNUP, plan }));

    expect(res.status).toBe(200);
    expect(checkoutArg()).toMatchObject({ plan, period: 'quarterly' });
  });

  it('stamps the quarterly term into subscription metadata, where the webhook reads it', async () => {
    await POST(request(QUARTERLY_SIGNUP));

    expect(checkoutArg().metadata).toMatchObject({ plan: 'plus', billing: 'quarterly' });
  });
});

/* ─── TEST 2 ──────────────────────────────────────────────────────────────── */
describe('monthly and yearly still work', () => {
  it('accepts a monthly signup', async () => {
    const res = await POST(request({ ...QUARTERLY_SIGNUP, billing: 'monthly' }));

    expect(res.status).toBe(200);
    expect(checkoutArg().period).toBe('monthly');
  });

  it('accepts a yearly signup', async () => {
    const res = await POST(request({ ...QUARTERLY_SIGNUP, billing: 'yearly' }));

    expect(res.status).toBe(200);
    expect(checkoutArg().period).toBe('yearly');
  });

  it.each(BILLING_TERMS)('every term the price table prices is purchasable — %s', async (term) => {
    // Driven from `BILLING_TERMS` rather than from a list written here: a term
    // this repo starts pricing and this route stops selling is precisely the
    // shape of THE-199, and it should fail HERE rather than in production.
    const res = await POST(request({ ...QUARTERLY_SIGNUP, billing: term }));

    expect(res.status).toBe(200);
    expect(checkoutArg().period).toBe(term);
  });
});

/**
 * Values that are not terms — each named by what it IS, so a failure says which
 * kind of input slipped through rather than quoting a string back.
 *
 * `annual` is the sharpest of them. It is Dodo's own word for the yearly term
 * (`catalogue.ts` reconciles the two vocabularies), so accepting it would mean
 * the processor's spelling had leaked into Harvest's front door.
 */
const NOT_A_TERM: ReadonlyArray<readonly [string, unknown]> = [
  ["Dodo's own word for the yearly term", 'annual'],
  ['the adverb form of a term', 'annually'],
  ['a capitalised term', 'Quarterly'],
  ['an upper-cased term', 'QUARTERLY'],
  ['a term with trailing whitespace', 'quarterly '],
  ['a term with leading whitespace', ' quarterly'],
  ['a truncated term', 'quarter'],
  ['a cadence the product does not sell', 'biennial'],
  ['a cadence from the donation vocabulary', 'one-time'],
  ['the empty string', ''],
  ['a null', null],
  ['a number', 3],
  ['a boolean', true],
  ['a term wrapped in an array', ['quarterly']],
  ['a term wrapped in an object', { billing: 'quarterly' }],
  ['two terms in one string', 'monthly,quarterly'],
];

/* ─── TEST 3 ──────────────────────────────────────────────────────────────── */
describe('an unrecognised billing value is still rejected with 400', () => {
  it.each(NOT_A_TERM)('refuses %s', async (_label, value) => {
    const res = await POST(request({ ...QUARTERLY_SIGNUP, billing: value }));

    expect(res.status).toBe(400);
    expect(mockCreatePlanCheckout).not.toHaveBeenCalled();
  });

  it('refuses a body carrying no billing field at all', async () => {
    const res = await POST(request({ plan: 'plus', ministryName: 'Grace Community Church' }));

    expect(res.status).toBe(400);
    expect(mockCreatePlanCheckout).not.toHaveBeenCalled();
  });

  it('refuses a plan it does not sell, on a term it does', async () => {
    const res = await POST(request({ ...QUARTERLY_SIGNUP, plan: 'ultra' }));

    expect(res.status).toBe(400);
    expect(mockCreatePlanCheckout).not.toHaveBeenCalled();
  });
});

/* ─── TEST 4 ──────────────────────────────────────────────────────────────── */
describe('an unrecognised value never falls back to a term', () => {
  it.each(NOT_A_TERM)('does not substitute a term for %s', async (_label, value) => {
    await POST(request({ ...QUARTERLY_SIGNUP, billing: value }));

    // 🔴 THE REVENUE GUARD. Not "it 400s" — that is test 3 — but that no term
    // was invented on the church's behalf. A `?? 'monthly'` here would charge a
    // church that asked for a year at a monthly cadence; a `?? 'yearly'` would
    // take a year's money from one that asked for a month. Both are the same
    // defect, and the only safe outcome is that Dodo is never asked at all.
    expect(mockCreatePlanCheckout).not.toHaveBeenCalled();
  });

  it('🔴 never reaches for the cheapest term when it cannot read one', async () => {
    // Every term, in one sweep, against the specific failure a "sensible
    // default" would produce: a $39-a-month church landing on the $329 year, or
    // a church that committed to a year being billed $39 at a time.
    for (const [, value] of NOT_A_TERM) {
      await POST(request({ ...QUARTERLY_SIGNUP, billing: value }));
    }

    const periodsSentToDodo = mockCreatePlanCheckout.mock.calls.map((call) => call[0]?.period);
    expect(periodsSentToDodo).toEqual([]);
    for (const term of BILLING_TERMS) expect(periodsSentToDodo).not.toContain(term);
  });

  it('says back what it could not read, rather than what it decided to use', async () => {
    const res = await POST(request({ ...QUARTERLY_SIGNUP, billing: 'annual' }));
    const body = await res.json();

    // The refusal quotes the SUBMITTED value. A message naming a term the
    // request never carried would mean a substitution happened somewhere above
    // it, which is the thing this whole group exists to rule out.
    expect(body.error).toContain('annual');
    expect(body.error).not.toContain('quarterly');
  });
});

/* ─── TEST 5 ──────────────────────────────────────────────────────────────── */
describe('the period allowlist is derived from BILLING_TERMS, not from string literals', () => {
  it('🔴 sells a term this build did not have when the route was written', async () => {
    // The structural proof, and the one assertion a literal comparison cannot
    // satisfy. Hand the route a FOURTH term and it must sell it, because it
    // reads the list rather than restating it. This is THE-199 caught before it
    // is written: whatever a later repricing adds to `BILLING_TERMS` is
    // purchasable here on the same commit.
    const withFourthTerm = await loadCheckoutRoute([...BILLING_TERMS, 'biennial']);

    const res = await withFourthTerm(request({ ...QUARTERLY_SIGNUP, billing: 'biennial' }));

    expect(res.status).toBe(200);
    expect(checkoutArg().period).toBe('biennial');
  });

  it('and refuses a term the list no longer carries', async () => {
    // The other direction, which the fourth-term case alone does not prove: a
    // route that simply accepted every string would pass that one too. Narrow
    // the list and the dropped terms must stop being sellable.
    const monthlyOnly = await loadCheckoutRoute(['monthly']);

    expect((await monthlyOnly(request({ ...QUARTERLY_SIGNUP, billing: 'quarterly' }))).status).toBe(400);
    expect((await monthlyOnly(request({ ...QUARTERLY_SIGNUP, billing: 'yearly' }))).status).toBe(400);
    expect((await monthlyOnly(request({ ...QUARTERLY_SIGNUP, billing: 'monthly' }))).status).toBe(200);
  });

  it('writes no term of its own anywhere in the route', async () => {
    // Belt and braces on the two behavioural proofs above: the executable
    // source of the route names no billing term at all. Comments are stripped —
    // the module note explains the bug in words and must keep being able to.
    const src = readFileSync(resolve(__dirname, '../checkout/route.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

    for (const term of BILLING_TERMS) {
      expect(src, `checkout/route.ts writes the term "${term}" as a literal`)
        .not.toMatch(new RegExp(`['"]${term}['"]`));
    }
    expect(src).toContain('BILLING_TERMS');
  });
});

/* ─── TEST 6 ──────────────────────────────────────────────────────────────── */
describe('the tenantId guard still returns 400', () => {
  it('refuses a request carrying a tenantId, even a perfectly valid quarterly one', async () => {
    // An existing tenant belongs to a plan-change path. Falling through would
    // open a SECOND subscription for a church that already has one and bill
    // them twice — which is why this guard runs BEFORE the term is even read.
    const res = await POST(request({ ...QUARTERLY_SIGNUP, tenantId: 'grace' }));

    expect(res.status).toBe(400);
    expect(mockCreatePlanCheckout).not.toHaveBeenCalled();
  });

  it('still names where a plan change belongs', async () => {
    const res = await POST(request({ ...QUARTERLY_SIGNUP, tenantId: 'grace' }));
    const body = await res.json();

    expect(body.error).toBe(
      'This endpoint creates new ministries only. Plan changes go through /api/dodo/change-plan or /api/stripe/checkout.',
    );
  });

  it.each(BILLING_TERMS)('refuses on every term, so no term routes around it — %s', async (term) => {
    const res = await POST(request({ ...QUARTERLY_SIGNUP, billing: term, tenantId: 'grace' }));

    expect(res.status).toBe(400);
    expect(mockCreatePlanCheckout).not.toHaveBeenCalled();
  });
});

/* ─── TEST 7 ──────────────────────────────────────────────────────────────── */
describe('the already-belongs-to-an-organization guard is unchanged', () => {
  it('refuses a user who already belongs to an organization', async () => {
    mockRequireAuth.mockResolvedValue({
      uid: 'uid_member',
      email: 'member@other.example',
      tenantId: 'other-church',
      isSuperAdmin: false,
    });

    const res = await POST(request(QUARTERLY_SIGNUP));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('You already belong to an organization.');
    expect(mockCreatePlanCheckout).not.toHaveBeenCalled();
  });

  it('still lets a super admin through — they legitimately have no tenant of their own', async () => {
    mockRequireAuth.mockResolvedValue({
      uid: 'uid_super',
      email: 'super@theharvest.app',
      tenantId: 'platform',
      isSuperAdmin: true,
    });

    const res = await POST(request(QUARTERLY_SIGNUP));

    expect(res.status).toBe(200);
    expect(checkoutArg().period).toBe('quarterly');
  });

  it('still requires authentication before anything else', async () => {
    mockRequireAuth.mockResolvedValue(new Response('nope', { status: 401 }));

    const res = await POST(request(QUARTERLY_SIGNUP));

    expect(res.status).toBe(401);
    expect(mockCreatePlanCheckout).not.toHaveBeenCalled();
  });
});

/* ─── TEST 8 ──────────────────────────────────────────────────────────────── */
describe('no other hardcoded term list remains in a validation path', () => {
  const SRC = resolve(__dirname, '../../../..');

  /**
   * Every module whose EXECUTABLE source writes a billing term as a literal,
   * each with what it was checked for and what was decided. The point of
   * writing it out is that a module which grows a term literal later has to be
   * triaged rather than joining the list silently — the sweep below fails on
   * anything absent from this table.
   *
   * `/api/dodo/checkout/route.ts` is deliberately NOT here: after THE-199 it
   * names no term at all, which test 5 pins directly.
   */
  const TERM_LITERAL_SITES: Readonly<Record<string, string>> = Object.freeze({
    // ── Term VALIDATION. The category THE-199 was in. ───────────────────────
    'app/api/stripe/checkout/route.ts':
      'VALIDATION, two-valued, LEFT ALONE AND REPORTED. `billingKey` narrows to ' +
      'the two keys `PLAN_PRICES` (lib/billing.ts) holds, because Stripe has ' +
      'monthly and yearly price ids and no quarterly one. Widening it needs ' +
      'three new Stripe prices and a changed checkout payload — a money-path ' +
      'change outside THE-199, not a line edit. This is the ROLLBACK path; ' +
      '`DODO_BILLING_ENABLED` is on, so signup does not use it today.',

    // ── The two-column ADD-ON domain. Legitimately not three. ───────────────
    'lib/dodo/catalogue.ts':
      'LEGITIMATE. `AddonBillingPeriod` and `addonPeriodFor` name the two ' +
      'columns add-ons are really sold on — Dodo charges an add-on on its ' +
      "product's cycle and a quarterly product cycles in months. Verified " +
      'against the live quarterly products and pinned by ' +
      'dodo-quarterly-term.test.ts. `DodoBillingPeriod` is Dodo\'s own ' +
      'three-word vocabulary; `DODO_BILLING_PERIOD` is the total map into it.',
    'utils/addon-change.ts':
      "LEGITIMATE, and its input FIXED. The client mirror of the add-on's two " +
      'columns. `/api/dodo/addons` was sending the tenant\'s PLAN term into ' +
      'it, so a quarterly church read as "unknown" and lost the price from ' +
      'every add-on card; the route now reconciles through `addonPeriodFor` ' +
      'before it answers.',

    // ── Stripe-only plumbing, coupled to Stripe's two prices. ───────────────
    'app/api/stripe/webhook/route.ts':
      'LEFT ALONE AND REPORTED. Records `stripePriceId` as yearly-or-monthly. ' +
      'Correct while Stripe sells two terms, and coupled to the same gap as ' +
      'the Stripe checkout route above.',

    // ── Naming ONE term, which is not a list. ───────────────────────────────
    'utils/plan-features.ts':
      'LEGITIMATE. `BILLING_TERMS` IS the single source. `DISCOUNTED_TERMS` ' +
      'and `actualSavingPct` name the one term that carries no discount and ' +
      'derive the rest from it.',
    'utils/signup-checkout.ts':
      'LEGITIMATE. `readSignupBillingPeriod` reads `BILLING_TERMS` already; ' +
      'the single literal is its documented fail-closed floor.',
    'components/settings/BillingTermToggle.tsx':
      'LEGITIMATE. `isDiscounted` names the one undiscounted term; the toggle ' +
      'renders `BILLING_TERMS`.',
    'components/settings/PlanUpgradeSection.tsx':
      'LEGITIMATE. A default term for the toggle, and the one term that shows ' +
      'no savings line.',
    'components/AdminUpgradePage.tsx':
      'LEGITIMATE. Same two: a default term, and the term with no savings line.',
    'components/OnboardingGate.tsx':
      'LEGITIMATE. A default term for the signup toggle; the real value goes ' +
      'through `readSignupBillingPeriod`.',
    'components/AdminSettings.tsx':
      'LEGITIMATE. Names one term for a headline price.',
    'components/AdminTenants.tsx':
      'LEGITIMATE. Names one term for a headline price.',
    'components/PlanUpgradeScreen.tsx':
      'LEGITIMATE. Names one term for a headline price.',

    // ── Not billing terms at all. ───────────────────────────────────────────
    'app/api/stripe/donate/route.ts':
      'NOT A BILLING TERM. A donation cadence (one-time / monthly), on Stripe ' +
      'Connect, which is not moving to Dodo.',
    'components/PartnerWithUsTab.tsx':
      'NOT A BILLING TERM. The same donation cadence, client-side.',
    'app/api/blog/generate/route.ts':
      'NOT A BILLING TERM. A blog scheduling frequency.',
    'components/AdminBlog.tsx':
      'NOT A BILLING TERM. The same blog scheduling frequency.',
  });

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
  }

  /** Comments stripped: prose explaining a term is documentation, not a list. */
  const codeOf = (file: string) =>
    readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

  const TERM_LITERAL = /['"](monthly|quarterly|yearly|annual)['"]/;
  const modules = walk(SRC);

  it('finds the modules to scan at all', () => {
    expect(modules.length).toBeGreaterThan(50);
  });

  it('has triaged every module that writes a term as a literal', () => {
    const found = modules
      .filter((file) => TERM_LITERAL.test(codeOf(file)))
      .map((file) => file.slice(SRC.length + 1));

    for (const file of found) {
      expect(
        TERM_LITERAL_SITES[file],
        `${file} writes a billing term as a literal and is not triaged in ` +
          'TERM_LITERAL_SITES. Decide whether it is term validation (read ' +
          'BILLING_TERMS) or names a single term on purpose, then record it.',
      ).toBeTruthy();
    }
    expect(found.length).toBe(Object.keys(TERM_LITERAL_SITES).length);
  });

  it('leaves no triaged entry pointing at a module that no longer exists', () => {
    // A stale entry is how this table stops meaning anything: it would keep
    // vouching for a file that was deleted or renamed while a real new site
    // slipped in under the count above.
    const found = new Set(
      modules.filter((file) => TERM_LITERAL.test(codeOf(file))).map((file) => file.slice(SRC.length + 1)),
    );
    for (const file of Object.keys(TERM_LITERAL_SITES)) {
      expect(found.has(file), `TERM_LITERAL_SITES still lists ${file}, which no longer writes one`).toBe(true);
    }
  });

  it('validates the two Dodo term gates through BILLING_TERMS and nothing else', () => {
    // The signup gate and the plan-change gate, named rather than swept: these
    // are the two places an untrusted `billing` becomes a `BillingPeriod` on
    // the Dodo money path, and both must read the priced set.
    for (const route of ['checkout', 'change-plan']) {
      const src = codeOf(resolve(__dirname, `../${route}/route.ts`));
      expect(src, `${route}/route.ts no longer validates against BILLING_TERMS`).toContain('BILLING_TERMS');
      for (const term of BILLING_TERMS) {
        expect(src, `${route}/route.ts writes the term "${term}" as a literal`)
          .not.toMatch(new RegExp(`['"]${term}['"]`));
      }
    }
  });

  it('reconciles the plan term into the add-on cycle server-side, in one place', () => {
    // The other end of the same class of bug: `/api/dodo/addons` answers with
    // the period its add-on PRICES recur on, which for a quarterly church is
    // monthly. The client cannot compute that — the Dodo module is server-only
    // — so the route must, through `addonPeriodFor` and not a second copy.
    const src = codeOf(resolve(__dirname, '../addons/route.ts'));
    expect(src).toContain('addonPeriodFor(context.period)');
    expect(src).not.toMatch(/billing:\s*context\.period,\s*\n\s*plan:/);
  });
});

/* ─── TEST 9 ──────────────────────────────────────────────────────────────── */
describe('the checkout payload and return_url logic are unchanged', () => {
  it('sends Dodo exactly what it sent before, with quarterly in the term slot', async () => {
    await POST(request(QUARTERLY_SIGNUP));

    // Whole-object equality, so a field quietly added to the money path fails
    // here: the trial is one of them. `trialDays` is ABSENT rather than
    // undefined — the 14 days are configured on the Dodo products and the
    // number is deliberately not restated at the call site.
    expect(checkoutArg()).toEqual({
      plan: 'plus',
      period: 'quarterly',
      returnUrl: 'https://theharvest.app/?dodo=success',
      cancelUrl: 'https://theharvest.app/?dodo=cancel',
      customer: { email: 'pastor@grace.example', name: 'Grace Community Church' },
      metadata: {
        plan: 'plus',
        billing: 'quarterly',
        ministryName: 'Grace Community Church',
        userId: 'uid_owner_1',
        newTenant: 'true',
      },
    });
    expect('trialDays' in checkoutArg()).toBe(false);
  });

  it('returns the church to the SAME origin it signed up on', async () => {
    // Firebase auth is per-origin. Sending them to the canonical host instead
    // would drop the session they need to finish setup.
    await POST(request(QUARTERLY_SIGNUP, 'https://grace.theharvest.app'));

    expect(checkoutArg().returnUrl).toBe('https://grace.theharvest.app/?dodo=success');
    expect(checkoutArg().cancelUrl).toBe('https://grace.theharvest.app/?dodo=cancel');
  });

  it('falls back to the configured app URL when a request carries no origin', async () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://canonical.example';
    try {
      const bare = new NextRequest('https://theharvest.app/api/dodo/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(QUARTERLY_SIGNUP),
      });

      await POST(bare);

      expect(checkoutArg().returnUrl).toBe('https://canonical.example/?dodo=success');
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });

  it('still carries the affiliate stamp on a quarterly signup', async () => {
    // Subscription metadata is the only place either webhook can read a
    // referrer from, and nothing retries a checkout already created — so a term
    // that skipped the stamp would be unattributable forever.
    mockCollGet.mockResolvedValue({ empty: false, docs: [{ id: 'uid_affiliate_9' }] });

    await POST(request({ ...QUARTERLY_SIGNUP, referrerId: 'GRACE10' }));

    expect(checkoutArg().metadata.referrerId).toBe('uid_affiliate_9');
  });

  it('still 500s when Dodo will not create a session — the top of the money path', async () => {
    mockCreatePlanCheckout.mockRejectedValue(new Error('dodo unavailable'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(request(QUARTERLY_SIGNUP));

    expect(res.status).toBe(500);
    err.mockRestore();
  });
});

afterEach(() => {
  vi.doUnmock('@/utils/plan-features');
});

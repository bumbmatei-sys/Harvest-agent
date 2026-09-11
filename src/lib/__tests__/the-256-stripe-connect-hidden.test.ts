import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';

/**
 * THE-256 — Stripe Connect is hidden, and nothing was deleted to hide it.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 *
 * Stripe closed the platform account `acct_1U4MOhFzBnH2P7JZ` as `rejected.fraud`
 * on 2026-08-27. The appeal is pending, 2-10 days. NO CHURCH IS CONNECTED AND NO
 * MONEY IS EXPOSED — what was lost is access, not funds.
 *
 * What was not lost is the button. `/api/stripe/connect` called
 * `stripe.accounts.create()` against that dead account WITH NO GATE AT ALL, so
 * an admin pressing Connect Stripe got a raw Stripe API error through an
 * `alert()`, days before the app is shown to 8,000 evangelists. A half-working
 * money surface in that demo is worse than an absent one.
 *
 * ─── What this file asserts, and the third is what makes the rest safe ───────
 *
 *   1. OFF — every gated route refuses with 503 and the hidden message.
 *   2. ON  — the same route, the same request, answers exactly as it did.
 *   3. INTACT — the webhook is not gated, event registration is not touched,
 *      the churches' own payment links are not touched, and no Firestore read
 *      or write changed.
 *
 * ⚠️ THE ON DIRECTION IS ALSO ASSERTED ELSEWHERE, and deliberately: the real
 * Stripe suites (`api/stripe/__tests__/*`, `api/stripe/connect/__tests__/*`,
 * `api/billing/__tests__/billing-auth-gates`, `lib/__tests__/
 * stripe-config-split`, `lib/dodo/__tests__/*`) all run with the switch mocked
 * true, so the behaviour that returns is pinned by the tests that always pinned
 * it rather than by a weaker restatement here. Every one of them passes with
 * nothing added but that mock — which is what "the gate is additive" means.
 * What section 2 below adds is the paired proof, route by route: the SAME
 * request, off and on.
 *
 * ⚠️ NO `git show` ANYWHERE. Digests are recorded as literals, so this suite
 * works identically on a shallow clone, a local checkout and a rebased branch —
 * the rule `posthog-untouched.test.ts` already sets.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const exists = (rel: string) => { try { read(rel); return true; } catch { return false; } };
const digest = (rel: string) =>
  createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

/** Comments carry example call syntax; strip them before counting real code. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ═════════════════════════════════════════════════════════════════════════
   1 — the switch itself.
   ═════════════════════════════════════════════════════════════════════════ */
describe('1 — the switch is one value, in one place', () => {
  it('is a single exported boolean, currently false', async () => {
    const mod = await import('../stripe-connect-feature');
    expect(mod.STRIPE_CONNECT_ENABLED).toBe(false);
    const src = read('lib/stripe-connect-feature.ts');
    expect(src).toMatch(/^export const STRIPE_CONNECT_ENABLED = false;$/m);
    expect(src.match(/STRIPE_CONNECT_ENABLED\s*=/g)).toHaveLength(1);
  });

  it("the hidden message is the founder's CURRENT wording, exactly — and it promises nothing", async () => {
    /**
     * 🔴 AMENDED BY THE-350, and the amendment is the point of the test.
     *
     * THE-256 pinned 'Temporarily unavailable' as the founder's wording
     * verbatim, and it was accurate then: an appeal was pending. The platform
     * account is now CLOSED as `rejected.fraud` and Stripe stopped replying
     * (`86bbnjmw9`) — no appeal, no migration, no date. The founder: "In
     * donation right now it says stripe unavailable temporarily. Hide that."
     *
     * So the line still has ONE wording pinned in ONE place; what changed is
     * that the wording no longer tells a church to wait for something that is
     * not coming. The three assertions below are the rule, not the string:
     * whatever this says, it may not carry a promise.
     */
    const { STRIPE_CONNECT_HIDDEN_MESSAGE } = await import('../stripe-connect-feature');
    expect(STRIPE_CONNECT_HIDDEN_MESSAGE).toBe(
      'Card giving inside the app is off. Your own payment links still work, and a gift you record in the CRM counts on your dashboard, in accounting and on your giving statements.',
    );
    // 🔴 No "temporarily", no "migration", no "soon", and no date.
    expect(STRIPE_CONNECT_HIDDEN_MESSAGE, 'the hidden message promises card giving is coming back')
      .not.toMatch(/temporar|migrat|coming soon|for now|shortly|in the meantime|\b20\d{2}\b/i);
    // 🔴 And it is TRUE only because THE-350 built the path it names.
    expect(read('lib/manual-donation.ts'), 'the manual path the message names does not exist')
      .toMatch(/export async function recordManualDonation\(/);
  });

  it('imports nothing, so it stays cheap on the server and free in the bundle', () => {
    // The same purity rule `lib/sms-feature.ts` keeps, for the same two reasons:
    // this module is read by a route handler AND shipped to the browser inside
    // `PaymentSection`, and `utils/plan-features.ts` — where the three older
    // master switches live — drags the whole pricing matrix in behind it.
    expect(read('lib/stripe-connect-feature.ts'), 'stripe-connect-feature.ts grew an import')
      .not.toMatch(/^\s*import\s/m);
  });

  it('every gated surface reads THAT constant, not a copy of it', () => {
    // A second boolean spelled the same way is how "one switch" quietly becomes
    // two. Every file below must IMPORT it.
    const READERS = [
      'app/api/stripe/connect/route.ts',
      'app/api/stripe/connect/callback/route.ts',
      'app/api/stripe/connect/login-link/route.ts',
      'app/api/stripe/donate/route.ts',
      'components/settings/PaymentSection.tsx',
    ];
    for (const rel of READERS) {
      const src = read(rel);
      expect(src, `${rel} does not read the Stripe Connect master switch`)
        .toMatch(/import \{[^}]*STRIPE_CONNECT_ENABLED[^}]*\} from ['"][^'"]*stripe-connect-feature['"]/);
      expect(src, `${rel} declares its own STRIPE_CONNECT_ENABLED`)
        .not.toMatch(/(const|let|var)\s+STRIPE_CONNECT_ENABLED\s*=/);
    }
  });

  it('and every one of them takes the message from there too', () => {
    // A route and a component that word the refusal differently is the defect a
    // named const exists to prevent. Nothing may spell the sentence itself.
    for (const rel of [
      'app/api/stripe/connect/route.ts',
      'app/api/stripe/connect/callback/route.ts',
      'app/api/stripe/connect/login-link/route.ts',
      'app/api/stripe/donate/route.ts',
      'components/settings/PaymentSection.tsx',
    ]) {
      const code = stripComments(read(rel));
      expect(code, `${rel} spells the hidden message instead of importing it`)
        .not.toMatch(/['"`]Temporarily unavailable['"`]/);
      expect(code, `${rel} does not use STRIPE_CONNECT_HIDDEN_MESSAGE`)
        .toContain('STRIPE_CONNECT_HIDDEN_MESSAGE');
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   The four gated routes, off and on, against the SAME request.
   ═════════════════════════════════════════════════════════════════════════ */

/** Anything downstream of the gate throws, so "it refused first" is checkable. */
const explode = (what: string) => () => { throw new Error(`${what} was reached`); };

const post = (url = 'https://grace.theharvest.app/api', body = '{}') =>
  new Request(url, { method: 'POST', body }) as never;
const get = (url: string) => new Request(url, { method: 'GET' }) as never;

/** Everything a gated route could reach, armed to blow up if it is reached. */
function armRefusalMocks() {
  vi.doMock('@/lib/firebase-admin', () => ({
    adminDb: { collection: explode('Firestore'), batch: explode('Firestore') },
  }));
  vi.doMock('@/lib/api-auth', () => ({
    requireAuth: explode('requireAuth'),
    requireOwner: explode('requireOwner'),
    requireAdmin: explode('requireAdmin'),
    verifyAuth: explode('verifyAuth'),
  }));
  vi.doMock('@/lib/tenant-private', () => ({
    getTenantPrivate: explode('tenant_private'),
    tenantPrivateRef: explode('tenant_private'),
    DODO_ON_HOLD_FIELD: 'dodoOnHoldAt',
  }));
  vi.doMock('stripe', () => ({ default: class { constructor() { throw new Error('Stripe was reached'); } } }));
  vi.doMock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: explode('Sentry') }));
  vi.doMock('@/lib/connect-return-url', () => ({ resolveReturnBaseUrl: explode('return-url') }));
  vi.doMock('@/lib/stripe-connect-gone', () => ({
    CONNECT_ACCOUNT_GONE_REASON: 'account_gone',
    CONNECT_ACCOUNT_GONE_STEP: 'step',
    forgetGoneConnectAccount: explode('tenant_private'),
    isMissingConnectAccountError: () => false,
    isRejectedConnectAccount: () => false,
  }));
}

/** Inert stand-ins, so the ON direction reaches each route's own first answer. */
function armPassthroughMocks(auth: { requireAuth?: unknown; requireOwner?: unknown } = {}) {
  vi.doMock('@/lib/stripe-connect-feature', () => ({
    STRIPE_CONNECT_ENABLED: true,
    STRIPE_CONNECT_HIDDEN_MESSAGE: 'Temporarily unavailable',
  }));
  vi.doMock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn(), batch: vi.fn() } }));
  vi.doMock('@/lib/api-auth', () => ({
    requireAuth: auth.requireAuth ?? vi.fn(),
    requireOwner: auth.requireOwner ?? vi.fn(),
    requireAdmin: vi.fn(),
    verifyAuth: vi.fn(async () => null),
  }));
  vi.doMock('@/lib/tenant-private', () => ({
    getTenantPrivate: vi.fn(async () => ({})),
    tenantPrivateRef: vi.fn(),
    DODO_ON_HOLD_FIELD: 'dodoOnHoldAt',
  }));
  vi.doMock('stripe', () => ({ default: class {} }));
  vi.doMock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: vi.fn() }));
  vi.doMock('@/lib/connect-return-url', () => ({
    resolveReturnBaseUrl: () => 'https://theharvest.app',
  }));
}

/* ─────────────────────────────────────────────────────────────────────────
   2 — OFF.
   ───────────────────────────────────────────────────────────────────────── */
describe('2 — each gated route answers 503 with the hidden message while the switch is off', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('@/lib/stripe-connect-feature'); });

  /**
   * ⚠️ THE REAL `lib/stripe-connect-feature` IS USED HERE, unmocked. This
   * section takes the switch exactly as it ships and asks the only question
   * that matters before a demo: what does an admin pressing this button get?
   */
  const expectHidden = async (res: Response) => {
    expect(res.status).toBe(503);
    // ⚠️ Read from the module rather than spelled again. THE-256 spelled the
    // sentence here AND in the module; THE-350 changed the wording (see §1) and
    // a second copy in the suite is exactly the drift the named const exists to
    // prevent. What this asserts is unchanged: the route refuses with 503 and
    // says the one thing the panel says.
    const { STRIPE_CONNECT_HIDDEN_MESSAGE } = await import('../stripe-connect-feature');
    expect(await res.json()).toEqual({ error: STRIPE_CONNECT_HIDDEN_MESSAGE });
  };

  it('🔴 POST /api/stripe/connect → 503 — the call that reaches the closed platform account', async () => {
    armRefusalMocks();
    const { POST } = await import('@/app/api/stripe/connect/route');
    await expectHidden(await POST(post('https://grace.theharvest.app/api/stripe/connect',
      JSON.stringify({ tenantId: 'grace' }))));
  });

  it('GET /api/stripe/connect/callback → 503 — the return hop from Stripe onboarding', async () => {
    // No account link can be minted while the switch is off, so nothing can
    // legitimately arrive here. It refuses rather than retrieving an account
    // and writing a status.
    armRefusalMocks();
    const { GET } = await import('@/app/api/stripe/connect/callback/route');
    await expectHidden(await GET(get('https://grace.theharvest.app/api/stripe/connect/callback?account_id=acct_1')));
  });

  it('POST /api/stripe/connect/login-link → 503 — Manage Stripe Dashboard', async () => {
    armRefusalMocks();
    const { POST } = await import('@/app/api/stripe/connect/login-link/route');
    await expectHidden(await POST(post('https://grace.theharvest.app/api/stripe/connect/login-link',
      JSON.stringify({ tenantId: 'grace' }))));
  });

  it('🔴 POST /api/stripe/donate → 503 — the PUBLIC, UNAUTHENTICATED donate route', async () => {
    // The one with no nav entry, permission or plan in front of it: anyone
    // holding the URL can POST here. A realistic, fully-formed gift must get
    // nothing back — and one-time and monthly both pass through the same line.
    armRefusalMocks();
    const { POST } = await import('@/app/api/stripe/donate/route');
    // ⚠️ Read from the module, not spelled again — see `expectHidden` above.
    const { STRIPE_CONNECT_HIDDEN_MESSAGE } = await import('../stripe-connect-feature');
    for (const donationType of ['one-time', 'monthly']) {
      const res = await POST(post('https://grace.theharvest.app/api/stripe/donate',
        JSON.stringify({ amount: 5000, tenantId: 'grace', donationType, donorEmail: 'a@b.org' })));
      expect(res.status, `a ${donationType} gift was not refused`).toBe(503);
      expect(await res.json()).toEqual({ error: STRIPE_CONNECT_HIDDEN_MESSAGE });
    }
  });

  it('🔴 refuses BEFORE authenticating and before opening Firestore, on all four', () => {
    // Asserted by construction above — every mock in `armRefusalMocks` throws —
    // but stated as its own claim because it is the reason no data moves. The
    // gate is the FIRST statement in each handler.
    for (const rel of [
      'app/api/stripe/connect/route.ts',
      'app/api/stripe/connect/callback/route.ts',
      'app/api/stripe/connect/login-link/route.ts',
      'app/api/stripe/donate/route.ts',
    ]) {
      const body = stripComments(read(rel)).split(/export async function (?:POST|GET)\([^)]*\)\s*\{/)[1];
      const firstStatement = body.split('\n').map((l) => l.trim()).filter(Boolean)[0];
      expect(firstStatement, `${rel} does something before it refuses`)
        .toBe('if (!STRIPE_CONNECT_ENABLED) {');
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   3 — ON. 🔴 The gate is ADDITIVE.
   ───────────────────────────────────────────────────────────────────────── */
describe('3 — each gated route answers exactly as before when the switch is on', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  /**
   * 🔴 THE SAME REQUEST AS SECTION 2, route for route. Each assertion below is
   * the answer that route gave to that request before this ticket existed, so
   * a gate that had changed anything downstream of itself would show up here.
   * The DETAIL of each route's behaviour is pinned by its own suite, every one
   * of which passes unedited but for a `STRIPE_CONNECT_ENABLED: true` mock.
   */

  it('POST /api/stripe/connect → its own auth refusal, not 503', async () => {
    armPassthroughMocks({
      requireAuth: vi.fn(async () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })),
    });
    const { POST } = await import('@/app/api/stripe/connect/route');
    const res = await POST(post('https://grace.theharvest.app/api/stripe/connect',
      JSON.stringify({ tenantId: 'grace' })));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('GET /api/stripe/connect/callback → its redirect, not 503', async () => {
    armPassthroughMocks();
    const { GET } = await import('@/app/api/stripe/connect/callback/route');
    const res = await GET(get('https://grace.theharvest.app/api/stripe/connect/callback'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=missing_account');
  });

  it('POST /api/stripe/connect/login-link → its own owner refusal, not 503', async () => {
    armPassthroughMocks({
      requireOwner: vi.fn(async () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })),
    });
    const { POST } = await import('@/app/api/stripe/connect/login-link/route');
    const res = await POST(post('https://grace.theharvest.app/api/stripe/connect/login-link',
      JSON.stringify({ tenantId: 'grace' })));
    expect(res.status).toBe(401);
  });

  it('POST /api/stripe/donate → reaches its own validation, not 503', async () => {
    const previous = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test_the256';
    try {
      armPassthroughMocks();
      const { POST } = await import('@/app/api/stripe/donate/route');
      // The gift from section 2, now accepted past the gate and answered by the
      // route's own rules: $0.05 is under the Stripe minimum.
      const res = await POST(post('https://grace.theharvest.app/api/stripe/donate',
        JSON.stringify({ amount: 5, tenantId: 'grace', donationType: 'one-time' })));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Invalid donation amount/);
    } finally {
      if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previous;
    }
  });

  it('🔴 and the whole of each route below the gate is byte-for-byte as it was', () => {
    // The four routes are PURE INSERTIONS: an import line and one guard block
    // each, nothing removed, nothing edited. Stated here as the invariant a
    // reader can check by eye — every branch named below is still in the file.
    //
    // ⚠️ COMMENTS ARE STRIPPED FIRST, and they have to be. These files explain
    // themselves at length and quote their own code while doing it — `type:
    // 'standard'` appears in connect/route.ts's THE-145 note as well as in the
    // call it documents — so a raw-text search would read the EXPLANATION as
    // the code and pass on a file whose code had changed. (The precedent
    // AdminSettings' regroup suite already sets for comment-bearing claims.)
    const CONNECT = stripComments(read('app/api/stripe/connect/route.ts'));
    expect(CONNECT).toContain("type: 'standard'");                 // THE-145 PR 2
    expect(CONNECT).toContain('mirrorSafe');                       // the affiliate mirror
    expect(CONNECT).toContain('accountLinks.create');              // both call sites
    expect(CONNECT).toContain("stripeConnectStatus: 'pending'");

    const CALLBACK = stripComments(read('app/api/stripe/connect/callback/route.ts'));
    for (const branch of ['missing_account', 'stripe_not_configured',
      'connect_tenant_not_found', 'connect_callback_failed']) {
      expect(CALLBACK, `the ${branch} redirect left the callback`).toContain(branch);
    }
    expect(CALLBACK).toContain('deriveConnectStatus(account)');

    const LOGIN = stripComments(read('app/api/stripe/connect/login-link/route.ts'));
    expect(LOGIN).toContain('isMissingConnectAccountError');       // THE-148 signal 1
    expect(LOGIN).toContain('isRejectedConnectAccount');           // THE-148 signal 2
    expect(LOGIN).toContain('accounts.createLoginLink');           // the Express branch
    expect(LOGIN).toContain('https://dashboard.stripe.com');       // the Standard branch
    expect(LOGIN).toContain('requireOwner(request');

    const DONATE = stripComments(read('app/api/stripe/donate/route.ts'));
    expect(DONATE).toContain('application_fee_amount: applicationFeeAmount');
    expect(DONATE).toContain('application_fee_percent: feePercent * 100');
    expect(DONATE).toContain('const directCharge = { stripeAccount: connectAccountId }');
    expect(DONATE).toContain("getPlanFeatures(plan).fundraising === false");
    expect(DONATE).toContain("tenantAllows(effectiveStatus, 'giving')");
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   4 — 🔴 the connect webhook is NOT gated.
   ═════════════════════════════════════════════════════════════════════════ */
describe('4 — the connect webhook is not gated', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  /**
   * It confirms donations and paid event tickets, so it must stay live for
   * anything already in flight — a gift whose Checkout Session was created
   * before the switch flipped still has to be recorded, receipted and counted
   * onto a giving statement. It is harmless idle: with no new sessions being
   * created, no new events arrive.
   */
  it('is byte-for-byte unchanged, and never mentions the switch', () => {
    expect(digest('src/app/api/stripe/connect/webhook/route.ts'))
      .toBe('febfc599c9ffedb31843bc7cb00e58ae50fb2db09998dfd455ad6b2d37054b1e');
    expect(read('app/api/stripe/connect/webhook/route.ts'), 'the Connect webhook was gated')
      .not.toMatch(/STRIPE_CONNECT_ENABLED|stripe-connect-feature/);
  });

  it('🔴 still answers as itself with the switch at its shipped value', async () => {
    // The real `stripe-connect-feature` — no mock. A webhook POST reaches the
    // route's own signature check and is answered by it, not by a 503.
    process.env.STRIPE_SECRET_KEY = 'sk_test_the256';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_the256';
    vi.doMock('stripe', () => ({ default: class {} }));
    vi.doMock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn() } }));
    const { POST } = await import('@/app/api/stripe/connect/webhook/route');
    const res = await POST(new Request('https://theharvest.app/api/stripe/connect/webhook', {
      method: 'POST', body: '{"type":"account.updated"}',
    }) as never);
    expect(res.status, 'the Connect webhook is refusing while the switch is off').not.toBe(503);
    expect(res.status).toBe(400);                       // its own "Missing signature"
    expect((await res.json()).error).toBe('Missing signature');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   5 — 🔴 event registration is untouched.
   ═════════════════════════════════════════════════════════════════════════ */
describe('5 — event registration is untouched', () => {
  /**
   * 🔴 THE TICKET'S LOUDEST STOP CONDITION, pinned so nobody re-adds the check
   * it forbids.
   *
   * Free registration, waitlisting and a ticket discounted to $0 already bypass
   * Stripe entirely — `requiresPayment = amount > 0 && !waitlisted` — so they
   * keep working with Connect hidden and need no gate. A PAID ticket already
   * fails cleanly on the existing `connectAccountId` check, which is the same
   * refusal every church without Stripe already gets; a second gate on top of
   * it would be a second reason for one state, which is how a route ends up
   * refusing for a reason nobody can name.
   */
  it('the route never mentions the switch, and moved only where THE-314 moved it', () => {
    // ⚠️ REPINNED ONCE, FOR THE-314, WITH THE PRIOR VALUE KEPT below rather than
    // overwritten. The route changed by exactly one IMPORT PATH: its best-effort
    // `sendAutomatedSms` came from `@/lib/twilio` and now comes from
    // `@/lib/sms-send`, because Harvest swapped telephony providers and the send
    // funnel moved with it. Not one line of registration, payment or Stripe
    // logic moved, which is what THE-256 actually guards — asserted below and in
    // the two rules further down, both untouched.
    //
    // ── REPINNED AGAIN, FOR THE-351, AND THIS ONE IS NOT AN IMPORT ──────────
    //
    // THE-256's claim is that HIDING STRIPE CONNECT did not reach event
    // registration, and that claim is untouched and is re-asserted two lines
    // below: this route still never mentions the switch or its module.
    //
    // What THE-351 changes is a DIFFERENT proposition, and it changes it on the
    // founder's instruction. THE-256 recorded that a paid ticket with no Connect
    // account "fails cleanly", which was the right answer while a church could
    // not be paid at all. It can be paid now - directly, through its own PayPal
    // or Revolut, confirmed by hand - so sending the member to a closed rail to
    // be refused is no longer clean, it is just wrong. `requiresPayment` gains
    // `&& !manualConfirmationMode()`, the seat is written confirmed-and-unpaid,
    // and the Stripe branch is left whole for the day a rail returns.
    //
    //
    // ─── REPINNED FOR THE-355 ───────────────────────────────────────────────
    //
    // THE-256's OWN CLAIM IS UNTOUCHED AND IS RE-ASSERTED TWO LINES BELOW: this
    // route still never mentions the Connect switch or its module.
    //
    // What THE-355 changes is ONE EXPRESSION inside the `owesManualPayment`
    // ternary THE-351 added: a seat that owes money now also gets a 256-bit
    // `paymentClaimToken`, handed back once to the person who just registered,
    // so a LOGGED-OUT registrant can say they paid. THE-351 built that flow
    // behind `requireAuth` and mounted it on the member app; for a crusade,
    // where most attendees have no account, that reached nobody, so no claim was
    // ever created and the church's inbox was empty. The mint sits inside the
    // existing ternary and nowhere else, which is what keeps "a free
    // registration acquires no credential" structural.
    // Previous pins:
    //   0324b34c80861ea7e2ee61e40bba7b6ff6f8be72dbef43827e75837e08a5530e  (pre-THE-314)
    //   b0e55c91adcc9b342e4d16fc5cabfff1426842056e1f5bb9e0f47546fc41ed98  (THE-314)
    //   f203f58f402ec89f14415c9ae64134bd44286b8c4fcb0e8fa12fb70cfd7739a2  (THE-351)
    expect(digest('src/app/api/event-registration/submit/route.ts'))
      .toBe('20be877124903dd6eeda68f20ea3835206381dcc766e8d680f755e2766cc50ed');
    expect(read('app/api/event-registration/submit/route.ts'), 'the SMS call site moved off the retired module')
      .toContain("from '@/lib/sms-send'");
    expect(read('app/api/event-registration/submit/route.ts'), 'event registration was gated')
      .not.toMatch(/STRIPE_CONNECT_ENABLED|stripe-connect-feature/);
  });

  it('🔴 its existing suite still asserts what it always did', () => {
    // The claim THE-256 makes in as many words: if the no-regression suite for
    // event registration had to be touched to keep it green, the change reached
    // event registration after all.
    //
    // ⚠️ REPINNED ONCE, FOR THE-314, and the edit is the mirror of the route's:
    // one `vi.mock` path, `@/lib/twilio` → `@/lib/sms-send`, because the module
    // the route imports moved. Not one assertion changed — the suite is the same
    // suite, pointed at the same function under a new home. That is the narrow
    // case this pin exists to distinguish from a suite being weakened.
    //
    // ── REPINNED AGAIN, FOR THE-351, AND THE SUITE IS NOT WEAKENED ──────────
    //
    // This pin exists to distinguish "the suite was pointed at the same function
    // under a new home" from "the suite was weakened to stay green", so what
    // THE-351's edit IS matters more than that there was one. It is ONE
    // `vi.mock`, and it makes the suite STRICTER rather than looser: with manual
    // confirmation shipped, the Stripe branch these twenty assertions describe is
    // dormant, so the suite now pins `manualConfirmationMode()` OFF and keeps
    // proving that the direct charge, the platform fee, the metadata, the
    // rollback and the free-ticket bypass are all still exactly right for the day
    // a rail returns. NOT ONE ASSERTION CHANGED - deleting them was the wrong
    // answer and is the thing THE-345's whole discipline forbids ("nothing is
    // deleted to hide a feature").
    //
    // Previous pins:
    //   4e8b6ed25913eca78828ebdcf0abf726c48f7b5f182dbbc8b2a2877f77be8797  (pre-THE-314)
    //   d7adee5eb35cc9975a046004b650f126275e551ceb648feccbedd8ef377ed6ec  (THE-314)
    expect(digest('src/app/api/event-registration/__tests__/submit-route.test.ts'))
      .toBe('2215924946e5803840b368fa0862b2a362307f59f340ebd7adb4d6c99dbcf430');
  });

  it('the two rules that make it independent of Connect are still there', () => {
    const src = read('app/api/event-registration/submit/route.ts');
    // ⚠️ AMENDED BY THE-351, AND THE TWO RULES ARE THE SAME TWO RULES.
    //
    // THE-256's claim is that a FREE registration, a WAITLIST entry and a ticket
    // discounted to $0 never reach the payment question at all, so hiding Connect
    // could not touch them. Both clauses are byte-identical in the expression
    // below; what joins them is a third that narrows the Stripe path FURTHER,
    // never widens it - under manual confirmation nothing reaches the rail. A
    // guard pinned to the exact old spelling would have failed on a change that
    // makes its own claim MORE true, so it is pinned to the two clauses instead.
    expect(src, 'free and waitlisted tickets no longer bypass Stripe')
      .toMatch(/const requiresPayment = amount > 0 && !waitlisted(?: && !manualConfirmationMode\(\))?;/);
    expect(src, 'the free/waitlist bypass was replaced rather than extended')
      .toContain('amount > 0 && !waitlisted');
    expect(src, 'the paid-ticket refusal on a missing Connect account is gone')
      .toContain('if (!connectAccountId) {');
    // And it never called the donate route, so gating that one cannot reach it.
    expect(stripComments(src), 'event registration now posts to the donate route')
      .not.toMatch(/api\/stripe\/donate/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   6 — 🔴 no Firestore read or write changed.
   ═════════════════════════════════════════════════════════════════════════ */
describe('6 — no Firestore read or write changed', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

  /**
   * Two halves, and both are needed.
   *
   *   · At RUNTIME, a gated route opens no collection at all — section 2's
   *     mocks throw on `adminDb.collection`, so every 503 there is already
   *     proof that nothing was read or written to produce it.
   *   · In the SOURCE, the operations each edited file performs are counted and
   *     pinned. The numbers below were taken from the files as they shipped
   *     BEFORE this ticket and are identical after it — an added, removed or
   *     re-pointed query moves one of them.
   */
  const FIRESTORE_OPS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    'app/api/stripe/connect/route.ts': {
      'adminDb.collection(': 3, 'adminDb.batch(': 1, 'batch.commit(': 1, 'batch.set(': 1,
      'batch.update(': 1, '.doc(': 3, '.get(': 2, '.set(': 3, '.update(': 1,
      'getTenantPrivate(': 1, 'tenantPrivateRef(': 1,
    },
    'app/api/stripe/connect/callback/route.ts': {
      'adminDb.collection(': 3, 'adminDb.batch(': 1, 'batch.commit(': 1, 'batch.update(': 1,
      '.doc(': 1, '.get(': 3, '.update(': 2, '.where(': 2, '.limit(': 1,
    },
    'app/api/stripe/connect/login-link/route.ts': {
      'getTenantPrivate(': 1, 'forgetGoneConnectAccount(': 1,
    },
    'app/api/stripe/donate/route.ts': {
      'adminDb.collection(': 1, '.doc(': 1, '.get(': 1,
      'getTenantPrivate(': 1, 'convergeExpiredDodoGrace(': 1,
    },
    'components/settings/PaymentSection.tsx': { 'getDoc(': 2 },
    // 🔴 The switch itself reads and writes nothing, which is why flipping it
    // can never need a migration.
    'lib/stripe-connect-feature.ts': {},
  };

  /** Every operation any of these files could perform, so a NEW one is caught. */
  const VOCABULARY = [
    'adminDb.collection(', 'adminDb.batch(', 'batch.commit(', 'batch.set(', 'batch.update(',
    '.doc(', '.get(', '.set(', '.update(', '.add(', '.where(', '.limit(',
    'getTenantPrivate(', 'tenantPrivateRef(', 'forgetGoneConnectAccount(',
    'convergeExpiredDodoGrace(', 'getDoc(', 'getDocs(', 'setDoc(', 'updateDoc(',
    'addDoc(', 'deleteDoc(', 'writeBatch(', 'recursiveDelete(', '.delete(',
  ];

  it.each(Object.keys(FIRESTORE_OPS))('%s performs exactly the operations it always did', (rel) => {
    const code = stripComments(read(rel));
    const found: Record<string, number> = {};
    for (const op of VOCABULARY) {
      const n = code.split(op).length - 1;
      if (n) found[op] = n;
    }
    expect(found, `${rel} changed which Firestore operations it performs`)
      .toEqual(FIRESTORE_OPS[rel]);
  });

  it('🔴 nothing this ticket touches deletes or migrates a document', () => {
    // A church that gets Stripe back must find its connection where it left it:
    // the account id on `tenant_private`, the status on the tenant doc, the
    // affiliate mirror on the user doc, and its donation history.
    for (const rel of Object.keys(FIRESTORE_OPS)) {
      expect(stripComments(read(rel)), `${rel} deletes or migrates Firestore data`)
        .not.toMatch(/\.delete\(\)|deleteDoc|bulkWriter|recursiveDelete|FieldValue\.delete/);
    }
  });

  it('🔴 the fields a connected church is stored under are still written, unchanged', () => {
    // The gate goes IN FRONT of these writes; it never edits them. That is what
    // makes "flip it back and every surface returns whole" true rather than a
    // hope — the same account id and status come back, not a re-derived guess.
    // Comments stripped, for the reason given on the branch check in section 3.
    const connect = stripComments(read('app/api/stripe/connect/route.ts'));
    expect(connect).toContain("stripeConnectStatus: 'pending'");
    expect(connect).toContain('stripeConnectAccountId: account.id');
    expect(connect).toContain('affiliateStripeAccountId: account.id');
    expect(stripComments(read('app/api/stripe/connect/callback/route.ts')))
      .toContain('stripeConnectStatus: status');
    expect(stripComments(read('app/api/stripe/donate/route.ts')))
      .toContain('tenantPrivate.stripeConnectAccountId');
  });

  it('leaves firestore.rules and functions/ alone', () => {
    // firestore.rules auto-deploys to production on merge to main.
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
    expect(digest('functions/src/index.ts'))
      .toBe('39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   7 — 🔴 hide, not delete.
   ═════════════════════════════════════════════════════════════════════════ */
describe('7 — hide, not delete', () => {
  it('every route file, component and lib is still on disk', () => {
    for (const rel of [
      'app/api/stripe/connect/route.ts',
      'app/api/stripe/connect/callback/route.ts',
      'app/api/stripe/connect/login-link/route.ts',
      'app/api/stripe/connect/webhook/route.ts',
      'app/api/stripe/donate/route.ts',
      'components/settings/PaymentSection.tsx',
      'lib/stripe-connect.ts',
      'lib/stripe-connect-status.ts',
      'lib/stripe-connect-gone.ts',
      'lib/donation-webhook.ts',
      'lib/donation-receipt.ts',
      'lib/connect-return-url.ts',
    ]) {
      expect(exists(rel), `${rel} was deleted`).toBe(true);
    }
  });

  it('🔴 the fee table and the fundraising column keep their values', async () => {
    // The gate goes IN FRONT of the matrix; it never edits it. The tiers that
    // own giving still own it, so flipping the switch restores the same
    // entitlement rather than a re-derived guess at it.
    const { PLATFORM_FEE_MAP } = await import('../stripe-connect');
    // The three priced tiers, at 0% each — free carries no entry at all and the
    // donate route reads `FEE_MAP[plan] ?? 0`, which is why it has none.
    expect(Object.keys(PLATFORM_FEE_MAP).sort()).toEqual(['max', 'plus', 'pro']);
    for (const plan of ['plus', 'pro', 'max'] as const) {
      expect(PLATFORM_FEE_MAP[plan], `the platform fee on ${plan} moved`).toBe(0);
    }
    const { getPlanFeatures } = await import('../../utils/plan-features');
    expect(getPlanFeatures('free').fundraising).toBe(false);
    expect(getPlanFeatures('plus').fundraising).toBe(true);
    expect(getPlanFeatures('pro').fundraising).toBe(true);
    expect(getPlanFeatures('max').fundraising).toBe(true);
  });

  it('no test was deleted to make the hide pass', () => {
    // Every suite that pinned Stripe Connect before this ticket is still here,
    // still running — with the switch mocked ON, which is the restore proof.
    const SUITES = [
      'app/api/stripe/__tests__/connect-route.test.ts',
      'app/api/stripe/__tests__/donate-route.test.ts',
      'app/api/stripe/__tests__/donate-direct-charge.test.ts',
      'app/api/stripe/__tests__/donate-free-tier-refused.test.ts',
      'app/api/stripe/__tests__/donate-platform-fee.test.ts',
      'app/api/stripe/connect/__tests__/express-login-link.test.ts',
      'app/api/stripe/connect/__tests__/login-link-closed-account.test.ts',
      'app/api/stripe/connect/__tests__/standard-connect-account.test.ts',
      'app/api/stripe/__tests__/connect-webhook-donations.test.ts',
      'app/api/stripe/__tests__/connect-webhook-event-registration.test.ts',
    ];
    for (const rel of SUITES) {
      expect(exists(rel), `${rel} was deleted`).toBe(true);
      if (/connect-webhook/.test(rel)) {
        // The webhook suites are the ones that must NOT have needed the mock.
        expect(read(rel), `${rel} had to mock the switch — the webhook was gated`)
          .not.toContain('STRIPE_CONNECT_ENABLED');
      } else {
        expect(read(rel), `${rel} no longer pins the switched-on behaviour`)
          .toContain('STRIPE_CONNECT_ENABLED: true');
      }
    }
  });
});

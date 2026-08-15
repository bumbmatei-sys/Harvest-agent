import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * THE-148 — a church that closes its Stripe account is stuck.
 *
 * 🔴 THE BUG, hit live on 2026-08-14. A connected account was closed in Stripe.
 * `tenant_private.stripeConnectAccountId` still pointed at it, so
 * `accounts.retrieve` threw, the route's generic catch turned that into a 500
 * reading "Failed to open your Stripe dashboard", and the church was told to try
 * again. Retrying could never work — the account was gone. Meanwhile the
 * world-readable tenant doc still said `stripeConnectStatus: 'active'`, so the
 * settings screen went on offering "Manage Stripe Dashboard" and the app went on
 * reporting that giving was available with no account to receive it. Recovery
 * took a hand-edit in Firestore, which no customer can perform.
 *
 * ─── 🔴 THE TWO HALVES THIS SUITE HOLDS APART ────────────────────────────────
 *
 * Fixing the first half badly creates a worse bug than the one being fixed, so
 * the fail-open guard is weighted exactly as heavily as the regression:
 *
 *   1. A GONE account must offer re-onboarding (tests 1, 2).
 *   2. 🔴 EVERY OTHER FAILURE MUST STILL BE A 500 THAT SAYS TRY AGAIN (tests 3,
 *      4). A network blip, an expired key or a rate limit that got read as "your
 *      account is gone" would invite a church with a WORKING account to
 *      re-onboard — and re-onboarding mints a new account, which moves where the
 *      congregation's money lands.
 *
 * ⚠️ NOTHING HERE MATCHES AN ERROR MESSAGE. Every fixture below carries Stripe's
 * structured fields (`type`, `code`, `requirements.disabled_reason`) and the
 * message text is deliberately unhelpful or actively misleading — test 4's
 * rate-limit fixture says "No such account" in its message and must still be a
 * 500. A string-matching implementation fails this file.
 *
 * ⚠️ THE REAL `requireOwner` RUNS (test 11), for the same reason
 * `express-login-link.test.ts` insists on it: the authorization decision is the
 * most privileged thing this route makes, and a mocked gate cannot fail to read
 * a roster it never touches. The real `deriveConnectStatus` runs too (tests 2,
 * 8) — the corrected record has to be right by the same derivation the
 * `account.updated` webhook uses, or the two paths disagree about one fact.
 * Only Stripe and Firebase are mocked beneath them.
 */

// ── Stripe ──────────────────────────────────────────────────────────────────

const {
  mockAccountsRetrieve,
  mockCreateLoginLink,
  mockAccountsCreate,
  mockAccountsUpdate,
  mockAccountsDel,
  mockAccountLinksCreate,
} = vi.hoisted(() => ({
  mockAccountsRetrieve: vi.fn(),
  mockCreateLoginLink: vi.fn(),
  mockAccountsCreate: vi.fn(),
  mockAccountsUpdate: vi.fn(),
  mockAccountsDel: vi.fn(),
  mockAccountLinksCreate: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    accounts = {
      retrieve: mockAccountsRetrieve,
      createLoginLink: mockCreateLoginLink,
      create: mockAccountsCreate,
      update: mockAccountsUpdate,
      del: mockAccountsDel,
    };
    accountLinks = { create: mockAccountLinksCreate };
  },
}));

// ── Firestore ───────────────────────────────────────────────────────────────
//
// 🔴 A store that actually MUTATES, unlike the write-recording mock in
// `express-login-link.test.ts`. Half this ticket is about what the record says
// AFTERWARDS: test 8 asks whether the corrected record still reports giving as
// available, and it can only ask that of a store the correction really changed.
//
// `FieldValue.delete()` is honoured for real — a sentinel that removes the key —
// because "the field is absent" and "the field is the string 'DELETE'" are very
// different answers to `if (!accountId)`.

const {
  store,
  commits,
  DELETE_SENTINEL,
  failCommit,
  callLog,
} = vi.hoisted(() => ({
  /** `${collection}/${id}` → document data. Absent key = document missing. */
  store: new Map<string, Record<string, any>>(),
  /** One entry per batch commit: the ops it applied. */
  commits: [] as Array<Array<{ op: string; path: string; data: Record<string, any> }>>,
  DELETE_SENTINEL: { __fieldValue: 'delete' } as Record<string, any>,
  /** Flipped by test 10 to make the correction write fail. */
  failCommit: { value: false },
  /** Ordered record of the calls test 9 cares about. */
  callLog: [] as string[],
}));

function applyOps(ops: Array<{ op: string; path: string; data: Record<string, any> }>) {
  for (const { op, path, data } of ops) {
    const existing = store.get(path);
    if (op === 'update' && existing === undefined) continue;
    const next = { ...(existing ?? {}) };
    for (const [key, value] of Object.entries(data)) {
      if (value === DELETE_SENTINEL) delete next[key];
      else next[key] = value;
    }
    store.set(path, next);
  }
}

function docRef(path: string) {
  return {
    __path: path,
    get: async () => {
      const data = store.get(path);
      return { exists: data !== undefined, id: path.split('/')[1], data: () => data };
    },
    set: async (data: Record<string, any>) => { applyOps([{ op: 'set', path, data }]); },
    update: async (data: Record<string, any>) => { applyOps([{ op: 'update', path, data }]); },
  };
}

const { mockVerifyIdToken } = vi.hoisted(() => ({ mockVerifyIdToken: vi.fn() }));

vi.mock('@/lib/firebase-admin', () => ({
  adminAuth: { verifyIdToken: mockVerifyIdToken },
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${name}/${id}`),
      where() { return this; },
      limit() { return this; },
      get: async () => ({ size: 0, empty: true, docs: [] }),
    }),
    batch: () => {
      const ops: Array<{ op: string; path: string; data: Record<string, any> }> = [];
      return {
        set: (ref: { __path: string }, data: Record<string, any>) => {
          ops.push({ op: 'set', path: ref.__path, data });
        },
        update: (ref: { __path: string }, data: Record<string, any>) => {
          ops.push({ op: 'update', path: ref.__path, data });
        },
        commit: async () => {
          callLog.push('commit');
          if (failCommit.value) throw new Error('Firestore unavailable');
          commits.push(ops);
          applyOps(ops);
        },
      };
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: vi.fn(() => DELETE_SENTINEL),
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    increment: vi.fn((n: number) => ({ __increment: n })),
  },
}));

// The roster AND the Connect account id both live on this doc, and the real
// `requireOwner` reads it through `getTenantPrivate` for the roster check — so
// it is backed by the same store the correction writes to.
vi.mock('@/lib/tenant-private', () => ({
  getTenantPrivate: async (id: string) => store.get(`tenant_private/${id}`) ?? {},
  tenantPrivateRef: (id: string) => docRef(`tenant_private/${id}`),
  TENANT_PRIVATE_COLLECTION: 'tenant_private',
  DODO_ON_HOLD_FIELD: 'dodoOnHoldAt',
}));

const { POST: loginLink } = await import('@/app/api/stripe/connect/login-link/route');
// 🔴 The real derivation the `account.updated` webhook uses. Imported, not
// re-implemented: a corrected record that this function still calls 'active'
// would put the two paths back into disagreement, which is THE-149's shape.
const { deriveConnectStatus } = await import('@/lib/stripe-connect-status');
// The real capability predicate the donate route gates giving on.
const { tenantAllows } = await import('@/lib/tenant-lifecycle');

// ── Named fixtures ──────────────────────────────────────────────────────────
//
// Test 12 asserts the response leaks neither. Named by LABEL, never by value
// pattern: a regex for `acct_...` would pass just as happily against a response
// that leaked a differently-shaped identifier.

/** Grace Chapel's connected account — the one the church closed in Stripe. */
const GRACE_ACCOUNT_ID = 'acct_grace_closed_in_stripe';
/** Hope Church's account. Present so a cross-tenant leak would be visible. */
const HOPE_ACCOUNT_ID = 'acct_hope_healthy';
/** The platform's Stripe secret. Must never appear in any response body. */
const STRIPE_SECRET_KEY = 'sk_test_platform_secret_value';
/** What Stripe hands an Express holder. */
const LOGIN_LINK_URL = 'https://connect.stripe.com/express/acct_hope_healthy/session_one_time';
/** Where a Standard holder signs in with their own credentials. */
const STRIPE_DASHBOARD_URL = 'https://dashboard.stripe.com';
/** The reason a gone account answers with. */
const GONE_REASON = 'account_gone';

// ── Personas ────────────────────────────────────────────────────────────────

interface Persona {
  uid: string;
  email: string;
  decoded: Record<string, unknown>;
  userDoc: Record<string, unknown> | null;
}

/** tenants/grace.ownerId. */
const OWNER: Persona = {
  uid: 'owner1',
  email: 'owner@grace.org',
  decoded: { uid: 'owner1', email: 'owner@grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'admin' },
};

/** An ordinary member of the congregation. Never entitled to any of this. */
const MEMBER: Persona = {
  uid: 'member1',
  email: 'member@grace.org',
  decoded: { uid: 'member1', email: 'member@grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'user' },
};

/** A volunteer with the admin role. Ministry allows fifteen. Not the owner. */
const VOLUNTEER_ADMIN: Persona = {
  uid: 'volunteer1',
  email: 'volunteer@grace.org',
  decoded: { uid: 'volunteer1', email: 'volunteer@grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'admin' },
};

/** Owner of a DIFFERENT church, in good standing on their own. */
const OTHER_TENANT_OWNER: Persona = {
  uid: 'owner2',
  email: 'owner@hope.org',
  decoded: { uid: 'owner2', email: 'owner@hope.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'hope', role: 'admin' },
};

const ALL_PERSONAS = [OWNER, MEMBER, VOLUNTEER_ADMIN, OTHER_TENANT_OWNER];

function request(body: object, as: Persona | null): NextRequest {
  return new NextRequest('https://example.com/api/stripe/connect/login-link', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://theharvest.app',
      ...(as ? { authorization: `Bearer ${as.uid}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// ── Stripe fixtures, built from STRUCTURED fields only ──────────────────────

/**
 * A Stripe error as `stripe-node` surfaces it: a real `Error` carrying the
 * `type` / `code` / `statusCode` fields off the API response. The message is
 * supplied separately by each caller precisely so no implementation can lean on
 * it.
 */
function stripeError(fields: { type: string; code?: string; statusCode?: number; message: string }) {
  const error = new Error(fields.message) as Error & Record<string, unknown>;
  error.type = fields.type;
  if (fields.code !== undefined) error.code = fields.code;
  error.statusCode = fields.statusCode;
  error.raw = { type: fields.type, code: fields.code, message: fields.message };
  return error;
}

/**
 * 🔴 A CLOSED ACCOUNT. `accounts.retrieve` is typed to resolve an `Account` and
 * has no deleted-object return, so a deleted account can only throw — and it
 * throws an `invalid_request_error` with `code: 'resource_missing'`, a 404.
 */
function closedAccountError() {
  return stripeError({
    type: 'invalid_request_error',
    code: 'resource_missing',
    statusCode: 404,
    message: `No such account: '${GRACE_ACCOUNT_ID}'`,
  });
}

/** The other permanent id failure: the platform may not act on this account. */
function accountInvalidError() {
  return stripeError({
    type: 'invalid_request_error',
    code: 'account_invalid',
    statusCode: 403,
    message: 'The account ID provided is invalid.',
  });
}

/** A healthy account of the given type, as `accounts.retrieve` returns it. */
function healthyAccount(id: string, type: 'standard' | 'express') {
  return {
    id,
    type,
    details_submitted: true,
    charges_enabled: true,
    payouts_enabled: true,
    requirements: { currently_due: [], disabled_reason: null },
  };
}

/**
 * 🔴 A REJECTED ACCOUNT. It still retrieves — no error is thrown — so the only
 * signal is on the object: charges off, and a `requirements.disabled_reason` in
 * the `rejected.` namespace of Stripe's typed enum.
 */
function rejectedAccount(id: string, disabledReason: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'standard',
    details_submitted: true,
    charges_enabled: false,
    payouts_enabled: false,
    requirements: { currently_due: [], disabled_reason: disabledReason },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  process.env.STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';

  store.clear();
  commits.length = 0;
  callLog.length = 0;
  failCommit.value = false;

  for (const p of ALL_PERSONAS) {
    if (p.userDoc) store.set(`users/${p.uid}`, p.userDoc);
  }

  // 🔴 The pre-incident record, exactly as production held it: the church's
  // account is gone, and BOTH fields still describe it as a working one.
  store.set('tenants/grace', {
    name: 'Grace Chapel', plan: 'ultra', status: 'active',
    ownerId: OWNER.uid, stripeConnectStatus: 'active',
  });
  store.set('tenant_private/grace', {
    adminEmails: [], stripeConnectAccountId: GRACE_ACCOUNT_ID,
  });

  store.set('tenants/hope', {
    name: 'Hope Church', plan: 'ultra', status: 'active',
    ownerId: OTHER_TENANT_OWNER.uid, stripeConnectStatus: 'active',
  });
  store.set('tenant_private/hope', {
    adminEmails: [], stripeConnectAccountId: HOPE_ACCOUNT_ID,
  });

  mockVerifyIdToken.mockImplementation(async (token: string) => {
    const persona = ALL_PERSONAS.find((p) => p.uid === token);
    if (!persona) throw new Error('invalid token');
    return persona.decoded;
  });

  mockCreateLoginLink.mockResolvedValue({ object: 'login_link', url: LOGIN_LINK_URL });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every Stripe call that would create, alter or delete a connected account. */
function stripeAccountMutations() {
  return [
    ...mockAccountsCreate.mock.calls,
    ...mockAccountsUpdate.mock.calls,
    ...mockAccountsDel.mock.calls,
    ...mockAccountLinksCreate.mock.calls,
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Test 1 — 🔴 THE REGRESSION TEST. The whole ticket, in one assertion.
// ═══════════════════════════════════════════════════════════════════════════

describe('🔴 a closed account offers re-onboarding, not an error', () => {
  beforeEach(() => {
    mockAccountsRetrieve.mockRejectedValue(closedAccountError());
  });

  it('answers with an onboarding route instead of the 500 the church was stuck on', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

    // 🔴 Not a 500. The old answer said "Failed to open your Stripe dashboard",
    // which reads as transient and invites a retry that can never succeed.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onboardingRequired).toBe(true);
    expect(body.reason).toBe(GONE_REASON);
    expect(body.error).toBeUndefined();
    expect(body.url).toBeUndefined();
  });

  it('uses the shape the route already speaks, so PaymentSection needs no change', async () => {
    // The settings screen routes ANY `onboardingRequired` answer into the
    // connect flow. Answering in a new shape would have needed a client change
    // and left every deployed client showing the error dialog.
    const body = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json();

    expect(Object.keys(body).sort()).toEqual(['onboardingRequired', 'reason']);
    expect(body.onboardingRequired).toBe(true);
  });

  it('distinguishes itself from the two onboarding reasons that already existed', async () => {
    // `not_connected` (never had one) and `onboarding_incomplete` (has one,
    // unfinished) describe churches whose account is fine. This one HAD a
    // working account, which is a different story and needs its own reason.
    const gone = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json();
    expect(gone.reason).not.toBe('not_connected');
    expect(gone.reason).not.toBe('onboarding_incomplete');
  });

  it('answers the same way for the other permanent id failure', async () => {
    mockAccountsRetrieve.mockRejectedValue(accountInvalidError());

    const body = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json();

    expect(body.onboardingRequired).toBe(true);
    expect(body.reason).toBe(GONE_REASON);
  });

  it('🔴 never mints a link and never touches account lifecycle', async () => {
    await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(mockCreateLoginLink).not.toHaveBeenCalled();
    // The tempting bug: "account gone? make a new one." This route reports; it
    // does not provision. Account lifecycle belongs to /api/stripe/connect.
    expect(stripeAccountMutations()).toHaveLength(0);
  });

  it('recovers by itself on the second click, with no Firestore edit by hand', async () => {
    // The manual-fix defect, restated: after one click the record no longer
    // names a dead account, so the route answers without going to Stripe at all.
    await loginLink(request({ tenantId: 'grace' }, OWNER));
    mockAccountsRetrieve.mockClear();

    const second = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json();

    expect(second.onboardingRequired).toBe(true);
    expect(second.reason).toBe('not_connected');
    expect(mockAccountsRetrieve).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 2 — rejected: gone, by a different signal.
// ═══════════════════════════════════════════════════════════════════════════

describe('a rejected account offers re-onboarding', () => {
  // Every `rejected.*` member of Stripe's `requirements.disabled_reason` enum.
  const REJECTED_REASONS = [
    'rejected.fraud',
    'rejected.incomplete_verification',
    'rejected.listed',
    'rejected.other',
    'rejected.platform_fraud',
    'rejected.platform_other',
    'rejected.platform_terms_of_service',
    'rejected.terms_of_service',
  ];

  for (const reason of REJECTED_REASONS) {
    it(`offers re-onboarding for '${reason}'`, async () => {
      mockAccountsRetrieve.mockResolvedValue(rejectedAccount(GRACE_ACCOUNT_ID, reason));

      const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.onboardingRequired).toBe(true);
      expect(body.reason).toBe(GONE_REASON);
    });
  }

  it('🔴 no error is thrown for a rejected account — the object itself is the signal', async () => {
    // Stated because it is the reason this needs a second predicate at all: a
    // rejected account retrieves successfully, so the missing-account catch
    // never fires and an implementation that only handled errors would miss it.
    const account = rejectedAccount(GRACE_ACCOUNT_ID, 'rejected.fraud');
    mockAccountsRetrieve.mockResolvedValue(account);

    await expect(mockAccountsRetrieve(GRACE_ACCOUNT_ID)).resolves.toMatchObject({ charges_enabled: false });
    expect((await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json()).reason).toBe(GONE_REASON);
  });

  it('🔴 answers before the onboarding check, so a half-onboarded rejection is not sent back', async () => {
    // Order matters. `details_submitted: false` on a REJECTED account would have
    // produced `onboarding_incomplete`, which sends the church to a connect flow
    // that would hand it an account link Stripe will not honour.
    mockAccountsRetrieve.mockResolvedValue(
      rejectedAccount(GRACE_ACCOUNT_ID, 'rejected.terms_of_service', { details_submitted: false }),
    );

    const body = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json();

    expect(body.reason).toBe(GONE_REASON);
    expect(body.reason).not.toBe('onboarding_incomplete');
  });

  it('🔴 the real deriveConnectStatus agrees this is not an active account', async () => {
    // The `account.updated` webhook derives the tenant's status with this exact
    // function. If it called a rejected account 'active', the webhook would
    // re-publish `active` right after this route corrected the record — the two
    // paths describing one fact differently, which is THE-149's shape.
    const account = rejectedAccount(GRACE_ACCOUNT_ID, 'rejected.fraud');
    expect(deriveConnectStatus(account as never)).not.toBe('active');
  });

  it('🔴 a RESTRICTED account is NOT rejected — it keeps its dashboard', async () => {
    // A restricted church has real money in a real dashboard and that dashboard
    // is exactly where it goes to find out why payouts stopped. Its
    // `disabled_reason` sits outside the `rejected.` namespace, and reading it
    // as gone would lock a solvent church out of its own balance.
    mockAccountsRetrieve.mockResolvedValue({
      ...rejectedAccount(GRACE_ACCOUNT_ID, 'requirements.past_due'),
      type: 'express',
      requirements: {
        currently_due: ['individual.verification.document'],
        disabled_reason: 'requirements.past_due',
      },
    });

    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe(LOGIN_LINK_URL);
    expect(commits).toHaveLength(0);
  });

  it('🔴 a temporarily disabled account is NOT rejected either', async () => {
    // `under_review` and `platform_paused` are states an account comes back
    // from. Offering re-onboarding would tell a church to abandon an account
    // that is about to work again.
    for (const disabledReason of ['under_review', 'platform_paused', 'listed', 'other']) {
      mockAccountsRetrieve.mockResolvedValue({
        ...rejectedAccount(GRACE_ACCOUNT_ID, disabledReason),
        type: 'express',
      });

      const body = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json();

      expect(body.reason, `disabled_reason '${disabledReason}' must not read as gone`).toBeUndefined();
      expect(body.url).toBe(LOGIN_LINK_URL);
    }
    expect(commits).toHaveLength(0);
  });

  it('🔴 charges still enabled means not rejected, whatever the reason field says', async () => {
    // Two agreeing fields are a state; one is a stale payload. An account still
    // taking charges is not one to send through re-onboarding.
    mockAccountsRetrieve.mockResolvedValue(
      rejectedAccount(GRACE_ACCOUNT_ID, 'rejected.other', { charges_enabled: true }),
    );

    const body = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json();

    expect(body.reason).toBeUndefined();
    expect(body.url).toBe(STRIPE_DASHBOARD_URL);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 3 — 🔴 THE FAIL-OPEN GUARD. Worth exactly as much as test 1.
// ═══════════════════════════════════════════════════════════════════════════

describe('🔴 a transient Stripe failure is still a 500 that says try again', () => {
  /**
   * Every one of these is RETRYABLE. Turning any of them into "your account is
   * gone" would invite a church whose account works perfectly to re-onboard —
   * and re-onboarding mints a NEW account, so the congregation's money starts
   * landing somewhere else. That is a strictly worse defect than THE-148.
   *
   * ⚠️ Note the messages. Several of them say things a naive string match would
   * read as a missing account. The distinguishing information is entirely in
   * `type` and `code`.
   */
  const TRANSIENT_FAILURES: Array<{ label: string; error: Error }> = [
    {
      label: 'a network blip',
      // A StripeConnectionError carries no `code` and its own type. This is the
      // canonical "Stripe was briefly slow" case the ticket names.
      error: stripeError({
        type: 'StripeConnectionError',
        statusCode: undefined,
        message: 'An error occurred with our connection to Stripe. Request was retried 2 times.',
      }),
    },
    {
      label: 'a Stripe-side outage',
      error: stripeError({
        type: 'api_error',
        code: 'api_error',
        statusCode: 500,
        message: 'An unexpected error occurred.',
      }),
    },
    {
      label: 'a socket hang-up with no Stripe fields at all',
      error: Object.assign(new Error('socket hang up'), { syscall: 'read', errno: -104 }),
    },
    {
      label: 'a plain error whose message names a missing account',
      // 🔴 The string-match trap, stated as a fixture. This carries none of
      // Stripe's structured fields, so it is not evidence of anything.
      error: new Error(`No such account: '${GRACE_ACCOUNT_ID}'`),
    },
  ];

  for (const { label, error } of TRANSIENT_FAILURES) {
    it(`returns a 500 for ${label}`, async () => {
      mockAccountsRetrieve.mockRejectedValue(error);

      const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Failed to open your Stripe dashboard');
      // 🔴 And emphatically NOT an offer to re-onboard.
      expect(body.onboardingRequired).toBeUndefined();
      expect(body.reason).toBeUndefined();
    });

    it(`does not touch the record for ${label}`, async () => {
      mockAccountsRetrieve.mockRejectedValue(error);

      await loginLink(request({ tenantId: 'grace' }, OWNER));

      // 🔴 The church's account id survives a Stripe outage. Clearing it would
      // take a WORKING church's donate page down until someone re-onboarded.
      expect(commits).toHaveLength(0);
      expect(store.get('tenant_private/grace')).toMatchObject({ stripeConnectAccountId: GRACE_ACCOUNT_ID });
      expect(store.get('tenants/grace')).toMatchObject({ stripeConnectStatus: 'active' });
    });
  }

  it('🔴 a transient failure leaves giving exactly as available as it was', async () => {
    mockAccountsRetrieve.mockRejectedValue(TRANSIENT_FAILURES[0].error);
    const before = store.get('tenant_private/grace')!.stripeConnectAccountId;

    await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(store.get('tenant_private/grace')!.stripeConnectAccountId).toBe(before);
    expect(tenantAllows(store.get('tenants/grace')!.status, 'giving')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 4 — the two failures most easily mistaken for a missing account.
// ═══════════════════════════════════════════════════════════════════════════

describe('an auth or rate-limit failure is not treated as a missing account', () => {
  const MISTAKEABLE: Array<{ label: string; error: Error }> = [
    {
      label: 'an expired platform API key',
      // Reaches Stripe and is refused. Every account looks unreachable through a
      // dead key, so this is the failure most likely to be read as "they are all
      // gone" — and it would offer EVERY church re-onboarding at once.
      error: stripeError({
        type: 'authentication_error',
        code: 'api_key_expired',
        statusCode: 401,
        message: 'Expired API Key provided: sk_test_***',
      }),
    },
    {
      label: 'an invalid platform API key',
      error: stripeError({
        type: 'authentication_error',
        statusCode: 401,
        message: 'Invalid API Key provided',
      }),
    },
    {
      label: 'a rate limit',
      // 🔴 Message deliberately misleading: it names a missing account. Only the
      // `type` says what this really is.
      error: stripeError({
        type: 'rate_limit_error',
        code: 'rate_limit',
        statusCode: 429,
        message: `Too many requests — No such account: '${GRACE_ACCOUNT_ID}'`,
      }),
    },
    {
      label: 'an invalid_request_error with some OTHER code',
      // Same `type` as a missing account, different `code`. The predicate has to
      // read both, not just the family.
      error: stripeError({
        type: 'invalid_request_error',
        code: 'parameter_unknown',
        statusCode: 400,
        message: 'Received unknown parameter',
      }),
    },
  ];

  for (const { label, error } of MISTAKEABLE) {
    it(`returns a 500 for ${label} and preserves the stored id`, async () => {
      mockAccountsRetrieve.mockRejectedValue(error);

      const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

      expect(res.status).toBe(500);
      expect((await res.json()).onboardingRequired).toBeUndefined();
      expect(store.get('tenant_private/grace')).toMatchObject({ stripeConnectAccountId: GRACE_ACCOUNT_ID });
      expect(commits).toHaveLength(0);
    });
  }

  it('🔴 the auth failure would have hit every church, not one', async () => {
    // Restating the blast radius: a dead platform key fails for Grace and Hope
    // alike. If that read as "gone", every church on the platform would be
    // offered a fresh Stripe account on the same afternoon.
    mockAccountsRetrieve.mockRejectedValue(MISTAKEABLE[0].error);

    expect((await loginLink(request({ tenantId: 'grace' }, OWNER))).status).toBe(500);
    expect((await loginLink(request({ tenantId: 'hope' }, OTHER_TENANT_OWNER))).status).toBe(500);
    expect(commits).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests 5-7 — nothing that worked before stopped working.
// ═══════════════════════════════════════════════════════════════════════════

describe('a healthy Standard account still reaches the dashboard', () => {
  beforeEach(() => {
    mockAccountsRetrieve.mockImplementation(async (id: string) => healthyAccount(id, 'standard'));
  });

  it('hands back the Stripe Dashboard URL', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe(STRIPE_DASHBOARD_URL);
  });

  it('writes nothing — a working account is not a record to correct', async () => {
    await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(commits).toHaveLength(0);
    expect(store.get('tenant_private/grace')).toMatchObject({ stripeConnectAccountId: GRACE_ACCOUNT_ID });
    expect(store.get('tenants/grace')).toMatchObject({ stripeConnectStatus: 'active' });
  });
});

describe('a healthy Express account still gets a login link', () => {
  beforeEach(() => {
    // ⚠️ Affiliate payout accounts are still Express and pre-switch accounts
    // cannot be converted, because Stripe fixes the type at creation. This
    // branch is those churches' only way in.
    mockAccountsRetrieve.mockImplementation(async (id: string) => healthyAccount(id, 'express'));
  });

  it('mints a link for this church and nothing else', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe(LOGIN_LINK_URL);
    expect(mockCreateLoginLink).toHaveBeenCalledWith(GRACE_ACCOUNT_ID);
    expect(commits).toHaveLength(0);
  });

  it('and is not sent to the dashboard login wall it can never pass', async () => {
    const body = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json();
    expect(body.url).not.toContain('dashboard.stripe.com');
  });
});

describe('an account mid-onboarding still returns onboarding_incomplete', () => {
  it('answers onboarding_incomplete, not account_gone', async () => {
    // A church that walked away part-way through has an account that is fine —
    // just unfinished. Telling it the account is gone would be wrong, and would
    // clear an id it is still going to use.
    mockAccountsRetrieve.mockResolvedValue({
      ...healthyAccount(GRACE_ACCOUNT_ID, 'standard'),
      details_submitted: false,
      charges_enabled: false,
      payouts_enabled: false,
    });

    const body = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json();

    expect(body.onboardingRequired).toBe(true);
    expect(body.reason).toBe('onboarding_incomplete');
    expect(body.reason).not.toBe(GONE_REASON);
  });

  it('🔴 keeps the id it is about to finish onboarding', async () => {
    mockAccountsRetrieve.mockResolvedValue({
      ...healthyAccount(GRACE_ACCOUNT_ID, 'express'),
      details_submitted: false,
      charges_enabled: false,
      payouts_enabled: false,
    });

    await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(commits).toHaveLength(0);
    expect(store.get('tenant_private/grace')).toMatchObject({ stripeConnectAccountId: GRACE_ACCOUNT_ID });
  });

  it('a never-connected tenant is still not_connected', async () => {
    store.set('tenant_private/grace', { adminEmails: [] });

    const body = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json();

    expect(body.reason).toBe('not_connected');
    expect(mockAccountsRetrieve).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 8 — 🔴 THE MORE DANGEROUS HALF. The record stops lying.
// ═══════════════════════════════════════════════════════════════════════════

describe('🔴 a stored id for a missing account no longer reports giving as available', () => {
  beforeEach(() => {
    mockAccountsRetrieve.mockRejectedValue(closedAccountError());
  });

  it('the record really did lie beforehand — otherwise this block proves nothing', () => {
    // The pre-incident state: a world-readable doc saying `active`, and an id
    // pointing at an account Stripe has already closed.
    expect(store.get('tenants/grace')).toMatchObject({ stripeConnectStatus: 'active' });
    expect(store.get('tenant_private/grace')).toMatchObject({ stripeConnectAccountId: GRACE_ACCOUNT_ID });
  });

  it('🔴 clears the authoritative field — the id no account can be charged through', async () => {
    // `tenant_private.stripeConnectAccountId` is the field `/api/stripe/donate`
    // reads to decide whether a gift can be taken at all, and the account every
    // direct charge is scoped to. It is the fact; everything else is derived.
    await loginLink(request({ tenantId: 'grace' }, OWNER));

    const priv = store.get('tenant_private/grace')!;
    expect('stripeConnectAccountId' in priv).toBe(false);
    // Absent, not blanked to a falsy-looking value that a `where(...)` query or
    // a `typeof` check could still trip over.
    expect(priv.stripeConnectAccountId).toBeUndefined();
  });

  it('🔴 clears the world-readable status that said giving worked', async () => {
    await loginLink(request({ tenantId: 'grace' }, OWNER));

    const tenant = store.get('tenants/grace')!;
    expect('stripeConnectStatus' in tenant).toBe(false);
    expect(tenant.stripeConnectStatus).not.toBe('active');
  });

  it('🔴 moves both fields in ONE batch, so neither can outlive the other', async () => {
    // Two fields describing one fact, written separately, is how THE-149
    // happened: the derived field survived the fact it derived from.
    await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(commits).toHaveLength(1);
    const paths = commits[0].map((op) => op.path).sort();
    expect(paths).toEqual(['tenant_private/grace', 'tenants/grace']);
  });

  it('leaves everything else on both documents untouched', async () => {
    await loginLink(request({ tenantId: 'grace' }, OWNER));

    // The correction forgets one account. It is not a tenant reset.
    expect(store.get('tenants/grace')).toMatchObject({
      name: 'Grace Chapel', plan: 'ultra', status: 'active', ownerId: OWNER.uid,
    });
    expect(store.get('tenant_private/grace')).toMatchObject({ adminEmails: [] });
  });

  it('🔴 the corrected record no longer offers Manage — the settings screen self-heals', async () => {
    // PaymentSection renders "Manage Stripe Dashboard" only for `active`,
    // "Complete Onboarding" for `pending`, and "Connect Stripe Account"
    // otherwise. There is nothing left to complete, so Connect is the honest
    // control and an absent field is what produces it.
    await loginLink(request({ tenantId: 'grace' }, OWNER));

    const status = store.get('tenants/grace')!.stripeConnectStatus;
    expect(status).not.toBe('active');
    expect(status).not.toBe('pending');
    expect(status).toBeUndefined();
  });

  it('🔴 a donation can no longer resolve an account to charge', async () => {
    // The donate route reads this same field and refuses when it is absent.
    // Before the correction it would have scoped a direct charge to a closed
    // account; afterwards there is nothing to scope it to.
    await loginLink(request({ tenantId: 'grace' }, OWNER));

    const connectAccountId = store.get('tenant_private/grace')!.stripeConnectAccountId;
    expect(connectAccountId).toBeFalsy();
  });

  it('does not touch any other tenant', async () => {
    await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(store.get('tenant_private/hope')).toMatchObject({ stripeConnectAccountId: HOPE_ACCOUNT_ID });
    expect(store.get('tenants/hope')).toMatchObject({ stripeConnectStatus: 'active' });
  });

  it('🔴 does not touch the affiliate mirror', async () => {
    // Affiliate payouts resolve `users/{uid}.affiliateStripeAccountId` — a
    // different field on a different document, owned by /api/stripe/connect and
    // /api/affiliate/onboard. Repointing a payout account is the affiliate
    // payout model's business, not this route's.
    store.set(`users/${OWNER.uid}`, {
      ...OWNER.userDoc,
      affiliateStripeAccountId: GRACE_ACCOUNT_ID,
      affiliateConnectStatus: 'active',
    });

    await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(store.get(`users/${OWNER.uid}`)).toMatchObject({
      affiliateStripeAccountId: GRACE_ACCOUNT_ID,
      affiliateConnectStatus: 'active',
    });
    expect(commits[0].some((op) => op.path.startsWith('users/'))).toBe(false);
  });

  it('corrects a REJECTED account the same way', async () => {
    mockAccountsRetrieve.mockResolvedValue(rejectedAccount(GRACE_ACCOUNT_ID, 'rejected.fraud'));

    await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(store.get('tenant_private/grace')!.stripeConnectAccountId).toBeUndefined();
    expect(store.get('tenants/grace')!.stripeConnectStatus).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 9 — the bookkeeping is downstream of the answer, never in front of it.
// ═══════════════════════════════════════════════════════════════════════════

describe('correcting the record never delays or changes the response', () => {
  beforeEach(() => {
    mockAccountsRetrieve.mockRejectedValue(closedAccountError());
  });

  /**
   * 🔴 THE ORDERING ASSERTION, and the one that fails if the correction is made
   * blocking.
   *
   * `NextResponse.json` is spied so the moment the answer is FORMED can be
   * compared against the moment the write is attempted. The answer must be fully
   * built — decided, serialized, final — before the batch commits. An
   * implementation that awaits the write and then decides what to say has made
   * the church's answer depend on Firestore, which is precisely the dependency
   * that must not exist on a route whose whole job is to stop saying "try
   * again".
   *
   * ⚠️ The write IS awaited before the handler returns, deliberately: a promise
   * left dangling past `return` is not guaranteed to run on a serverless
   * runtime, and a correction that is usually dropped would leave the
   * world-readable doc reporting `active` forever — THE-148 again. What this
   * test pins is that the answer never WAITS ON THE OUTCOME: it exists in final
   * form first, and no result or failure of the write can alter it.
   */
  it('🔴 forms the answer before the write is attempted, not after', async () => {
    const realJson = NextResponse.json.bind(NextResponse);
    vi.spyOn(NextResponse, 'json').mockImplementation(((body: never, init: never) => {
      callLog.push('answer');
      return realJson(body, init);
    }) as never);

    await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(callLog).toContain('answer');
    expect(callLog).toContain('commit');
    // 🔴 Answer first. Always.
    expect(callLog.indexOf('answer')).toBeLessThan(callLog.indexOf('commit'));
  });

  it('🔴 the response is byte-identical whether the write succeeds or fails', async () => {
    const succeeded = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).text();

    store.set('tenant_private/grace', { adminEmails: [], stripeConnectAccountId: GRACE_ACCOUNT_ID });
    store.set('tenants/grace', {
      name: 'Grace Chapel', plan: 'ultra', status: 'active',
      ownerId: OWNER.uid, stripeConnectStatus: 'active',
    });
    failCommit.value = true;

    const failed = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).text();

    expect(failed).toBe(succeeded);
  });

  it('the status is the same too, and carries no trace of the write', async () => {
    const ok = await loginLink(request({ tenantId: 'grace' }, OWNER));
    expect(ok.status).toBe(200);

    // Put the church back in its pre-correction state so the second call is the
    // SAME call, differing only in whether the bookkeeping lands.
    store.set('tenant_private/grace', { adminEmails: [], stripeConnectAccountId: GRACE_ACCOUNT_ID });
    failCommit.value = true;
    const broken = await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(broken.status).toBe(200);
    expect(await broken.json()).toEqual({ onboardingRequired: true, reason: GONE_REASON });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 10 — bookkeeping is best-effort. It never becomes the church's problem.
// ═══════════════════════════════════════════════════════════════════════════

describe('a failure to correct the record does not 500 the route', () => {
  beforeEach(() => {
    mockAccountsRetrieve.mockRejectedValue(closedAccountError());
    failCommit.value = true;
  });

  it('🔴 still offers re-onboarding when Firestore is unavailable', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

    // The whole point of the ticket is that this church stops seeing an error.
    // A bookkeeping failure turning it back into a 500 would put them right
    // back where they started.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ onboardingRequired: true, reason: GONE_REASON });
  });

  it('a failed correction is retried by the next click — the detection is stateless', async () => {
    await loginLink(request({ tenantId: 'grace' }, OWNER));
    // Nothing landed, so the record still names the dead account…
    expect(store.get('tenant_private/grace')).toMatchObject({ stripeConnectAccountId: GRACE_ACCOUNT_ID });

    // …and the next click re-derives the same answer from Stripe and tries again.
    failCommit.value = false;
    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(200);
    expect((await res.json()).reason).toBe(GONE_REASON);
    expect(store.get('tenant_private/grace')!.stripeConnectAccountId).toBeUndefined();
  });

  it('the same holds for a rejected account', async () => {
    mockAccountsRetrieve.mockResolvedValue(rejectedAccount(GRACE_ACCOUNT_ID, 'rejected.listed'));

    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(200);
    expect((await res.json()).reason).toBe(GONE_REASON);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 11 — 🔴 the gate did not get weaker to make room for any of this.
// ═══════════════════════════════════════════════════════════════════════════

describe('🔴 requireOwner still gates the route', () => {
  beforeEach(() => {
    mockAccountsRetrieve.mockRejectedValue(closedAccountError());
  });

  it('refuses an ordinary member of the church that owns the account', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, MEMBER));

    // 403, not 401: they ARE authenticated and they ARE a member. A tenant-match
    // gate would have let them straight through, which is why this route does
    // not use one — a login link is the power to change where money lands.
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Owner access required');
  });

  it('refuses a volunteer admin — the admin ROLE is not owner-equivalent', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, VOLUNTEER_ADMIN));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Owner access required');
  });

  it("refuses another church's owner naming this church", async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, OTHER_TENANT_OWNER));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Access denied to this tenant');
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, null));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
  });

  it('🔴 a refused caller reaches neither Stripe nor the record', async () => {
    for (const persona of [MEMBER, VOLUNTEER_ADMIN, OTHER_TENANT_OWNER, null]) {
      await loginLink(request({ tenantId: 'grace' }, persona));
    }

    expect(mockAccountsRetrieve).not.toHaveBeenCalled();
    // 🔴 The correction is a WRITE to a world-readable doc. A member being able
    // to trigger it would be a member able to switch off their church's giving.
    expect(commits).toHaveLength(0);
    expect(store.get('tenant_private/grace')).toMatchObject({ stripeConnectAccountId: GRACE_ACCOUNT_ID });
    expect(store.get('tenants/grace')).toMatchObject({ stripeConnectStatus: 'active' });
  });

  it('🔴 church A cannot make church B forget its account', async () => {
    // Grace's owner names Hope, whose account is closed. Neither Hope's Stripe
    // account nor Hope's record may be reached on this caller's behalf.
    store.set('tenant_private/hope', { adminEmails: [], stripeConnectAccountId: HOPE_ACCOUNT_ID });

    const res = await loginLink(request({ tenantId: 'hope' }, OWNER));

    expect(res.status).toBe(403);
    expect(mockAccountsRetrieve).not.toHaveBeenCalledWith(HOPE_ACCOUNT_ID);
    expect(store.get('tenant_private/hope')).toMatchObject({ stripeConnectAccountId: HOPE_ACCOUNT_ID });
  });

  it('the owner of the OTHER church still succeeds on their own — scope, not identity', async () => {
    mockAccountsRetrieve.mockImplementation(async (id: string) => healthyAccount(id, 'express'));

    const res = await loginLink(request({ tenantId: 'hope' }, OTHER_TENANT_OWNER));

    expect(res.status).toBe(200);
    expect(mockCreateLoginLink).toHaveBeenCalledWith(HOPE_ACCOUNT_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 12 — the new answers leak nothing the old ones did not.
// ═══════════════════════════════════════════════════════════════════════════

describe('no account id or Stripe key reaches the client', () => {
  it('🔴 the closed-account answer carries exactly two keys and neither secret', async () => {
    // Stripe errors quote the offending id straight back — this fixture's
    // message contains it — so echoing a provider message into a response is
    // exactly how a server-only identifier would escape.
    mockAccountsRetrieve.mockRejectedValue(closedAccountError());

    const raw = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).text();

    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['onboardingRequired', 'reason']);
    expect(raw).not.toContain(GRACE_ACCOUNT_ID);
    expect(raw).not.toContain(STRIPE_SECRET_KEY);
  });

  it('the rejected-account answer leaks neither either', async () => {
    mockAccountsRetrieve.mockResolvedValue(rejectedAccount(GRACE_ACCOUNT_ID, 'rejected.platform_fraud'));

    const raw = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).text();

    expect(raw).not.toContain(GRACE_ACCOUNT_ID);
    expect(raw).not.toContain(STRIPE_SECRET_KEY);
  });

  it('🔴 nor does the reason name the rejection — that is between Stripe and the church', async () => {
    // `rejected.fraud` in a response body is an accusation the platform has no
    // business relaying, and the client does nothing with it anyway.
    mockAccountsRetrieve.mockResolvedValue(rejectedAccount(GRACE_ACCOUNT_ID, 'rejected.fraud'));

    const raw = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).text();

    expect(raw).not.toContain('rejected.fraud');
    expect(raw).not.toContain('fraud');
  });

  it('the 500 paths leak neither, even when the message names them', async () => {
    mockAccountsRetrieve.mockRejectedValue(
      stripeError({
        type: 'rate_limit_error',
        code: 'rate_limit',
        statusCode: 429,
        message: `Too many requests for ${GRACE_ACCOUNT_ID} with key ${STRIPE_SECRET_KEY}`,
      }),
    );

    const raw = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).text();

    expect(raw).not.toContain(GRACE_ACCOUNT_ID);
    expect(raw).not.toContain(STRIPE_SECRET_KEY);
  });

  it('a failed correction leaks nothing when it reports the failure', async () => {
    mockAccountsRetrieve.mockRejectedValue(closedAccountError());
    failCommit.value = true;

    const raw = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).text();

    expect(raw).not.toContain(GRACE_ACCOUNT_ID);
    expect(raw).not.toContain(STRIPE_SECRET_KEY);
  });
});

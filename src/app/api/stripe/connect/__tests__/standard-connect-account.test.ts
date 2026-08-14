import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type Stripe from 'stripe';

/**
 * THE-145 PR 2 — a church gets its OWN Stripe account, not an Express shell.
 *
 * 🔴 The problem this closes. PR 1 (#316) made donations DIRECT charges, so
 * Stripe now debits a disputed gift from the CHURCH's balance. Stripe pairs
 * direct charges with Standard accounts, not Express: an Express holder has no
 * Stripe credentials and only the Express Dashboard, where refunds and disputes
 * are features the PLATFORM may or may not switch on. That combination puts the
 * money on the church and the tools on Harvest. A Standard account is the
 * church's own real Stripe account — its own disputes, refunds, records, and
 * Stripe collecting fees from it directly.
 *
 * ⚠️ THIS SUITE DELIBERATELY DOES NOT MOCK `@/lib/api-auth` OR
 * `@/lib/stripe-connect-status`, for the reason `express-login-link` does not:
 * a mocked gate cannot fail to read a roster it never touches, and a mocked
 * derivation cannot misclassify an account type it never sees. The real
 * `requireAuth`/`requireOwner` and the real `deriveConnectStatus` run; only
 * Stripe and Firebase are mocked beneath them.
 */

// ── Stripe ──────────────────────────────────────────────────────────────────
const { mockAccountsCreate, mockAccountLinksCreate } = vi.hoisted(() => ({
  mockAccountsCreate: vi.fn(),
  mockAccountLinksCreate: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    accounts = { create: mockAccountsCreate };
    accountLinks = { create: mockAccountLinksCreate };
  },
}));

// ── Firebase, beneath the real auth helpers ─────────────────────────────────
const { mockVerifyIdToken, firestore, firestoreWrites } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  /** `${collection}/${id}` → document data. Absent key = document missing. */
  firestore: new Map<string, any>(),
  firestoreWrites: [] as Array<{ op: string; path: string; data?: unknown }>,
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminAuth: { verifyIdToken: mockVerifyIdToken },
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        __coll: name,
        id,
        get: async () => {
          const data = firestore.get(`${name}/${id}`);
          return { exists: data !== undefined, id, data: () => data };
        },
        set: async (data: unknown) => { firestoreWrites.push({ op: 'set', path: `${name}/${id}`, data }); },
        update: async (data: unknown) => { firestoreWrites.push({ op: 'update', path: `${name}/${id}`, data }); },
      }),
      // Only the affiliate-code uniqueness probe queries; nothing collides.
      where() { return this; },
      limit() { return this; },
      get: async () => ({ size: 0, empty: true, docs: [] }),
    }),
    batch: () => ({
      set: (ref: any, data: unknown) => {
        firestoreWrites.push({ op: 'batch.set', path: `${ref?.__coll}/${ref?.id}`, data });
      },
      update: (ref: any, data: unknown) => {
        firestoreWrites.push({ op: 'batch.update', path: `${ref?.__coll}/${ref?.id}`, data });
      },
      commit: async () => { firestoreWrites.push({ op: 'batch.commit', path: '' }); },
    }),
  },
}));

const { tenantPrivate, tenantPrivateWrites } = vi.hoisted(() => ({
  tenantPrivate: new Map<string, any>(),
  tenantPrivateWrites: [] as Array<{ id: string; data: unknown }>,
}));
vi.mock('@/lib/tenant-private', () => ({
  getTenantPrivate: async (id: string) => tenantPrivate.get(id) ?? {},
  tenantPrivateRef: (id: string) => ({
    __coll: 'tenant_private',
    id,
    set: async (data: unknown) => { tenantPrivateWrites.push({ id, data }); },
  }),
  TENANT_PRIVATE_COLLECTION: 'tenant_private',
  DODO_ON_HOLD_FIELD: 'dodoOnHoldAt',
}));

const { POST: connect } = await import('@/app/api/stripe/connect/route');
const { POST: affiliateOnboard } = await import('@/app/api/affiliate/onboard/route');
// 🔴 The REAL derivation. Test 6 is only worth something because of this line.
const { deriveConnectStatus } = await import('@/lib/stripe-connect-status');

// ── Named fixtures ──────────────────────────────────────────────────────────
//
// Test 9 asserts the response leaks neither of these, BY LABEL — a regex for
// `acct_...` would pass just as happily against a differently-shaped identifier.

/** The account Stripe hands back for a newly-created church account. */
const NEW_CHURCH_ACCOUNT_ID = 'acct_grace_new';
/** Grace's account, for the already-connected branch. */
const EXISTING_CHURCH_ACCOUNT_ID = 'acct_grace_existing';
/** The account Stripe hands back for a payout-only affiliate. */
const AFFILIATE_ACCOUNT_ID = 'acct_affiliate_payouts';
/** The platform's Stripe secret. Must never appear in any response body. */
const STRIPE_SECRET_KEY = 'sk_test_platform_secret_value';
/**
 * The onboarding URL Stripe mints. Deliberately carries NO account id, so
 * test 9's "the id is not in the body" assertion cannot pass by accident.
 */
const ONBOARDING_URL = 'https://connect.stripe.com/setup/s/onboarding_session';

// ── Personas ────────────────────────────────────────────────────────────────

interface Persona {
  /** Bearer token value; also the uid. */
  uid: string;
  email: string;
  decoded: Record<string, unknown>;
  userDoc: Record<string, unknown> | null;
}

/** The buyer: tenants/grace.ownerId. */
const OWNER: Persona = {
  uid: 'owner1',
  email: 'owner@grace.org',
  decoded: { uid: 'owner1', email: 'owner@grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'admin' },
};

/** An ordinary member — anyone who signed up through the church's subdomain. */
const MEMBER: Persona = {
  uid: 'member1',
  email: 'member@grace.org',
  decoded: { uid: 'member1', email: 'member@grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'user' },
};

/** Owner of a DIFFERENT tenant, in good standing on their own. */
const OTHER_TENANT_OWNER: Persona = {
  uid: 'owner2',
  email: 'owner@hope.org',
  decoded: { uid: 'owner2', email: 'owner@hope.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'hope', role: 'admin' },
};

/** An ordinary member of the OTHER tenant. Authenticated, just not theirs. */
const OTHER_TENANT_MEMBER: Persona = {
  uid: 'member2',
  email: 'member@hope.org',
  decoded: { uid: 'member2', email: 'member@hope.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'hope', role: 'user' },
};

/**
 * 🔴 THE PAYOUT-ONLY AFFILIATE. No tenant at all — they refer churches and
 * receive transfers. They never take a charge, so nothing about direct charges,
 * disputes or merchant-of-record applies to them, and Standard would be the
 * wrong shape (and a different authorization model). Test 2 exists for them.
 */
const TENANTLESS_AFFILIATE: Persona = {
  uid: 'affiliate1',
  email: 'affiliate@example.com',
  decoded: { uid: 'affiliate1', email: 'affiliate@example.com', auth_time: 1700000000 },
  userDoc: { role: 'user' }, // no tenantId
};

const ALL_PERSONAS = [OWNER, MEMBER, OTHER_TENANT_OWNER, OTHER_TENANT_MEMBER, TENANTLESS_AFFILIATE];

function request(url: string, body: object | null, as: Persona | null): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://theharvest.app',
      ...(as ? { authorization: `Bearer ${as.uid}` } : {}),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
}

const connectRequest = (body: object | null, as: Persona | null) =>
  request('https://theharvest.app/api/stripe/connect', body, as);
const affiliateRequest = (as: Persona | null) =>
  request('https://theharvest.app/api/affiliate/onboard', {}, as);

/** The `accounts.create` params from the Nth call, so assertions read by name. */
const accountCreateParams = (n = 0) => mockAccountsCreate.mock.calls[n]?.[0] ?? {};

/**
 * Every write that reached `tenant_private/{tenantId}` — through the batch
 * (which is how both routes persist the Connect account id) or through the ref
 * directly. Asserting on one or the other alone would miss the real write.
 */
const privateWritesFor = (tenantId: string): unknown[] => [
  ...firestoreWrites.filter((w) => w.path === `tenant_private/${tenantId}`).map((w) => w.data),
  ...tenantPrivateWrites.filter((w) => w.id === tenantId).map((w) => w.data),
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';

  firestore.clear();
  tenantPrivate.clear();
  firestoreWrites.length = 0;
  tenantPrivateWrites.length = 0;

  for (const p of ALL_PERSONAS) {
    if (p.userDoc) firestore.set(`users/${p.uid}`, p.userDoc);
  }

  firestore.set('tenants/grace', {
    name: 'Grace Chapel', plan: 'ultra', status: 'active', ownerId: OWNER.uid,
  });
  firestore.set('tenants/hope', {
    name: 'Hope Church', plan: 'ultra', status: 'active', ownerId: OTHER_TENANT_OWNER.uid,
  });

  // Neither church has connected yet — the branch that CREATES an account.
  tenantPrivate.set('grace', { adminEmails: [] });
  tenantPrivate.set('hope', { adminEmails: [] });

  mockVerifyIdToken.mockImplementation(async (token: string) => {
    const persona = ALL_PERSONAS.find((p) => p.uid === token);
    if (!persona) throw new Error('invalid token');
    return persona.decoded;
  });

  mockAccountsCreate.mockResolvedValue({ id: NEW_CHURCH_ACCOUNT_ID });
  mockAccountLinksCreate.mockResolvedValue({ url: ONBOARDING_URL });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 1 — the whole point of the ticket.
// ═══════════════════════════════════════════════════════════════════════════

describe('a new connected account is created as Standard', () => {
  it('🔴 creates the church account with type standard', async () => {
    const res = await connect(connectRequest({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(200);
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    // Named by parameter, not matched loosely: this one word is the ticket.
    expect(accountCreateParams().type).toBe('standard');
    // And explicitly NOT the shell it replaces. Stated separately so a revert
    // fails here by name rather than on a vague object mismatch.
    expect(accountCreateParams().type).not.toBe('express');
  });

  it('is still the tenant account: same metadata, same persistence, same status', async () => {
    const res = await connect(connectRequest({ tenantId: 'grace' }, OWNER));
    expect(res.status).toBe(200);

    // The account type changed. Nothing about WHICH tenant owns it did.
    expect(accountCreateParams().metadata).toMatchObject({ tenantId: 'grace', app: 'harvest' });

    // 🔴 The id still lands on the server-only private doc, never the public one.
    expect(privateWritesFor('grace')).toContainEqual(
      expect.objectContaining({ stripeConnectAccountId: NEW_CHURCH_ACCOUNT_ID }),
    );
    expect(firestoreWrites).toContainEqual(
      expect.objectContaining({
        op: 'batch.update',
        path: 'tenants/grace',
        data: expect.objectContaining({ stripeConnectStatus: 'pending' }),
      }),
    );
    // The public tenant doc carries the status and NOT the id.
    const publicWrites = firestoreWrites.filter((w) => w.path === 'tenants/grace');
    for (const w of publicWrites) {
      expect(w.data).not.toHaveProperty('stripeConnectAccountId');
    }
  });

  it('🔴 onboards it with an account link — Standard needs no OAuth', async () => {
    // Stripe documents account links as "the recommended method for creating
    // standard accounts": create with type standard, then send the holder
    // through Connect Onboarding. OAuth is for claiming an EXISTING account and
    // is a different flow entirely. If this ever stops working, onboarding is
    // broken and no church can connect.
    const res = await connect(connectRequest({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: ONBOARDING_URL });
    expect(mockAccountLinksCreate).toHaveBeenCalledTimes(1);
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ account: NEW_CHURCH_ACCOUNT_ID, type: 'account_onboarding' }),
    );
  });

  it('uses an account link for an ALREADY-connected tenant too, creating nothing', async () => {
    // The second `accountLinks.create` call site. An existing (Express) account
    // still gets a fresh onboarding link — the type switch must not have turned
    // "resume onboarding" into "mint a second account".
    tenantPrivate.set('grace', { adminEmails: [], stripeConnectAccountId: EXISTING_CHURCH_ACCOUNT_ID });

    const res = await connect(connectRequest({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(200);
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ account: EXISTING_CHURCH_ACCOUNT_ID, type: 'account_onboarding' }),
    );
  });

  it('creates nothing at all when Stripe is not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const res = await connect(connectRequest({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(500);
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(tenantPrivateWrites).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 2 — 🔴 THE REGRESSION TEST. Worth more than test 1.
// ═══════════════════════════════════════════════════════════════════════════

// ⚠️ Scope note (THE-147): "affiliate accounts" here means the PAYOUT-ONLY,
// tenant-less recipient. The tenant-backstop case further down shares this
// route but creates the tenant's DONATIONS account, and is Standard.
describe('🔴 payout-only affiliate accounts are still created as Express', () => {
  it('a payout-only affiliate with no tenant still gets an Express account', async () => {
    mockAccountsCreate.mockResolvedValue({ id: AFFILIATE_ACCOUNT_ID });

    const res = await affiliateOnboard(affiliateRequest(TENANTLESS_AFFILIATE));

    expect(res.status).toBe(200);
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    // 🔴 Express, and it must stay Express. This recipient receives transfers
    // and takes no charges: none of the direct-charge/dispute-liability
    // reasoning behind test 1 applies, and switching them would be a separate
    // authorization model, not a one-word change.
    expect(accountCreateParams().type).toBe('express');
    expect(accountCreateParams().type).not.toBe('standard');
    // Identified by the role label the route stamps, not by an id pattern.
    expect(accountCreateParams().metadata).toMatchObject({ role: 'affiliate', app: 'harvest' });
  });

  it('the affiliate account is persisted to the user, not to any tenant', async () => {
    mockAccountsCreate.mockResolvedValue({ id: AFFILIATE_ACCOUNT_ID });

    await affiliateOnboard(affiliateRequest(TENANTLESS_AFFILIATE));

    expect(firestoreWrites).toContainEqual(
      expect.objectContaining({
        op: 'set',
        path: `users/${TENANTLESS_AFFILIATE.uid}`,
        data: expect.objectContaining({ affiliateStripeAccountId: AFFILIATE_ACCOUNT_ID }),
      }),
    );
    // No tenant is touched — this recipient has none.
    expect(tenantPrivateWrites).toEqual([]);
  });

  it('🔴 the unified-account backstop now creates Standard too — the gap is CLOSED', async () => {
    // ⚠️ THIS ASSERTION WAS DELIBERATELY FLIPPED BY THE-147. Read before editing.
    //
    // `/api/affiliate/onboard` has a second `accounts.create` call: when the
    // caller DOES belong to a tenant that has not connected yet, it creates the
    // account and writes it to `tenant_private.stripeConnectAccountId` — i.e.
    // the tenant's canonical DONATIONS account, the one `/api/stripe/donate`
    // charges. So this path, unlike the one above, is not payout-only despite
    // living in the affiliate route.
    //
    // THE-145 PR 2 (#317) left that site on 'express' and pinned it here, with
    // the note that "the follow-up that closes it has to change this line
    // deliberately". THE-147 is that follow-up: a church owner who clicked
    // "become an affiliate" BEFORE "connect Stripe" was minting an EXPRESS
    // donations account and then taking direct charges on it — the exact pairing
    // #317 exists to eliminate. The line below is that deliberate change.
    //
    // 🔴 The two creation sites must now AGREE. This assertion is one half of
    // that; `affiliate-onboard-standard-account.test.ts` ("both creation paths
    // agree") pins them against each other directly.
    tenantPrivate.set('grace', { adminEmails: [] }); // Grace has not connected
    mockAccountsCreate.mockResolvedValue({ id: NEW_CHURCH_ACCOUNT_ID });

    const res = await affiliateOnboard(affiliateRequest(OWNER));

    expect(res.status).toBe(200);
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    expect(accountCreateParams().type).toBe('standard');
    expect(accountCreateParams().type).not.toBe('express');
    // …and it really is the donations account, which is what made it a defect.
    expect(privateWritesFor('grace')).toContainEqual(
      expect.objectContaining({ stripeConnectAccountId: NEW_CHURCH_ACCOUNT_ID }),
    );
  });

  it('reuses a connected tenant account instead of minting a second one', async () => {
    tenantPrivate.set('grace', { adminEmails: [], stripeConnectAccountId: EXISTING_CHURCH_ACCOUNT_ID });

    const res = await affiliateOnboard(affiliateRequest(OWNER));

    expect(res.status).toBe(200);
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 6 — status derivation, against the REAL helper.
// ═══════════════════════════════════════════════════════════════════════════

describe('status derivation classifies a Standard account correctly', () => {
  /** A Standard account as `accounts.retrieve` returns it. */
  const standardAccount = (overrides: Partial<Stripe.Account> = {}) => ({
    id: NEW_CHURCH_ACCOUNT_ID,
    type: 'standard',
    details_submitted: true,
    charges_enabled: true,
    payouts_enabled: true,
    requirements: { currently_due: [] },
    ...overrides,
  }) as Stripe.Account;

  it('🔴 a fully-onboarded Standard account is active — the donate page opens', async () => {
    // `stripeConnectStatus` on the tenant doc gates the donate page. A Standard
    // account misread as pending is a church that finished onboarding and still
    // cannot take a gift.
    expect(deriveConnectStatus(standardAccount())).toBe('active');
  });

  it('classifies restricted and pending Standard accounts the same as any other', () => {
    expect(deriveConnectStatus(standardAccount({
      charges_enabled: false,
      payouts_enabled: false,
      requirements: { currently_due: ['company.tax_id'] } as Stripe.Account.Requirements,
    }))).toBe('restricted');

    expect(deriveConnectStatus(standardAccount({
      details_submitted: false,
      charges_enabled: false,
      payouts_enabled: false,
      requirements: { currently_due: [] } as unknown as Stripe.Account.Requirements,
    }))).toBe('pending');
  });

  it('🔴 the derivation does not read account.type — same fields, same verdict', () => {
    // The real assurance is not that Standard happens to classify correctly
    // today; it is that the classification cannot depend on the type at all.
    // `charges_enabled` / `payouts_enabled` / `requirements.currently_due` are
    // plain Account fields Stripe populates for every type.
    for (const fields of [
      { charges_enabled: true, payouts_enabled: true, requirements: { currently_due: [] } },
      { charges_enabled: false, payouts_enabled: false, requirements: { currently_due: ['x'] } },
      { charges_enabled: false, payouts_enabled: false, requirements: { currently_due: [] } },
      { charges_enabled: true, payouts_enabled: false, requirements: { currently_due: [] } },
    ]) {
      const asStandard = deriveConnectStatus({ ...fields, type: 'standard' } as Stripe.Account);
      const asExpress = deriveConnectStatus({ ...fields, type: 'express' } as Stripe.Account);
      expect(asStandard).toBe(asExpress);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 7 / 8 — the gates, driven for real and pinned as they ACTUALLY are.
// ═══════════════════════════════════════════════════════════════════════════

describe('the gate on the onboarding route is unchanged', () => {
  // ⚠️ DRIFT NOTE. `/api/stripe/connect` is gated by `requireAuth` plus a
  // TENANT-MEMBERSHIP match — it is not, and never was, on `requireOwner`;
  // `requireOwner` gates `/api/stripe/connect/login-link`, and is exercised for
  // real in `express-login-link.test.ts`. That split is deliberate and is
  // documented in the login-link route: onboarding only ever starts a
  // Stripe-hosted form, whereas a login link is a session inside the church's
  // bank details. This suite pins the gate each route actually has; changing
  // the account type must not have moved either.

  it('refuses an unauthenticated caller before Stripe', async () => {
    const res = await connect(connectRequest({ tenantId: 'grace' }, null));

    expect(res.status).toBe(401);
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it('🔴 refuses a caller naming a tenant they do not belong to', async () => {
    // Hope's owner — a legitimate owner, of the wrong church — naming Grace.
    const res = await connect(connectRequest({ tenantId: 'grace' }, OTHER_TENANT_OWNER));

    expect(res.status).toBe(403);
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(tenantPrivateWrites).toEqual([]);
  });

  it('an ordinary member of ANOTHER tenant is refused too', async () => {
    // Fully authenticated and a real member of Hope — the refusal is about
    // scope, not identity.
    const res = await connect(connectRequest({ tenantId: 'grace' }, OTHER_TENANT_MEMBER));

    expect(res.status).toBe(403);
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it('⚠️ an ordinary member of the SAME tenant still passes — by design, unchanged', async () => {
    // Stated explicitly rather than left implicit. The membership gate admits
    // any member of the church, which is defensible here precisely because the
    // route only ever hands back a Stripe-hosted onboarding form. It is NOT
    // defensible for the dashboard route, which is why that one is on
    // `requireOwner` and refuses this same persona (test 3 there).
    const res = await connect(connectRequest({ tenantId: 'grace' }, MEMBER));

    expect(res.status).toBe(200);
    // Whoever starts it, the account created is Standard.
    expect(accountCreateParams().type).toBe('standard');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 9 — the response is the onboarding url and nothing else.
// ═══════════════════════════════════════════════════════════════════════════

describe('no Stripe secret or account id reaches the client', () => {
  it('returns the onboarding url alone', async () => {
    const res = await connect(connectRequest({ tenantId: 'grace' }, OWNER));
    const raw = await res.text();

    expect(Object.keys(JSON.parse(raw))).toEqual(['url']);
    // 🔴 The id was created, persisted and sent to Stripe — and still never
    // travelled to the browser. `tenant_private` is `allow read, write: if
    // false`; there is no reason for a client to learn it.
    expect(raw).not.toContain(NEW_CHURCH_ACCOUNT_ID);
    expect(raw).not.toContain(STRIPE_SECRET_KEY);
  });

  it('leaks neither when Stripe itself fails mid-onboarding', async () => {
    // Stripe errors often quote the offending id straight back, and the failure
    // window here spans a LIVE account that no tenant doc points at yet.
    mockAccountLinksCreate.mockRejectedValue(
      new Error(`No such account: ${NEW_CHURCH_ACCOUNT_ID} (key ${STRIPE_SECRET_KEY})`),
    );

    const res = await connect(connectRequest({ tenantId: 'grace' }, OWNER));
    const raw = await res.text();

    expect(res.status).toBe(500);
    expect(raw).not.toContain(NEW_CHURCH_ACCOUNT_ID);
    expect(raw).not.toContain(STRIPE_SECRET_KEY);
  });

  it('leaks neither on the refusal paths, where an error might name them', async () => {
    tenantPrivate.set('grace', { adminEmails: [], stripeConnectAccountId: EXISTING_CHURCH_ACCOUNT_ID });

    for (const persona of [OTHER_TENANT_OWNER, null]) {
      const raw = await (await connect(connectRequest({ tenantId: 'grace' }, persona))).text();
      expect(raw).not.toContain(EXISTING_CHURCH_ACCOUNT_ID);
      expect(raw).not.toContain(STRIPE_SECRET_KEY);
    }
  });

  it('the affiliate route leaks neither either', async () => {
    mockAccountsCreate.mockResolvedValue({ id: AFFILIATE_ACCOUNT_ID });

    const raw = await (await affiliateOnboard(affiliateRequest(TENANTLESS_AFFILIATE))).text();

    expect(raw).not.toContain(AFFILIATE_ACCOUNT_ID);
    expect(raw).not.toContain(STRIPE_SECRET_KEY);
  });
});
